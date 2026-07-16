import {
  listVirtualDirectory,
  resolveVirtualDirectory,
  resolveVirtualPath,
  traverseVirtualDirectory,
  type VirtualDirectoryNode,
  type VirtualDocumentSupplier,
  type VirtualFileNode,
  type VirtualFilesystem,
  type VirtualNode,
  type VirtualPathFailure,
  type VirtualTraversalResult,
} from "../../domain/filesystem/VirtualFilesystem.ts";
import { createDocumentViewerContent } from "../../content/ViewerContent.ts";
import {
  createShellDiagnosticId,
  createShellOutputId,
  type CommandEffect,
  type CommandOutcome,
  type ShellDiagnostic,
  type ShellOutput,
} from "../../domain/terminal/Shell.ts";
import {
  resolveCommand,
  type CommandDefinition,
  type CommandExecutionContext,
  type CommandInvocation,
  type CommandMetadata,
} from "./CommandRegistry.ts";

export type CreateReadOnlyCommandDefinitionsOptions = Readonly<{
  filesystem: VirtualFilesystem;
  documents: VirtualDocumentSupplier;
  recursiveEntryLimit: number;
}>;

type OptionParseResult<Value> =
  | Readonly<{
      kind: "parsed";
      value: Value;
    }>
  | Readonly<{
      kind: "invalid";
      message: string;
    }>;

type LsOptions = Readonly<{
  showAll: boolean;
  long: boolean;
  tree: boolean;
  path: string;
}>;

type TreeOptions = Readonly<{
  showAll: boolean;
  maximumDepth: number;
  path: string;
}>;

type TreeExecutionOptions = Readonly<{
  commandName: "ls" | "tree";
  showAll: boolean;
  maximumDepth: number;
  path: string;
}>;

type FindOptions = Readonly<{
  pattern: string;
  path: string;
}>;

type GrepOptions = Readonly<{
  ignoreCase: boolean;
  lineNumbers: boolean;
  pattern: string;
  path: string;
}>;

type LineReaderOptions = Readonly<{
  lineCount: number;
  path: string;
}>;

type ReadFileResult =
  | Readonly<{
      kind: "read";
      file: VirtualFileNode;
      text: string;
      sourcePath: string;
    }>
  | Readonly<{
      kind: "failed";
      outcome: CommandOutcome;
    }>
  | Readonly<{ kind: "cancelled" }>;

type GrepFileSelection =
  | Readonly<{
      kind: "files";
      files: ReadonlyArray<VirtualFileNode>;
      truncated: boolean;
    }>
  | Readonly<{
      kind: "failed";
      outcome: CommandOutcome;
    }>
  | Readonly<{ kind: "cancelled" }>;

type DisplayEntry = Readonly<{
  kind: "directory" | "file" | "locked-file";
  name: string;
  size: number;
  updatedAt: string;
}>;

const maximumRecursiveDepth = 8;
const maximumRequestedLineCount = 1000;

function succeededOutcome(
  outputs: ReadonlyArray<ShellOutput>,
  effects: ReadonlyArray<CommandEffect> = [],
): CommandOutcome {
  return {
    kind: "succeeded",
    outputs,
    effects: effects ?? [],
  };
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

function textOutput(id: string, text: string): ShellOutput {
  return { kind: "text", id: createShellOutputId(id), text };
}

function truncationOutput(commandName: string, limit: number): ShellOutput {
  const diagnostic: ShellDiagnostic = {
    kind: "runtime",
    id: createShellDiagnosticId("recursive-results-truncated"),
    code: "runtime.truncated",
    message: `${commandName} stopped after ${limit} entries.`,
  };

  return {
    kind: "diagnostic",
    id: createShellOutputId("recursive-results-truncated"),
    diagnostic,
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

function hasOptionPrefix(value: string): boolean {
  return value.length > 1 && value.startsWith("-");
}

function parseNoOptionPaths(
  invocation: CommandInvocation,
  usage: string,
  minimum: number,
  maximum: number,
): OptionParseResult<ReadonlyArray<string>> {
  const boundary = optionBoundary(invocation);

  for (const value of invocation.arguments.slice(0, boundary)) {
    if (hasOptionPrefix(value)) {
      return { kind: "invalid", message: `Unsupported option: ${value}.` };
    }
  }

  if (
    invocation.arguments.length < minimum ||
    invocation.arguments.length > maximum
  ) {
    return { kind: "invalid", message: `Usage: ${usage}` };
  }

  return { kind: "parsed", value: invocation.arguments };
}

function parseLsOptions(
  invocation: CommandInvocation,
): OptionParseResult<LsOptions> {
  const boundary = optionBoundary(invocation);
  let showAll = false;
  let long = false;
  let tree = false;
  const operands: string[] = [];

  for (let index = 0; index < invocation.arguments.length; index += 1) {
    const value = invocation.arguments[index];

    if (value === undefined) {
      continue;
    }

    if (index >= boundary || !hasOptionPrefix(value)) {
      operands.push(value);
      continue;
    }

    if (value === "--tree") {
      tree = true;
      continue;
    }

    for (const flag of value.slice(1)) {
      if (flag === "a") {
        showAll = true;
        continue;
      }

      if (flag === "l") {
        long = true;
        continue;
      }

      return { kind: "invalid", message: `Unsupported option: -${flag}.` };
    }
  }

  if (long && tree) {
    return {
      kind: "invalid",
      message: "Unsupported option combination: -l and --tree.",
    };
  }

  if (operands.length > 1) {
    return {
      kind: "invalid",
      message: "Usage: ls [-a] [-l] [--tree] [path]",
    };
  }

  return {
    kind: "parsed",
    value: { showAll, long, tree, path: operands[0] ?? "." },
  };
}

function parseMaximumDepth(value: string): number | undefined {
  if (!/^(0|[1-9][0-9]*)$/u.test(value)) {
    return undefined;
  }

  const maximumDepth = Number(value);

  return Number.isSafeInteger(maximumDepth) &&
    maximumDepth <= maximumRecursiveDepth
    ? maximumDepth
    : undefined;
}

function parseTreeOptions(
  invocation: CommandInvocation,
): OptionParseResult<TreeOptions> {
  const boundary = optionBoundary(invocation);
  let showAll = false;
  let maximumDepth = maximumRecursiveDepth;
  const operands: string[] = [];

  for (let index = 0; index < invocation.arguments.length; index += 1) {
    const value = invocation.arguments[index];

    if (value === undefined) {
      continue;
    }

    if (index >= boundary || !hasOptionPrefix(value)) {
      operands.push(value);
      continue;
    }

    if (value === "-a") {
      showAll = true;
      continue;
    }

    if (value !== "-L") {
      return { kind: "invalid", message: `Unsupported option: ${value}.` };
    }

    const depthValue = invocation.arguments[index + 1];
    const parsedDepth =
      depthValue === undefined ? undefined : parseMaximumDepth(depthValue);

    if (parsedDepth === undefined) {
      return {
        kind: "invalid",
        message: `-L requires a depth from 0 to ${maximumRecursiveDepth}.`,
      };
    }

    maximumDepth = parsedDepth;
    index += 1;
  }

  if (operands.length > 1) {
    return { kind: "invalid", message: "Usage: tree [-a] [-L depth] [path]" };
  }

  return {
    kind: "parsed",
    value: { showAll, maximumDepth, path: operands[0] ?? "." },
  };
}

function parseFindOptions(
  invocation: CommandInvocation,
): OptionParseResult<FindOptions> {
  const boundary = optionBoundary(invocation);
  let pattern = "*";
  const operands: string[] = [];

  for (let index = 0; index < invocation.arguments.length; index += 1) {
    const value = invocation.arguments[index];

    if (value === undefined) {
      continue;
    }

    if (index >= boundary || !hasOptionPrefix(value)) {
      operands.push(value);
      continue;
    }

    if (value !== "-name") {
      return { kind: "invalid", message: `Unsupported option: ${value}.` };
    }

    const next = invocation.arguments[index + 1];

    if (next === undefined) {
      return { kind: "invalid", message: "-name requires a pattern." };
    }

    pattern = next;
    index += 1;
  }

  if (operands.length > 1) {
    return { kind: "invalid", message: "Usage: find [path] [-name pattern]" };
  }

  return { kind: "parsed", value: { pattern, path: operands[0] ?? "." } };
}

function parseGrepOptions(
  invocation: CommandInvocation,
): OptionParseResult<GrepOptions> {
  const boundary = optionBoundary(invocation);
  let ignoreCase = false;
  let lineNumbers = false;
  const operands: string[] = [];

  for (let index = 0; index < invocation.arguments.length; index += 1) {
    const value = invocation.arguments[index];

    if (value === undefined) {
      continue;
    }

    if (index >= boundary || !hasOptionPrefix(value)) {
      operands.push(value);
      continue;
    }

    for (const flag of value.slice(1)) {
      if (flag === "i") {
        ignoreCase = true;
        continue;
      }

      if (flag === "n") {
        lineNumbers = true;
        continue;
      }

      return { kind: "invalid", message: `Unsupported option: -${flag}.` };
    }
  }

  const pattern = operands[0];

  if (pattern === undefined || operands.length > 2) {
    return { kind: "invalid", message: "Usage: grep [-i] [-n] <pattern> [path]" };
  }

  return {
    kind: "parsed",
    value: {
      ignoreCase,
      lineNumbers,
      pattern,
      path: operands[1] ?? ".",
    },
  };
}

function parseLineReaderOptions(
  invocation: CommandInvocation,
  commandName: "head" | "tail",
): OptionParseResult<LineReaderOptions> {
  const boundary = optionBoundary(invocation);
  let lineCount = 10;
  const operands: string[] = [];

  for (let index = 0; index < invocation.arguments.length; index += 1) {
    const value = invocation.arguments[index];

    if (value === undefined) {
      continue;
    }

    if (index >= boundary || !hasOptionPrefix(value)) {
      operands.push(value);
      continue;
    }

    if (value !== "-n") {
      return { kind: "invalid", message: `Unsupported option: ${value}.` };
    }

    const countValue = invocation.arguments[index + 1];

    if (countValue === undefined || !/^[0-9]+$/u.test(countValue)) {
      return { kind: "invalid", message: "-n requires a non-negative line count." };
    }

    const parsedCount = Number(countValue);

    if (
      !Number.isSafeInteger(parsedCount) ||
      parsedCount > maximumRequestedLineCount
    ) {
      return {
        kind: "invalid",
        message: `-n must be at most ${maximumRequestedLineCount}.`,
      };
    }

    lineCount = parsedCount;
    index += 1;
  }

  if (operands.length !== 1) {
    return {
      kind: "invalid",
      message: `Usage: ${commandName} [-n count] <path>`,
    };
  }

  const path = operands[0];

  if (path === undefined) {
    return {
      kind: "invalid",
      message: `Usage: ${commandName} [-n count] <path>`,
    };
  }

  return { kind: "parsed", value: { lineCount, path } };
}

function displayEntry(node: VirtualNode): DisplayEntry {
  switch (node.kind) {
    case "directory":
      return {
        kind: "directory",
        name: `${node.name}/`,
        size: node.size,
        updatedAt: node.updatedAt,
      };
    case "file":
      return {
        kind: "file",
        name: node.name,
        size: node.size,
        updatedAt: node.updatedAt,
      };
    case "locked-file":
      return {
        kind: "locked-file",
        name: `${node.name} [locked]`,
        size: node.size,
        updatedAt: node.updatedAt,
      };
  }
}

function displayEntries(
  directory: VirtualDirectoryNode,
  entries: ReadonlyArray<VirtualNode>,
  showAll: boolean,
): ReadonlyArray<DisplayEntry> {
  const visible = entries.filter((entry) => showAll || !entry.name.startsWith("."));
  const mapped: DisplayEntry[] = [];

  if (showAll) {
    mapped.push({
      kind: "directory",
      name: "./",
      size: directory.size,
      updatedAt: directory.updatedAt,
    });
    mapped.push({
      kind: "directory",
      name: "../",
      size: directory.size,
      updatedAt: directory.updatedAt,
    });
  }

  for (const entry of visible) {
    mapped.push(displayEntry(entry));
  }

  return mapped;
}

function listingPermissions(entry: DisplayEntry): string {
  switch (entry.kind) {
    case "directory":
      return "dr-xr-xr-x";
    case "file":
      return "-r--r--r--";
    case "locked-file":
      return "----------";
  }
}

function utcModificationTime(value: string): string {
  return value.replace(".000Z", " UTC");
}

function formatLongListing(entries: ReadonlyArray<DisplayEntry>): string {
  const rows = entries.map((entry) => ({
    permissions: listingPermissions(entry),
    size: String(entry.size),
    updatedAt: utcModificationTime(entry.updatedAt),
    name: entry.name,
  }));
  const sizeWidth = Math.max(1, ...rows.map((row) => row.size.length));
  const updatedAtWidth = Math.max(
    1,
    ...rows.map((row) => row.updatedAt.length),
  );

  return rows
    .map(
      (row) =>
        `${row.permissions} ${row.size.padStart(sizeWidth)} ${row.updatedAt.padEnd(updatedAtWidth)} ${row.name}`,
    )
    .join("\n");
}

async function readFile(
  commandName: string,
  filesystem: VirtualFilesystem,
  documents: VirtualDocumentSupplier,
  context: CommandExecutionContext,
  path: string,
): Promise<ReadFileResult> {
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
    return {
      kind: "failed",
      outcome: rejectedOutcome(commandName, `Expected a file: ${resolution.path}`),
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
    kind: "read",
    file: resolution.node,
    text: document.document.text,
    sourcePath: document.document.source.path,
  };
}

function wildcardMatches(pattern: string, value: string): boolean {
  let patternIndex = 0;
  let valueIndex = 0;
  let starIndex = -1;
  let matchedAfterStar = 0;

  while (valueIndex < value.length) {
    const patternCharacter = pattern[patternIndex];

    if (patternCharacter === "?" || patternCharacter === value[valueIndex]) {
      patternIndex += 1;
      valueIndex += 1;
      continue;
    }

    if (patternCharacter === "*") {
      starIndex = patternIndex;
      patternIndex += 1;
      matchedAfterStar = valueIndex;
      continue;
    }

    if (starIndex === -1) {
      return false;
    }

    patternIndex = starIndex + 1;
    matchedAfterStar += 1;
    valueIndex = matchedAfterStar;
  }

  while (pattern[patternIndex] === "*") {
    patternIndex += 1;
  }

  return patternIndex === pattern.length;
}

function treeLines(
  directory: VirtualDirectoryNode,
  traversal: Extract<VirtualTraversalResult, { kind: "completed" | "truncated" }>,
  showAll: boolean,
): string {
  const lines: string[] = [directory.path];

  for (const entry of traversal.entries) {
    if (!showAll && entry.node.name.startsWith(".")) {
      continue;
    }

    const indentation = "  ".repeat(Math.max(0, entry.depth - 1));
    const suffix = entry.node.kind === "directory" ? "/" : "";
    const locked = entry.node.kind === "locked-file" ? " [locked]" : "";
    lines.push(`${indentation}└── ${entry.node.name}${suffix}${locked}`);
  }

  return lines.join("\n");
}

function executeTree(
  filesystem: VirtualFilesystem,
  context: CommandExecutionContext,
  recursiveEntryLimit: number,
  options: TreeExecutionOptions,
): CommandOutcome {
  const resolution = resolveVirtualDirectory(
    filesystem,
    context.currentDirectory,
    options.path,
  );

  if (resolution.kind !== "found") {
    return failureOutcome(options.commandName, resolution);
  }

  const traversal = traverseVirtualDirectory({
    filesystem,
    directory: resolution.directory,
    limit: recursiveEntryLimit,
    maximumDepth: options.maximumDepth,
    signal: context.signal,
  });

  if (traversal.kind === "cancelled") {
    return cancelledOutcome();
  }

  const outputs: ShellOutput[] = [
    textOutput(
      `${options.commandName}-output`,
      treeLines(resolution.directory, traversal, options.showAll),
    ),
  ];

  if (traversal.kind === "truncated") {
    outputs.push(truncationOutput(options.commandName, recursiveEntryLimit));
  }

  return succeededOutcome(outputs);
}

function selectedFiles(
  filesystem: VirtualFilesystem,
  context: CommandExecutionContext,
  path: string,
  recursiveEntryLimit: number,
): GrepFileSelection {
  const resolution = resolveVirtualPath(
    filesystem,
    context.currentDirectory,
    path,
  );

  if (resolution.kind !== "found") {
    return { kind: "failed", outcome: failureOutcome("grep", resolution) };
  }

  if (resolution.node.kind === "file") {
    return { kind: "files", files: [resolution.node], truncated: false };
  }

  if (resolution.node.kind === "locked-file") {
    return {
      kind: "failed",
      outcome: rejectedOutcome("grep", `Access is locked: ${resolution.path}`),
    };
  }

  const traversal = traverseVirtualDirectory({
    filesystem,
    directory: resolution.node,
    limit: recursiveEntryLimit,
    maximumDepth: maximumRecursiveDepth,
    signal: context.signal,
  });

  if (traversal.kind === "cancelled") {
    return { kind: "cancelled" };
  }

  return {
    kind: "files",
    files: traversal.entries.flatMap((entry) =>
      entry.node.kind === "file" ? [entry.node] : [],
    ),
    truncated: traversal.kind === "truncated",
  };
}

function createLsCommand(
  filesystem: VirtualFilesystem,
  recursiveEntryLimit: number,
): CommandDefinition {
  return {
    metadata: {
      group: "gnu-like",
      name: "ls",
      aliases: [],
      summary: "List virtual files and directories.",
      usage: "ls [-a] [-l] [--tree] [path]",
      examples: ["ls", "ls -l projects", "ls --tree projects", "ls -a --tree"],
    },
    execute: async (invocation, context) => {
      const parsed = parseLsOptions(invocation);

      if (parsed.kind === "invalid") {
        return rejectedOutcome("ls", parsed.message);
      }

      if (parsed.value.tree) {
        return executeTree(filesystem, context, recursiveEntryLimit, {
          commandName: "ls",
          showAll: parsed.value.showAll,
          maximumDepth: maximumRecursiveDepth,
          path: parsed.value.path,
        });
      }

      const resolution = resolveVirtualPath(
        filesystem,
        context.currentDirectory,
        parsed.value.path,
      );

      if (resolution.kind !== "found") {
        return failureOutcome("ls", resolution);
      }

      if (resolution.node.kind === "locked-file") {
        return rejectedOutcome("ls", `Access is locked: ${resolution.path}`);
      }

      const entries =
        resolution.node.kind === "directory"
          ? listVirtualDirectory(
              filesystem,
              context.currentDirectory,
              parsed.value.path,
            )
          : undefined;

      if (entries !== undefined && entries.kind !== "found") {
        return failureOutcome("ls", entries);
      }

      const display =
        resolution.node.kind === "directory"
          ? displayEntries(
              resolution.node,
              entries?.entries ?? [],
              parsed.value.showAll,
            )
          : [displayEntry(resolution.node)];
      const output = parsed.value.long
        ? textOutput("ls-output", formatLongListing(display))
        : textOutput(
            "ls-output",
            display.map((entry) => entry.name).join("\n"),
          );

      return succeededOutcome([output]);
    },
  };
}

function createCdCommand(filesystem: VirtualFilesystem): CommandDefinition {
  return {
    metadata: {
      group: "gnu-like",
      name: "cd",
      aliases: [],
      summary: "Change this shell pane's virtual directory.",
      usage: "cd [path]",
      examples: ["cd projects", "cd .."],
    },
    execute: async (invocation, context) => {
      const parsed = parseNoOptionPaths(invocation, "cd [path]", 0, 1);

      if (parsed.kind === "invalid") {
        return rejectedOutcome("cd", parsed.message);
      }

      const resolution = resolveVirtualDirectory(
        filesystem,
        context.currentDirectory,
        parsed.value[0] ?? "~",
      );

      if (resolution.kind !== "found") {
        return failureOutcome("cd", resolution);
      }

      return succeededOutcome([], [
        { kind: "set-current-directory", directory: resolution.directory.path },
      ]);
    },
  };
}

function createCatCommand(
  filesystem: VirtualFilesystem,
  documents: VirtualDocumentSupplier,
): CommandDefinition {
  return {
    metadata: {
      group: "gnu-like",
      name: "cat",
      aliases: [],
      summary: "Print raw virtual document content.",
      usage: "cat <path> [path ...]",
      examples: ["cat about.md"],
    },
    execute: async (invocation, context) => {
      const parsed = parseNoOptionPaths(invocation, "cat <path> [path ...]", 1, 32);

      if (parsed.kind === "invalid") {
        return rejectedOutcome("cat", parsed.message);
      }

      const outputs: ShellOutput[] = [];

      for (const path of parsed.value) {
        const result = await readFile("cat", filesystem, documents, context, path);

        if (result.kind === "cancelled") {
          return cancelledOutcome();
        }

        if (result.kind === "failed") {
          return result.outcome;
        }

        outputs.push(textOutput(`cat-${result.file.id}`, result.text));
      }

      return succeededOutcome(outputs);
    },
  };
}

function createPwdCommand(): CommandDefinition {
  return {
    metadata: {
      group: "gnu-like",
      name: "pwd",
      aliases: [],
      summary: "Print this shell pane's virtual directory.",
      usage: "pwd",
      examples: ["pwd"],
    },
    execute: async (invocation, context) => {
      const parsed = parseNoOptionPaths(invocation, "pwd", 0, 0);

      return parsed.kind === "invalid"
        ? rejectedOutcome("pwd", parsed.message)
        : succeededOutcome([textOutput("pwd-output", context.currentDirectory)]);
    },
  };
}

function createTreeCommand(
  filesystem: VirtualFilesystem,
  recursiveEntryLimit: number,
): CommandDefinition {
  return {
    metadata: {
      group: "gnu-like",
      name: "tree",
      aliases: [],
      summary: "Render a bounded virtual directory tree.",
      usage: "tree [-a] [-L depth] [path]",
      examples: ["tree", "tree -L 1 projects"],
    },
    execute: async (invocation, context) => {
      const parsed = parseTreeOptions(invocation);

      if (parsed.kind === "invalid") {
        return rejectedOutcome("tree", parsed.message);
      }

      return executeTree(filesystem, context, recursiveEntryLimit, {
        commandName: "tree",
        showAll: parsed.value.showAll,
        maximumDepth: parsed.value.maximumDepth,
        path: parsed.value.path,
      });
    },
  };
}

function createFindCommand(
  filesystem: VirtualFilesystem,
  recursiveEntryLimit: number,
): CommandDefinition {
  return {
    metadata: {
      group: "gnu-like",
      name: "find",
      aliases: [],
      summary: "Find virtual paths by a simple wildcard name pattern.",
      usage: "find [path] [-name pattern]",
      examples: ["find -name '*.md'", "find projects -name '*project*'"],
    },
    execute: async (invocation, context) => {
      const parsed = parseFindOptions(invocation);

      if (parsed.kind === "invalid") {
        return rejectedOutcome("find", parsed.message);
      }

      const resolution = resolveVirtualDirectory(
        filesystem,
        context.currentDirectory,
        parsed.value.path,
      );

      if (resolution.kind !== "found") {
        return failureOutcome("find", resolution);
      }

      const traversal = traverseVirtualDirectory({
        filesystem,
        directory: resolution.directory,
        limit: recursiveEntryLimit,
        maximumDepth: maximumRecursiveDepth,
        signal: context.signal,
      });

      if (traversal.kind === "cancelled") {
        return cancelledOutcome();
      }

      const matches = [
        ...(wildcardMatches(parsed.value.pattern, resolution.directory.name)
          ? [resolution.directory.path]
          : []),
        ...traversal.entries
          .filter((entry) => wildcardMatches(parsed.value.pattern, entry.node.name))
          .map((entry) => entry.node.path),
      ];
      const outputs: ShellOutput[] =
        matches.length === 0 ? [] : [textOutput("find-output", matches.join("\n"))];

      if (traversal.kind === "truncated") {
        outputs.push(truncationOutput("find", recursiveEntryLimit));
      }

      return succeededOutcome(outputs);
    },
  };
}

function createGrepCommand(
  filesystem: VirtualFilesystem,
  documents: VirtualDocumentSupplier,
  recursiveEntryLimit: number,
): CommandDefinition {
  return {
    metadata: {
      group: "gnu-like",
      name: "grep",
      aliases: [],
      summary: "Search raw virtual document text.",
      usage: "grep [-i] [-n] <pattern> [path]",
      examples: ["grep -n fixture about.md", "grep -i typed"],
    },
    execute: async (invocation, context) => {
      const parsed = parseGrepOptions(invocation);

      if (parsed.kind === "invalid") {
        return rejectedOutcome("grep", parsed.message);
      }

      const selection = selectedFiles(
        filesystem,
        context,
        parsed.value.path,
        recursiveEntryLimit,
      );

      if (selection.kind === "cancelled") {
        return cancelledOutcome();
      }

      if (selection.kind === "failed") {
        return selection.outcome;
      }

      const pattern = parsed.value.ignoreCase
        ? parsed.value.pattern.toLowerCase()
        : parsed.value.pattern;
      const matches: string[] = [];

      for (const file of selection.files) {
        const document = await readFile(
          "grep",
          filesystem,
          documents,
          context,
          file.path,
        );

        if (document.kind === "cancelled") {
          return cancelledOutcome();
        }

        if (document.kind === "failed") {
          return document.outcome;
        }

        const lines = document.text.split("\n");

        for (let index = 0; index < lines.length; index += 1) {
          if (context.signal.aborted) {
            return cancelledOutcome();
          }

          const line = lines[index];

          if (line === undefined) {
            continue;
          }

          const candidate = parsed.value.ignoreCase ? line.toLowerCase() : line;

          if (!candidate.includes(pattern)) {
            continue;
          }

          const linePrefix = parsed.value.lineNumbers ? `:${index + 1}` : "";
          matches.push(`${document.sourcePath}${linePrefix}:${line}`);
        }
      }

      const outputs: ShellOutput[] =
        matches.length === 0 ? [] : [textOutput("grep-output", matches.join("\n"))];

      if (selection.truncated) {
        outputs.push(truncationOutput("grep", recursiveEntryLimit));
      }

      return succeededOutcome(outputs);
    },
  };
}

function createLineReaderCommand(
  commandName: "head" | "tail",
  fromEnd: boolean,
  filesystem: VirtualFilesystem,
  documents: VirtualDocumentSupplier,
): CommandDefinition {
  return {
    metadata: {
      group: "gnu-like",
      name: commandName,
      aliases: [],
      summary: fromEnd
        ? "Print final raw document lines."
        : "Print initial raw document lines.",
      usage: `${commandName} [-n count] <path>`,
      examples: [`${commandName} -n 3 about.md`],
    },
    execute: async (invocation, context) => {
      const parsed = parseLineReaderOptions(invocation, commandName);

      if (parsed.kind === "invalid") {
        return rejectedOutcome(commandName, parsed.message);
      }

      const document = await readFile(
        commandName,
        filesystem,
        documents,
        context,
        parsed.value.path,
      );

      if (document.kind === "cancelled") {
        return cancelledOutcome();
      }

      if (document.kind === "failed") {
        return document.outcome;
      }

      const lines = document.text.split("\n");
      const selected = fromEnd
        ? lines.slice(Math.max(0, lines.length - parsed.value.lineCount))
        : lines.slice(0, parsed.value.lineCount);

      return succeededOutcome([
        textOutput(`${commandName}-output`, selected.join("\n")),
      ]);
    },
  };
}

function createLessCommand(
  filesystem: VirtualFilesystem,
  documents: VirtualDocumentSupplier,
): CommandDefinition {
  return {
    metadata: {
      group: "gnu-like",
      name: "less",
      aliases: [],
      summary: "Open raw virtual document text in a pager.",
      usage: "less <path>",
      examples: ["less notes/sample-note.md"],
    },
    execute: async (invocation, context) => {
      const parsed = parseNoOptionPaths(invocation, "less <path>", 1, 1);

      if (parsed.kind === "invalid") {
        return rejectedOutcome("less", parsed.message);
      }

      const path = parsed.value[0];

      if (path === undefined) {
        return rejectedOutcome("less", "Usage: less <path>");
      }

      const document = await readFile("less", filesystem, documents, context, path);

      if (document.kind === "cancelled") {
        return cancelledOutcome();
      }

      if (document.kind === "failed") {
        return document.outcome;
      }

      return succeededOutcome([], [
        {
          kind: "open-viewer",
          viewer: createDocumentViewerContent({
            title: document.file.name,
            presentation: "raw-pager",
            document: {
              text: document.text,
              source: { path: document.sourcePath },
            },
          }),
          disposition: { kind: "inline" },
        },
      ]);
    },
  };
}

function createClearCommand(): CommandDefinition {
  return {
    metadata: {
      group: "gnu-like",
      name: "clear",
      aliases: [],
      summary: "Clear terminal scrollback.",
      usage: "clear",
      examples: ["clear"],
    },
    execute: async (invocation) => {
      const parsed = parseNoOptionPaths(invocation, "clear", 0, 0);

      return parsed.kind === "invalid"
        ? rejectedOutcome("clear", parsed.message)
        : succeededOutcome([], [{ kind: "clear-scrollback" }]);
    },
  };
}

function formatHistoryEntries(
  entries: CommandExecutionContext["commandHistory"],
): string {
  const numberWidth = Math.max(1, String(entries.length).length);

  return entries
    .map(
      (entry, index) =>
        `${String(index + 1).padStart(numberWidth)}  ${entry.source}`,
    )
    .join("\n");
}

function manualHeader(name: string): string {
  const label = `${name.toUpperCase()}(1)`;

  return `${label.padEnd(28)}TERMIN.AL${label.padStart(28)}`;
}

function manualSection(
  title: string,
  lines: ReadonlyArray<string>,
): string {
  return [title, ...lines.map((line) => `       ${line}`)].join("\n");
}

function formatTerminalManualPage(metadata: CommandMetadata): string {
  const sections = [
    manualSection("NAME", [`${metadata.name} - ${metadata.summary}`]),
    manualSection("SYNOPSIS", [metadata.usage]),
    manualSection("DESCRIPTION", [metadata.summary]),
  ];

  if (metadata.usage.includes("[")) {
    sections.push(
      manualSection("OPTIONS", ["Supported options are shown in SYNOPSIS."]),
    );
  }

  if (metadata.aliases.length > 0) {
    sections.push(manualSection("ALIASES", [metadata.aliases.join(", ")]));
  }

  if (metadata.examples.length > 0) {
    sections.push(
      manualSection(
        "EXAMPLES",
        metadata.examples.map((example) => `$ ${example}`),
      ),
    );
  }

  sections.push(manualSection("SEE ALSO", ["help(1), man(1)"]));

  const header = manualHeader(metadata.name);

  return [header, "", ...sections.flatMap((section) => [section, ""]), header].join(
    "\n",
  );
}

function createHistoryCommand(): CommandDefinition {
  return {
    metadata: {
      group: "gnu-like",
      name: "history",
      aliases: [],
      summary: "Show this shell pane's bounded command history.",
      usage: "history",
      examples: ["history"],
    },
    execute: async (invocation, context) => {
      const parsed = parseNoOptionPaths(invocation, "history", 0, 0);

      if (parsed.kind === "invalid") {
        return rejectedOutcome("history", parsed.message);
      }

      return succeededOutcome([
        textOutput("history-output", formatHistoryEntries(context.commandHistory)),
      ]);
    },
  };
}

function createManCommand(): CommandDefinition {
  return {
    metadata: {
      group: "gnu-like",
      name: "man",
      aliases: [],
      summary: "Show command metadata.",
      usage: "man <command>",
      examples: ["man grep"],
    },
    execute: async (invocation, context) => {
      const parsed = parseNoOptionPaths(invocation, "man <command>", 1, 1);

      if (parsed.kind === "invalid") {
        return rejectedOutcome("man", parsed.message);
      }

      const commandName = parsed.value[0];

      if (commandName === undefined) {
        return rejectedOutcome("man", "Usage: man <command>");
      }

      const resolution = resolveCommand(context.registry, commandName);

      if (resolution.kind === "missing") {
        return rejectedOutcome("man", `No manual entry for ${commandName}.`);
      }

      const metadata = resolution.command.metadata;

      return succeededOutcome([
        textOutput("man-output", formatTerminalManualPage(metadata)),
      ]);
    },
  };
}

function createEchoCommand(): CommandDefinition {
  return {
    metadata: {
      group: "gnu-like",
      name: "echo",
      aliases: [],
      summary: "Print arguments as text.",
      usage: "echo [text ...]",
      examples: ["echo 'hello terminal'"],
    },
    execute: async (invocation) =>
      succeededOutcome([textOutput("echo-output", invocation.arguments.join(" "))]),
  };
}

function createWhoamiCommand(): CommandDefinition {
  return {
    metadata: {
      group: "gnu-like",
      name: "whoami",
      aliases: [],
      summary: "Show the current development capability.",
      usage: "whoami",
      examples: ["whoami"],
    },
    execute: async (invocation) => {
      const parsed = parseNoOptionPaths(invocation, "whoami", 0, 0);

      return parsed.kind === "invalid"
        ? rejectedOutcome("whoami", parsed.message)
        : succeededOutcome([textOutput("whoami-output", "anonymous")]);
    },
  };
}

export function createReadOnlyCommandDefinitions({
  filesystem,
  documents,
  recursiveEntryLimit,
}: CreateReadOnlyCommandDefinitionsOptions): ReadonlyArray<CommandDefinition> {
  if (!Number.isSafeInteger(recursiveEntryLimit) || recursiveEntryLimit < 1) {
    throw new Error("Recursive command limits must be positive safe integers.");
  }

  return [
    createLsCommand(filesystem, recursiveEntryLimit),
    createCdCommand(filesystem),
    createCatCommand(filesystem, documents),
    createPwdCommand(),
    createTreeCommand(filesystem, recursiveEntryLimit),
    createFindCommand(filesystem, recursiveEntryLimit),
    createGrepCommand(filesystem, documents, recursiveEntryLimit),
    createLineReaderCommand("head", false, filesystem, documents),
    createLineReaderCommand("tail", true, filesystem, documents),
    createLessCommand(filesystem, documents),
    createClearCommand(),
    createHistoryCommand(),
    createManCommand(),
    createEchoCommand(),
    createWhoamiCommand(),
  ];
}
