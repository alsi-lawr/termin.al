import {
  createCollectionViewerContent,
  createDirectoryViewerContent,
  createDocumentViewerContent,
  type ViewerContent,
  type ViewerCollectionLeaf,
  type ViewerCollectionNode,
  type ViewerOpenDisposition,
  type ViewerStatsIdentity,
} from "../../content/ViewerContent.ts";
import type { ProjectReadme } from "../../api/ContentClient.ts";
import { ContentId } from "../../api/ContentContracts.ts";
import type { MarkdownDocument } from "../../content/MarkdownDocument.ts";
import {
  listVirtualDirectory,
  resolveVirtualPath,
  traverseVirtualDirectory,
  type VirtualDocumentSupplier,
  type VirtualDocumentClassification,
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
  readStats: PortfolioStatsReader;
}>;

export type PortfolioStatsReader = () => string;

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
  publication: Extract<
    VirtualDocumentClassification,
    { kind: "publication" }
  >;
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

type CollectionLeafSource = Readonly<{
  branchPath: string;
  leaf: ViewerCollectionLeaf;
}>;

type CollectionBranchBuilder = {
  readonly id: string;
  readonly title: string;
  readonly path: string;
  readonly branches: Map<string, CollectionBranchBuilder>;
  readonly leaves: ViewerCollectionLeaf[];
};

function createBranchBuilder(
  id: string,
  title: string,
  path: string,
): CollectionBranchBuilder {
  return { id, title, path, branches: new Map(), leaves: [] };
}

function compareCollectionTitles(
  left: CollectionBranchBuilder,
  right: CollectionBranchBuilder,
): number {
  if (left.title < right.title) {
    return -1;
  }

  return left.title > right.title ? 1 : 0;
}

function collectionTree(
  leaves: ReadonlyArray<CollectionLeafSource>,
): ReadonlyArray<ViewerCollectionNode> {
  const root = createBranchBuilder("collection-root", "", "");

  for (const source of leaves) {
    const segments = source.branchPath.length === 0
      ? []
      : source.branchPath.split("/");
    let branch = root;
    let path = "";

    for (const segment of segments) {
      path = path.length === 0 ? segment : `${path}/${segment}`;
      const existing = branch.branches.get(segment);

      if (existing !== undefined) {
        branch = existing;
        continue;
      }

      const created = createBranchBuilder(`branch:${path}`, segment, path);
      branch.branches.set(segment, created);
      branch = created;
    }

    branch.leaves.push(source.leaf);
  }

  const nodes = (branch: CollectionBranchBuilder): ReadonlyArray<ViewerCollectionNode> => [
    ...[...branch.branches.values()]
      .sort(compareCollectionTitles)
      .map((child): ViewerCollectionNode => ({
        kind: "branch",
        id: child.id,
        title: child.title,
        path: child.path,
        children: nodes(child),
      })),
    ...branch.leaves,
  ];

  return nodes(root);
}

function projectLeaf(project: ProjectReadme): CollectionLeafSource {
  return {
    branchPath: project.collectionPath,
    leaf: {
      kind: "leaf",
      id: `project:${project.id}`,
      title: project.name,
      path: `${project.collectionPath}/${project.name}`,
      summary: project.summary,
      metadata: project.repository,
      repositoryUrl: project.repositoryUrl,
      tags: project.tags,
      documentTitle: `${project.name} README`,
      document: project.document,
      statsIdentity: statsIdentityFrom(project.id, "project README id"),
    },
  };
}

function publicationLeaf(rootPath: string, {
  node,
  document,
  publication,
}: LoadedDirectoryDocument): CollectionLeafSource {
  const relativePath = node.path.slice(rootPath.length + 1);
  const slash = relativePath.lastIndexOf("/");
  const branchPath = slash < 0 ? "" : relativePath.slice(0, slash);

  return {
    branchPath,
    leaf: {
      kind: "leaf",
      id: `publication:${node.id}`,
      title: publication.title,
      path: relativePath,
      summary: publication.summary,
      metadata: publication.publishedAt.slice(0, 10),
      repositoryUrl: undefined,
      tags: publication.tags,
      documentTitle: publication.title,
      document,
      statsIdentity: statsIdentityFrom(
        node.documentHandle,
        "publication document handle",
      ),
    },
  };
}

function statsIdentityFrom(
  value: string,
  field: string,
): ViewerStatsIdentity {
  const contentId = ContentId.tryCreate(value, field);

  return contentId.kind === "valid"
    ? { kind: "countable", contentId: contentId.value }
    : { kind: "uncounted" };
}

async function loadDirectoryDocuments(
  entries: ReadonlyArray<VirtualFileNode>,
  documents: VirtualDocumentSupplier,
  publicationKind: "blog" | "note",
  signal: AbortSignal,
): Promise<LoadedDirectoryDocumentsResult> {
  const loaded = await Promise.all(
    entries.map(async (node) => ({
      node,
      result: await documents.read(node.documentHandle, signal),
    })),
  );

  if (
    signal.aborted ||
    loaded.some(({ result }) => result.kind === "cancelled")
  ) {
    return { kind: "cancelled" };
  }
  if (loaded.some(({ result }) => result.kind === "missing")) {
    return { kind: "missing" };
  }

  const available: LoadedDirectoryDocument[] = [];

  for (const entry of loaded) {
    if (entry.result.kind === "available") {
      if (
        entry.result.classification.kind !== "publication" ||
        entry.result.classification.publicationKind !== publicationKind
      ) {
        return { kind: "missing" };
      }

      available.push({
        node: entry.node,
        document: entry.result.document,
        publication: entry.result.classification,
      });
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
        viewer: createCollectionViewerContent({
          title: "Projects",
          emptyMessage:
            "No public projects are available. Press Esc or Ctrl+C to return.",
          roots: collectionTree(projectReadmes.map(projectLeaf)),
        }),
      };
    }

    if (resolution.node.path === "~/blog" || resolution.node.path === "~/notes") {
      const documentPublicationKind =
        resolution.node.path === "~/blog" ? "blog" : "note";
      const traversal = traverseVirtualDirectory({
        filesystem,
        directory: resolution.node,
        limit: 100,
        maximumDepth: 100,
        signal: context.signal,
      });

      if (traversal.kind === "cancelled") {
        return { kind: "cancelled" };
      }

      const files = traversal.entries.flatMap(({ node }) =>
        node.kind === "file" ? [node] : []
      );
      const loaded = await loadDirectoryDocuments(
        files,
        documents,
        documentPublicationKind,
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
        documentPublicationKind === "blog" ? "blog" : "notes";
      const leaves = [...loaded.documents]
        .sort((left, right) =>
          right.publication.publishedAt.localeCompare(
            left.publication.publishedAt,
          ),
        )
        .map((entry) => publicationLeaf(resolution.node.path, entry));

      return {
        kind: "viewer",
        viewer: createCollectionViewerContent({
          title: publicationKind === "blog" ? "Blog" : "Notes",
          emptyMessage: publicationKind === "blog"
            ? "No blog posts are published. Press Esc or Ctrl+C to return."
            : "No public notes are published. Press Esc or Ctrl+C to return.",
          roots: collectionTree(leaves),
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
      statsIdentity: statsIdentityFrom(
        resolution.node.documentHandle,
        "document handle",
      ),
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
    pipeline: "text",
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
    pipeline: "effects",
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
  name: "theme" | "login" | "logout" | "edit",
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
    pipeline: "effects",
    execute: async () => rejectedOutcome(name, message),
  };
}

function createStatsCommand(readStats: PortfolioStatsReader): CommandDefinition {
  return {
    metadata: {
      group: "application",
      name: "stats",
      aliases: [],
      summary: "Show aggregate site statistics.",
      usage: "stats",
      examples: ["stats"],
    },
    pipeline: "text",
    execute: async (invocation) => {
      const argumentError = noArguments(invocation, "stats");

      if (argumentError !== undefined) {
        return rejectedOutcome("stats", argumentError);
      }

      return themeOutput("stats-output", readStats());
    },
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
    pipeline: "effects",
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
    pipeline: "effects",
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
  readStats,
}: CreatePortfolioCommandDefinitionsOptions): ReadonlyArray<CommandDefinition> {
  return [
    createHelpCommand(),
    createOpenCommand(filesystem, documents, projectReadmes),
    createThemeCommand(themes),
    createStatsCommand(readStats),
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
