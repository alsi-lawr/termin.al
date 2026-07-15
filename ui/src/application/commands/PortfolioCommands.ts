import {
  createDirectoryViewerContent,
  createDocumentViewerContent,
  type ViewerContent,
  type ViewerOpenDisposition,
} from "../../content/ViewerContent.ts";
import {
  listVirtualDirectory,
  resolveVirtualPath,
  type VirtualDocumentSupplier,
  type VirtualFilesystem,
  type VirtualPathFailure,
} from "../../domain/filesystem/VirtualFilesystem.ts";
import {
  createShellDiagnosticId,
  createShellOutputId,
  createShellOutputPartId,
  type CommandOutcome,
  type ShellOutput,
} from "../../domain/terminal/Shell.ts";
import type {
  CommandDefinition,
  CommandExecutionContext,
  CommandGroup,
  CommandInvocation,
} from "./CommandRegistry.ts";

export type CreatePortfolioCommandDefinitionsOptions = Readonly<{
  filesystem: VirtualFilesystem;
  documents: VirtualDocumentSupplier;
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

function noArguments(
  invocation: CommandInvocation,
  usage: string,
): string | undefined {
  return invocation.arguments.length === 0 ? undefined : `Usage: ${usage}`;
}

async function openTarget(
  commandName: string,
  filesystem: VirtualFilesystem,
  documents: VirtualDocumentSupplier,
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
          kind: "rich",
          id: createShellOutputId("help-output"),
          title: "Command help",
          fields: commandGroups.map((group) => ({
            id: createShellOutputPartId(`help-${group}`),
            label: commandGroupLabel(group),
            value: context.registry.commands
              .filter((command) => command.metadata.group === group)
              .map(
                (command) =>
                  `${command.metadata.name} — ${command.metadata.summary}\n` +
                  `  ${command.metadata.usage}\n` +
                  `  e.g. ${command.metadata.examples[0] ?? command.metadata.name}`,
              )
              .join("\n\n"),
          })),
        },
      ]);
    },
  };
}

function createOpenCommand(
  filesystem: VirtualFilesystem,
  documents: VirtualDocumentSupplier,
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
}: CreatePortfolioCommandDefinitionsOptions): ReadonlyArray<CommandDefinition> {
  return [
    createHelpCommand(),
    createOpenCommand(filesystem, documents),
    createUnavailableCommand(
      "theme",
      "Change the terminal theme.",
      "theme <list|set|system>",
      "theme list",
      "Themes are unavailable until the theme work is implemented.",
    ),
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
    createNavigationCommand("about", "~/about.md", filesystem, documents),
    createNavigationCommand("skills", "~/skills.md", filesystem, documents),
    createNavigationCommand("tools", "~/tools.md", filesystem, documents),
    createNavigationCommand("now", "~/now.md", filesystem, documents),
    createNavigationCommand("projects", "~/projects", filesystem, documents),
    createNavigationCommand("blog", "~/blog", filesystem, documents),
    createNavigationCommand("notes", "~/notes", filesystem, documents),
    createNavigationCommand("changelog", "~/changelog.md", filesystem, documents),
    createNavigationCommand("cv", "~/cv.md", filesystem, documents),
  ];
}
