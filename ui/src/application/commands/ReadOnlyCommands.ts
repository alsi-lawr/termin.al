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
  createShellOutputPartId,
  type CommandEffect,
  type CommandOutcome,
  type ShellDiagnostic,
  type ShellOutput,
  type ShellTableColumn,
  type ShellTableRow,
} from "../../domain/terminal/Shell.ts";
import {
  resolveCommand,
  type CommandDefinition,
  type CommandExecutionContext,
  type CommandInvocation,
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
  path: string;
}>;

type TreeOptions = Readonly<{
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
  name: string;
  size: string;
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
    failure: { kind: "execution-error", commandName },
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

  if (operands.length > 1) {
    return { kind: "invalid", message: "Usage: ls [-a] [-l] [path]" };
  }

  return {
    kind: "parsed",
    value: { showAll, long, path: operands[0] ?? "." },
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

function displayEntry(node: VirtualDirectoryNode | VirtualFileNode): DisplayEntry {
  return {
    name: node.kind === "directory" ? `${node.name}/` : node.name,
    size: String(node.size),
    updatedAt: node.updatedAt,
  };
}

function displayLockedEntry(name: string, updatedAt: string): DisplayEntry {
  return { name: `${name} [locked]`, size: "0", updatedAt };
}

function displayEntries(
  directory: VirtualDirectoryNode,
  entries: ReadonlyArray<VirtualNode>,
  showAll: boolean,
): ReadonlyArray<DisplayEntry> {
  const visible = entries.filter((entry) => showAll || !entry.name.startsWith("."));
  const mapped: DisplayEntry[] = [];

  if (showAll) {
    mapped.push({ name: ".", size: "0", updatedAt: directory.updatedAt });
    mapped.push({ name: "..", size: "0", updatedAt: directory.updatedAt });
  }

  for (const entry of visible) {
    if (entry.kind === "locked-file") {
      mapped.push(displayLockedEntry(entry.name, entry.updatedAt));
      continue;
    }

    mapped.push(displayEntry(entry));
  }

  return mapped;
}

function longListingOutput(entries: ReadonlyArray<DisplayEntry>): ShellOutput {
  const columns: ReadonlyArray<ShellTableColumn> = [
    { id: createShellOutputPartId("ls-name"), label: "Name" },
    { id: createShellOutputPartId("ls-size"), label: "Size" },
    { id: createShellOutputPartId("ls-updated"), label: "Updated" },
  ];
  const rows: ReadonlyArray<ShellTableRow> = entries.map((entry, index) => ({
    id: createShellOutputPartId(`ls-row-${index}`),
    cells: [
      {
        id: createShellOutputPartId(`ls-name-${index}`),
        columnId: createShellOutputPartId("ls-name"),
        value: entry.name,
      },
      {
        id: createShellOutputPartId(`ls-size-${index}`),
        columnId: createShellOutputPartId("ls-size"),
        value: entry.size,
      },
      {
        id: createShellOutputPartId(`ls-updated-${index}`),
        columnId: createShellOutputPartId("ls-updated"),
        value: entry.updatedAt,
      },
    ],
  }));

  return { kind: "table", id: createShellOutputId("ls-output"), columns, rows };
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

  try {
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
  } catch {
    return { kind: "failed", outcome: unavailableContentOutcome(commandName) };
  }
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
): CommandDefinition {
  return {
    metadata: {
      group: "gnu-like",
      name: "ls",
      aliases: [],
      summary: "List virtual files and directories.",
      usage: "ls [-a] [-l] [path]",
      examples: ["ls", "ls -l projects"],
    },
    execute: async (invocation, context) => {
      const parsed = parseLsOptions(invocation);

      if (parsed.kind === "invalid") {
        return rejectedOutcome("ls", parsed.message);
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
        ? longListingOutput(display)
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
      examples: ["cat about.md", "cat projects/sample-project.md"],
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

      const resolution = resolveVirtualDirectory(
        filesystem,
        context.currentDirectory,
        parsed.value.path,
      );

      if (resolution.kind !== "found") {
        return failureOutcome("tree", resolution);
      }

      const traversal = traverseVirtualDirectory({
        filesystem,
        directory: resolution.directory,
        limit: recursiveEntryLimit,
        maximumDepth: parsed.value.maximumDepth,
        signal: context.signal,
      });

      if (traversal.kind === "cancelled") {
        return cancelledOutcome();
      }

      const outputs: ShellOutput[] = [
        textOutput(
          "tree-output",
          treeLines(resolution.directory, traversal, parsed.value.showAll),
        ),
      ];

      if (traversal.kind === "truncated") {
        outputs.push(truncationOutput("tree", recursiveEntryLimit));
      }

      return succeededOutcome(outputs);
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

      const numberColumn = createShellOutputPartId("history-number");
      const commandColumn = createShellOutputPartId("history-command");

      return succeededOutcome([
        {
          kind: "table",
          id: createShellOutputId("history-output"),
          columns: [
            { id: numberColumn, label: "#" },
            { id: commandColumn, label: "Command" },
          ],
          rows: context.commandHistory.map((entry, index) => ({
            id: createShellOutputPartId(`history-row-${entry.id}`),
            cells: [
              {
                id: createShellOutputPartId(`history-number-${entry.id}`),
                columnId: numberColumn,
                value: String(index + 1),
              },
              {
                id: createShellOutputPartId(`history-command-${entry.id}`),
                columnId: commandColumn,
                value: entry.source,
              },
            ],
          })),
        },
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
        {
          kind: "rich",
          id: createShellOutputId("man-output"),
          title: `${metadata.name} manual`,
          fields: [
            {
              id: createShellOutputPartId("man-synopsis"),
              label: "Synopsis",
              value: metadata.usage,
            },
            {
              id: createShellOutputPartId("man-description"),
              label: "Description",
              value: metadata.summary,
            },
            {
              id: createShellOutputPartId("man-examples"),
              label: "Examples",
              value: metadata.examples.join("\n"),
            },
          ],
        },
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
    createLsCommand(filesystem),
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
