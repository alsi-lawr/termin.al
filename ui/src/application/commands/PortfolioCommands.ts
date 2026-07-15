import {
  createDirectoryViewerContent,
  createDocumentViewerContent,
  createProjectGalleryViewerContent,
  createPublicationListViewerContent,
  type ViewerContent,
  type ViewerOpenDisposition,
  type ViewerProjectCard,
  type ViewerPublicationEntry,
} from "../../content/ViewerContent.ts";
import type { ProjectReadme } from "../../api/ContentClient.ts";
import type { MarkdownDocument } from "../../content/MarkdownDocument.ts";
import {
  listVirtualDirectory,
  resolveVirtualPath,
  type VirtualDocumentSupplier,
  type VirtualFileNode,
  type VirtualFilesystem,
  type VirtualPathFailure,
} from "../../domain/filesystem/VirtualFilesystem.ts";
import {
  createShellDiagnosticId,
  createShellOutputId,
  type CommandOutcome,
  type ShellOutput,
} from "../../domain/terminal/Shell.ts";
import {
  themeNameFrom,
  type ThemeController,
  type ThemeStatus,
} from "../../theme/Theme.ts";
import type {
  CommandDefinition,
  CommandExecutionContext,
  CommandGroup,
  CommandInvocation,
} from "./CommandRegistry.ts";

export type CreatePortfolioCommandDefinitionsOptions = Readonly<{
  filesystem: VirtualFilesystem;
  documents: VirtualDocumentSupplier;
  projectReadmes: ReadonlyArray<ProjectReadme>;
  themes: ThemeController;
}>;

type OpenCommandOptions = Readonly<{
  path: string;
  disposition: ViewerOpenDisposition;
}>;

type OpenTargetResult =
  | Readonly<{
      kind: "viewer";
      viewer: ViewerContent;
    }>
  | Readonly<{
      kind: "failed";
      outcome: CommandOutcome;
    }>
  | Readonly<{ kind: "cancelled" }>;

type LoadedDirectoryDocument = Readonly<{
  node: VirtualFileNode;
  document: MarkdownDocument;
}>;

type LoadedDirectoryDocumentsResult =
  | Readonly<{
      kind: "available";
      documents: ReadonlyArray<LoadedDirectoryDocument>;
    }>
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "cancelled" }>;

const commandGroups = [
  "gnu-like",
  "application",
  "navigation",
] as const satisfies ReadonlyArray<CommandGroup>;

function succeededOutcome(
  outputs: ReadonlyArray<ShellOutput>,
  effects: Extract<CommandOutcome, { kind: "succeeded" }>["effects"] = [],
): CommandOutcome {
  return { kind: "succeeded", outputs, effects };
}

function rejectedOutcome(commandName: string, message: string): CommandOutcome {
  return {
    kind: "failed",
    failure: { kind: "command-rejected", commandName, message },
    diagnostics: [
      {
        kind: "command",
        id: createShellDiagnosticId("command-rejected"),
        code: "command.rejected",
        message,
      },
    ],
  };
}

function unavailableContentOutcome(commandName: string): CommandOutcome {
  return {
    kind: "failed",
    failure: {
      kind: "execution-error",
      commandName,
      cause: new Error("Content is unavailable."),
    },
    diagnostics: [
      {
        kind: "runtime",
        id: createShellDiagnosticId("content-unavailable"),
        code: "runtime.content-unavailable",
        message: "Content is unavailable.",
      },
    ],
  };
}

function cancelledOutcome(): CommandOutcome {
  return {
    kind: "cancelled",
    diagnostic: {
      kind: "runtime",
      id: createShellDiagnosticId("command-cancelled"),
      code: "runtime.cancelled",
      message: "Command cancelled.",
    },
  };
}

function failureOutcome(
  commandName: string,
  failure: VirtualPathFailure,
): CommandOutcome {
  switch (failure.kind) {
    case "invalid-path":
      return rejectedOutcome(commandName, `Invalid path: ${failure.input}`);
    case "not-found":
      return rejectedOutcome(commandName, `Path not found: ${failure.path}`);
    case "not-directory":
      return rejectedOutcome(commandName, `Not a directory: ${failure.path}`);
    case "locked":
      return rejectedOutcome(commandName, `Access is locked: ${failure.path}`);
  }
}

function optionBoundary(invocation: CommandInvocation): number {
  if (invocation.optionTerminator.kind === "absent") {
    return invocation.arguments.length;
  }

  return Math.max(
    0,
    Math.min(
      invocation.arguments.length,
      invocation.optionTerminator.argumentIndex - 1,
    ),
  );
}

function parseOpenCommand(
  invocation: CommandInvocation,
): OpenCommandOptions | Readonly<{ kind: "invalid"; message: string }> {
  const boundary = optionBoundary(invocation);
  const first = invocation.arguments[0];

  if (first === "--split" && boundary > 0) {
    const orientation = invocation.arguments[1];
    const path = invocation.arguments[2];

    if (
      invocation.arguments.length !== 3 ||
      path === undefined ||
      (orientation !== "horizontal" && orientation !== "vertical")
    ) {
      return {
        kind: "invalid",
        message: "Usage: open [--split horizontal|vertical] <target>",
      };
    }

    return { path, disposition: { kind: "split", orientation } };
  }

  if (invocation.arguments.length !== 1 || first === undefined) {
    return {
      kind: "invalid",
      message: "Usage: open [--split horizontal|vertical] <target>",
    };
  }

  if (boundary > 0 && first.length > 1 && first.startsWith("-")) {
    return { kind: "invalid", message: `Unsupported option: ${first}.` };
  }

  return { path: first, disposition: { kind: "inline" } };
}

function commandGroupLabel(group: CommandGroup): string {
  switch (group) {
    case "gnu-like":
      return "GNU-like commands";
    case "application":
      return "Application commands";
    case "navigation":
      return "Navigation commands";
  }
}

function formatTerminalHelpIndex(context: CommandExecutionContext): string {
  const commandLines = commandGroups.flatMap((group) => {
    const commands = context.registry.commands.filter(
      (command) => command.metadata.group === group,
    );
    const maximumNameLength = Math.max(
      1,
      ...commands.map((command) => command.metadata.name.length),
    );
    const lines = commands.map((command) => {
      let aliases = "";

      if (command.metadata.aliases.length > 0) {
        aliases = ` (${command.metadata.aliases.join(", ")})`;
      }

      return `         ${command.metadata.name.padEnd(maximumNameLength)} ${command.metadata.summary}${aliases}`;
    });

    return [`       ${commandGroupLabel(group)}`, ...lines, ""];
  });
  const header = "HELP(1)                      TERMIN.AL                      HELP(1)";

  return [
    header,
    "",
    "NAME",
    "       help - show terminal command index",
    "",
    "SYNOPSIS",
    "       help",
    "",
    "COMMANDS",
    ...commandLines,
    "EXAMPLES",
    "       $ help",
    "       $ man ls",
    "",
    "SEE ALSO",
    "       man(1)",
    "",
    header,
  ].join("\n");
}

function noArguments(
  invocation: CommandInvocation,
  usage: string,
): string | undefined {
  return invocation.arguments.length === 0 ? undefined : `Usage: ${usage}`;
}

function markdownTitle(document: MarkdownDocument, fallback: string): string {
  const heading = document.text
    .split(/\r?\n/u)
    .find((line) => line.startsWith("# "));
  const title = heading?.slice(2).trim();

  return title === undefined || title.length === 0 ? fallback : title;
}

function markdownSummary(document: MarkdownDocument): string {
  const summary = document.text
    .split(/\r?\n\s*\r?\n/u)
    .map((paragraph) => paragraph.trim())
    .find((paragraph) => paragraph.length > 0 && !paragraph.startsWith("#"));

  return summary ?? "No summary is available.";
}

function projectCard(project: ProjectReadme): ViewerProjectCard {
  return {
    id: project.id,
    name: project.name,
    summary: project.summary,
    repository: project.repository,
    repositoryUrl: project.repositoryUrl,
    tags: project.tags,
    document: project.document,
  };
}

function publicationEntry({
  node,
  document,
}: LoadedDirectoryDocument): ViewerPublicationEntry {
  return {
    id: node.id,
    title: markdownTitle(document, node.name),
    summary: markdownSummary(document),
    publishedAt: node.updatedAt,
    document,
  };
}

async function loadDirectoryDocuments(
  entries: ReadonlyArray<VirtualFileNode>,
  documents: VirtualDocumentSupplier,
  signal: AbortSignal,
): Promise<LoadedDirectoryDocumentsResult> {
  const loaded = await Promise.all(
    entries.map(async (node) => ({
      node,
      result: await documents.read(node.documentHandle, signal),
    })),
  );

  if (signal.aborted || loaded.some(({ result }) => result.kind === "cancelled")) {
    return { kind: "cancelled" };
  }

  if (loaded.some(({ result }) => result.kind === "missing")) {
    return { kind: "missing" };
  }

  const available: LoadedDirectoryDocument[] = [];

  for (const entry of loaded) {
    if (entry.result.kind === "available") {
      available.push({ node: entry.node, document: entry.result.document });
    }
  }

  return { kind: "available", documents: available };
}

async function openTarget(
  commandName: string,
  filesystem: VirtualFilesystem,
  documents: VirtualDocumentSupplier,
  projectReadmes: ReadonlyArray<ProjectReadme>,
  context: CommandExecutionContext,
  path: string,
): Promise<OpenTargetResult> {
  if (context.signal.aborted) {
    return { kind: "cancelled" };
  }

  const resolution = resolveVirtualPath(
    filesystem,
    context.currentDirectory,
    path,
  );

  if (resolution.kind !== "found") {
    return { kind: "failed", outcome: failureOutcome(commandName, resolution) };
  }

  if (resolution.node.kind === "directory") {
    const listing = listVirtualDirectory(
      filesystem,
      context.currentDirectory,
      path,
    );

    if (listing.kind !== "found") {
      return { kind: "failed", outcome: failureOutcome(commandName, listing) };
    }

    if (resolution.node.path === "~/projects") {
      return {
        kind: "viewer",
        viewer: createProjectGalleryViewerContent({
          title: "Projects",
          projects: projectReadmes.map(projectCard),
        }),
      };
    }

    if (resolution.node.path === "~/blog" || resolution.node.path === "~/notes") {
      const files = listing.entries.filter(
        (entry): entry is VirtualFileNode => entry.kind === "file",
      );
      const loaded = await loadDirectoryDocuments(
        files,
        documents,
        context.signal,
      );

      if (loaded.kind === "cancelled") {
        return { kind: "cancelled" };
      }

      if (loaded.kind === "missing") {
        return {
          kind: "failed",
          outcome: unavailableContentOutcome(commandName),
        };
      }

      const publicationKind =
        resolution.node.path === "~/blog" ? "blog" : "notes";
      const entries = loaded.documents
        .map(publicationEntry)
        .sort((left, right) =>
          right.publishedAt.localeCompare(left.publishedAt),
        );

      return {
        kind: "viewer",
        viewer: createPublicationListViewerContent({
          title: publicationKind === "blog" ? "Blog" : "Notes",
          publicationKind,
          entries,
        }),
      };
    }

    return {
      kind: "viewer",
      viewer: createDirectoryViewerContent({
        title: resolution.node.name,
        path: resolution.node.path,
        entries: listing.entries.map((entry) => ({
          name: entry.name,
          kind: entry.kind,
        })),
      }),
    };
  }

  if (resolution.node.kind === "locked-file") {
    return {
      kind: "failed",
      outcome: rejectedOutcome(commandName, `Access is locked: ${resolution.path}`),
    };
  }

  const document = await documents.read(resolution.node.documentHandle, context.signal);

  if (context.signal.aborted || document.kind === "cancelled") {
    return { kind: "cancelled" };
  }

  if (document.kind === "missing") {
    return { kind: "failed", outcome: unavailableContentOutcome(commandName) };
  }

  return {
    kind: "viewer",
    viewer: createDocumentViewerContent({
      title: resolution.node.name,
      presentation: "inline",
      document: document.document,
    }),
  };
}

function createHelpCommand(): CommandDefinition {
  return {
    metadata: {
      group: "application",
      name: "help",
      aliases: [],
      summary: "Show commands grouped by purpose.",
      usage: "help",
      examples: ["help", "man open"],
    },
    execute: async (invocation, context) => {
      const argumentError = noArguments(invocation, "help");

      if (argumentError !== undefined) {
        return rejectedOutcome("help", argumentError);
      }

      return succeededOutcome([
        {
          kind: "text",
          id: createShellOutputId("help-output"),
          text: formatTerminalHelpIndex(context),
        },
      ]);
    },
  };
}

function createOpenCommand(
  filesystem: VirtualFilesystem,
  documents: VirtualDocumentSupplier,
  projectReadmes: ReadonlyArray<ProjectReadme>,
): CommandDefinition {
  return {
    metadata: {
      group: "application",
      name: "open",
      aliases: [],
      summary: "Open virtual content inline or in a split viewer pane.",
      usage: "open [--split horizontal|vertical] <target>",
      examples: ["open about.md", "open --split vertical projects"],
    },
    execute: async (invocation, context) => {
      const parsed = parseOpenCommand(invocation);

      if ("kind" in parsed) {
        return rejectedOutcome("open", parsed.message);
      }

      const target = await openTarget(
        "open",
        filesystem,
        documents,
        projectReadmes,
        context,
        parsed.path,
      );

      if (target.kind === "cancelled") {
        return cancelledOutcome();
      }

      if (target.kind === "failed") {
        return target.outcome;
      }

      return succeededOutcome([], [
        {
          kind: "open-viewer",
          viewer: target.viewer,
          disposition: parsed.disposition,
        },
      ]);
    },
  };
}

function createUnavailableCommand(
  name: "theme" | "stats" | "login" | "logout" | "edit",
  summary: string,
  usage: string,
  example: string,
  message: string,
): CommandDefinition {
  return {
    metadata: {
      group: "application",
      name,
      aliases: [],
      summary,
      usage,
      examples: [example],
    },
    execute: async () => rejectedOutcome(name, message),
  };
}

function currentThemeMessage(status: ThemeStatus): string {
  switch (status.preference.kind) {
    case "system":
      return `Current theme: ${status.theme} (system)`;
    case "explicit":
      return `Current theme: ${status.theme} (explicit)`;
  }
}

function themeListMessage(themes: ThemeController): string {
  const current = themes.current().theme;
  const entries = themes.list().map((theme) =>
    theme === current ? `${theme} (current)` : theme,
  );

  return `Available themes:\n${entries.join("\n")}`;
}

function themeOutput(id: string, text: string): CommandOutcome {
  return succeededOutcome([
    {
      kind: "text",
      id: createShellOutputId(id),
      text,
    },
  ]);
}

function createThemeCommand(themes: ThemeController): CommandDefinition {
  return {
    metadata: {
      group: "application",
      name: "theme",
      aliases: [],
      summary: "List, select, or follow the system terminal theme.",
      usage: "theme [list|set <name>|system]",
      examples: ["theme list", "theme set gruber-darker", "theme system"],
    },
    execute: async (invocation) => {
      const [operation, value, ...remaining] = invocation.arguments;

      if (operation === undefined) {
        return themeOutput("theme-current", currentThemeMessage(themes.current()));
      }

      if (operation === "list" && value === undefined) {
        return themeOutput("theme-list", themeListMessage(themes));
      }

      if (operation === "system" && value === undefined) {
        return themeOutput(
          "theme-system",
          `Theme follows system: ${currentThemeMessage(themes.followSystem())}`,
        );
      }

      if (operation === "set" && value !== undefined && remaining.length === 0) {
        const theme = themeNameFrom(value);

        if (theme === undefined) {
          return rejectedOutcome("theme", `Unknown theme: ${value}`);
        }

        return themeOutput(
          "theme-set",
          `Theme set: ${currentThemeMessage(themes.set(theme))}`,
        );
      }

      return rejectedOutcome("theme", "Usage: theme [list|set <name>|system]");
    },
  };
}

function createNavigationCommand(
  name:
    | "about"
    | "skills"
    | "tools"
    | "now"
    | "projects"
    | "blog"
    | "notes"
    | "changelog"
    | "cv",
  targetPath: string,
  filesystem: VirtualFilesystem,
  documents: VirtualDocumentSupplier,
  projectReadmes: ReadonlyArray<ProjectReadme>,
): CommandDefinition {
  return {
    metadata: {
      group: "navigation",
      name,
      aliases: [],
      summary: `Open ${name} content.`,
      usage: name,
      examples: [name],
    },
    execute: async (invocation, context) => {
      const argumentError = noArguments(invocation, name);

      if (argumentError !== undefined) {
        return rejectedOutcome(name, argumentError);
      }

      const target = await openTarget(
        name,
        filesystem,
        documents,
        projectReadmes,
        context,
        targetPath,
      );

      if (target.kind === "cancelled") {
        return cancelledOutcome();
      }

      if (target.kind === "failed") {
        return target.outcome;
      }

      return succeededOutcome([], [
        {
          kind: "open-viewer",
          viewer: target.viewer,
          disposition: { kind: "inline" },
        },
      ]);
    },
  };
}

export function createPortfolioCommandDefinitions({
  filesystem,
  documents,
  projectReadmes,
  themes,
}: CreatePortfolioCommandDefinitionsOptions): ReadonlyArray<CommandDefinition> {
  return [
    createHelpCommand(),
    createOpenCommand(filesystem, documents, projectReadmes),
    createThemeCommand(themes),
    createUnavailableCommand(
      "stats",
      "Show aggregate site statistics.",
      "stats",
      "stats",
      "Statistics are unavailable until the host statistics work is implemented.",
    ),
    createUnavailableCommand(
      "login",
      "Authenticate with GitHub.",
      "login",
      "login",
      "Authentication is unavailable until the host authentication work is implemented.",
    ),
    createUnavailableCommand(
      "logout",
      "End the authenticated session.",
      "logout",
      "logout",
      "Authentication is unavailable until the host authentication work is implemented.",
    ),
    createUnavailableCommand(
      "edit",
      "Edit published content.",
      "edit <path>",
      "edit notes/sample-note.md",
      "Published-content editing is unavailable until authoring work is implemented.",
    ),
    createNavigationCommand("about", "~/about.md", filesystem, documents, projectReadmes),
    createNavigationCommand("skills", "~/skills.md", filesystem, documents, projectReadmes),
    createNavigationCommand("tools", "~/tools.md", filesystem, documents, projectReadmes),
    createNavigationCommand("now", "~/now.md", filesystem, documents, projectReadmes),
    createNavigationCommand("projects", "~/projects", filesystem, documents, projectReadmes),
    createNavigationCommand("blog", "~/blog", filesystem, documents, projectReadmes),
    createNavigationCommand("notes", "~/notes", filesystem, documents, projectReadmes),
    createNavigationCommand("changelog", "~/changelog.md", filesystem, documents, projectReadmes),
    createNavigationCommand("cv", "~/cv.md", filesystem, documents, projectReadmes),
  ];
}
