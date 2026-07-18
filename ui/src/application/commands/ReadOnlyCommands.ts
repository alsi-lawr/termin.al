import {
  listVirtualDirectory,
  matchesVirtualPathGlob,
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
  type VirtualTraversalEntry,
} from "../../domain/filesystem/VirtualFilesystem.ts";
import { createDocumentViewerContent } from "../../content/ViewerContent.ts";
import type { ManpageCorpus } from "../../content/ManpageCorpus.ts";
import { ContentId } from "../../api/ContentContracts.ts";
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
} from "./CommandRegistry.ts";
import {
  applyTextSubstitution,
  parseTextSubstitution,
  type TextSubstitution,
} from "../../domain/text/TextSubstitution.ts";

export type CreateReadOnlyCommandDefinitionsOptions = Readonly<{
  filesystem: VirtualFilesystem;
  documents: VirtualDocumentSupplier;
  manpages: ManpageCorpus;
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

type LsDisplayMode =
  | Readonly<{
      kind: "list";
      format: "short" | "long";
    }>
  | Readonly<{ kind: "tree" }>;

type LsOptions = Readonly<{
  showAll: boolean;
  mode: LsDisplayMode;
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
  path: string;
  predicates: ReadonlyArray<FindPredicate>;
}>;

type FindPredicate =
  | Readonly<{ kind: "name"; pattern: string }>
  | Readonly<{ kind: "path"; pattern: string }>
  | Readonly<{ kind: "type"; nodeKind: "directory" | "file" }>
  | Readonly<{ kind: "maximum-depth"; depth: number }>
  | Readonly<{ kind: "minimum-depth"; depth: number }>;

type FindPredicateOption = "-name" | "-path" | "-type" | "-maxdepth" | "-mindepth";

type GrepOptions = Readonly<{
  caseSensitivity: "sensitive" | "insensitive";
  filenamePolicy: "automatic" | "include" | "suppress";
  lineNumbers: boolean;
  patternMode: "regular-expression" | "fixed";
  recursive: boolean;
  pattern: string;
  operands: ReadonlyArray<string>;
}>;

type LineReaderOptions = Readonly<{
  lineCount: number;
  input:
    | Readonly<{ kind: "path"; path: string }>
    | Readonly<{ kind: "stdin"; text: string }>;
}>;

type SedAddress =
  | Readonly<{ kind: "line"; number: number }>
  | Readonly<{ kind: "last" }>;

type SedAddressSelection =
  | Readonly<{ kind: "all" }>
  | Readonly<{ kind: "single"; address: SedAddress }>
  | Readonly<{ kind: "range"; start: SedAddress; end: SedAddress }>;

type SedScript = Readonly<{
  address: SedAddressSelection;
  command:
    | Readonly<{ kind: "print" }>
    | Readonly<{ kind: "delete" }>
    | Readonly<{ kind: "substitute"; substitution: TextSubstitution }>;
}>;

type SedOptions = Readonly<{
  suppressDefaultPrint: boolean;
  scripts: ReadonlyArray<SedScript>;
  input:
    | Readonly<{ kind: "paths"; paths: ReadonlyArray<string> }>
    | Readonly<{ kind: "stdin"; text: string }>;
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

type TextReadResult =
  | Readonly<{
      kind: "read";
      text: string;
      sourcePath: string;
    }>
  | Readonly<{
      kind: "failed";
      outcome: CommandOutcome;
    }>
  | Readonly<{ kind: "cancelled" }>;

type GrepFailure = Extract<CommandOutcome, { kind: "failed" }>;

type GrepPlannedInput =
  | Readonly<{ kind: "file"; file: VirtualFileNode }>
  | Readonly<{ kind: "stdin"; text: string }>
  | Readonly<{ kind: "failure"; failure: GrepFailure }>;

type GrepFilePlan =
  | Readonly<{
      kind: "planned";
      inputs: ReadonlyArray<GrepPlannedInput>;
      traversalTruncated: boolean;
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
const maximumGrepMatchingLines = 1000;
const maximumGrepOutputBytes = 1024 * 1024;
const maximumSedOutputLines = 1000;
const maximumSedOutputBytes = 1024 * 1024;

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

  const listFormat: "short" | "long" = long ? "long" : "short";
  const mode: LsDisplayMode = tree
    ? { kind: "tree" }
    : { kind: "list", format: listFormat };

  return {
    kind: "parsed",
    value: { showAll, mode, path: operands[0] ?? "." },
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

function parseFindPredicate(
  option: FindPredicateOption,
  value: string,
): OptionParseResult<FindPredicate> {
  if (option === "-name" || option === "-path") {
    return {
      kind: "parsed",
      value: { kind: option === "-name" ? "name" : "path", pattern: value },
    };
  }

  if (option === "-type") {
    return value === "f" || value === "d"
      ? {
          kind: "parsed",
          value: {
            kind: "type",
            nodeKind: value === "d" ? "directory" : "file",
          },
        }
      : { kind: "invalid", message: "-type requires f or d." };
  }

  const depth = parseMaximumDepth(value);

  return depth === undefined
    ? {
        kind: "invalid",
        message: `${option} requires a depth from 0 to ${maximumRecursiveDepth}.`,
      }
    : {
        kind: "parsed",
        value: {
          kind: option === "-maxdepth" ? "maximum-depth" : "minimum-depth",
          depth,
        },
      };
}

function parseFindOptions(
  invocation: CommandInvocation,
): OptionParseResult<FindOptions> {
  const boundary = optionBoundary(invocation);
  const operands: string[] = [];
  const predicates: FindPredicate[] = [];

  for (let index = 0; index < invocation.arguments.length; index += 1) {
    const value = invocation.arguments[index];

    if (value === undefined) {
      continue;
    }

    if (index >= boundary || !hasOptionPrefix(value)) {
      operands.push(value);
      continue;
    }

    if (value !== "-name" && value !== "-path" && value !== "-type" &&
      value !== "-maxdepth" && value !== "-mindepth") {
      return { kind: "invalid", message: `Unsupported option: ${value}.` };
    }

    const next = invocation.arguments[index + 1];

    if (next === undefined) {
      return { kind: "invalid", message: `${value} requires a value.` };
    }

    const predicate = parseFindPredicate(value, next);

    if (predicate.kind === "invalid") {
      return predicate;
    }

    predicates.push(predicate.value);
    index += 1;
  }

  if (operands.length > 1) {
    return {
      kind: "invalid",
      message: "Usage: find [path] [-name pattern] [-path pattern] [-type f|d] [-maxdepth depth] [-mindepth depth]",
    };
  }

  return {
    kind: "parsed",
    value: { path: operands[0] ?? ".", predicates },
  };
}

function parseGrepOptions(
  invocation: CommandInvocation,
): OptionParseResult<GrepOptions> {
  const boundary = optionBoundary(invocation);
  let caseSensitivity: GrepOptions["caseSensitivity"] = "sensitive";
  let filenamePolicy: GrepOptions["filenamePolicy"] = "automatic";
  let lineNumbers = false;
  let patternMode: GrepOptions["patternMode"] = "regular-expression";
  let recursive = false;
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
        caseSensitivity = "insensitive";
        continue;
      }

      if (flag === "n") {
        lineNumbers = true;
        continue;
      }

      if (flag === "r") {
        recursive = true;
        continue;
      }

      if (flag === "E") {
        return { kind: "invalid", message: "Unsupported option: -E." };
      }

      if (flag === "F") {
        patternMode = "fixed";
        continue;
      }

      if (flag === "H") {
        if (filenamePolicy === "suppress") {
          return { kind: "invalid", message: "Options -H and -h are mutually exclusive." };
        }

        filenamePolicy = "include";
        continue;
      }

      if (flag === "h") {
        if (filenamePolicy === "include") {
          return { kind: "invalid", message: "Options -H and -h are mutually exclusive." };
        }

        filenamePolicy = "suppress";
        continue;
      }

      return { kind: "invalid", message: `Unsupported option: -${flag}.` };
    }
  }

  const pattern = operands[0];

  if (
    pattern === undefined ||
    (operands.length < 2 && invocation.stdin.kind === "none")
  ) {
    return {
      kind: "invalid",
      message: "Usage: grep [-i] [-n] [-r] [-F] [-H|-h] [--] pattern [file ...]",
    };
  }

  return {
    kind: "parsed",
    value: {
      caseSensitivity,
      filenamePolicy,
      lineNumbers,
      patternMode,
      recursive,
      pattern,
      operands: operands.slice(1),
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

  if (operands.length > 1 || (operands.length === 0 && invocation.stdin.kind === "none")) {
    return {
      kind: "invalid",
      message: `Usage: ${commandName} [-n count] [path]`,
    };
  }

  const path = operands[0];

  if (path === undefined) {
    if (invocation.stdin.kind === "text") {
      return {
        kind: "parsed",
        value: {
          lineCount,
          input: { kind: "stdin", text: invocation.stdin.text },
        },
      };
    }

    return {
      kind: "invalid",
      message: `Usage: ${commandName} [-n count] [path]`,
    };
  }

  return {
    kind: "parsed",
    value: {
      lineCount,
      input: { kind: "path", path },
    },
  };
}

function sedAddress(source: string): SedAddress {
  if (source === "$") {
    return { kind: "last" };
  }

  const number = Number(source);
  return {
    kind: "line",
    number: Number.isSafeInteger(number) ? number : Number.MAX_SAFE_INTEGER,
  };
}

function sedAddressSelection(
  source: string,
): Readonly<{ selection: SedAddressSelection; commandOffset: number }> |
  Readonly<{ error: string }> {
  const match = /^(\$|[0-9]+)(?:,(\$|[0-9]+))?/u.exec(source);

  if (match === null) {
    return { selection: { kind: "all" }, commandOffset: 0 };
  }

  const start = match[1];
  const end = match[2];

  if (start === undefined) {
    return { error: `Malformed sed address: ${source}` };
  }

  if (end === undefined) {
    return {
      selection: { kind: "single", address: sedAddress(start) },
      commandOffset: match[0].length,
    };
  }

  return {
    selection: {
      kind: "range",
      start: sedAddress(start),
      end: sedAddress(end),
    },
    commandOffset: match[0].length,
  };
}

function parseSedScript(
  source: string,
  previousPattern: string | undefined,
): OptionParseResult<Readonly<{ script: SedScript; pattern: string | undefined }>> {
  const addressed = sedAddressSelection(source);

  if ("error" in addressed) {
    return { kind: "invalid", message: addressed.error };
  }

  const command = source.slice(addressed.commandOffset);

  if (command === "p" || command === "d") {
    return {
      kind: "parsed",
      value: {
        script: {
          address: addressed.selection,
          command: { kind: command === "p" ? "print" : "delete" },
        },
        pattern: previousPattern,
      },
    };
  }

  if (command.startsWith("s")) {
    const parsed = parseTextSubstitution(command, previousPattern);

    if (parsed.kind === "invalid") {
      return { kind: "invalid", message: parsed.message };
    }

    return {
      kind: "parsed",
      value: {
        script: {
          address: addressed.selection,
          command: { kind: "substitute", substitution: parsed.substitution },
        },
        pattern: parsed.substitution.pattern,
      },
    };
  }

  return { kind: "invalid", message: `Unsupported sed script: ${source}` };
}

function parseSedOptions(
  invocation: CommandInvocation,
): OptionParseResult<SedOptions> {
  const boundary = optionBoundary(invocation);
  const scriptSources: string[] = [];
  const operands: string[] = [];
  let suppressDefaultPrint = false;
  let hasExplicitScript = false;

  for (let index = 0; index < invocation.arguments.length; index += 1) {
    const value = invocation.arguments[index];

    if (value === undefined) {
      continue;
    }

    if (index >= boundary || !hasOptionPrefix(value)) {
      operands.push(value);
      continue;
    }

    if (value === "-n") {
      suppressDefaultPrint = true;
      continue;
    }

    if (value === "-e") {
      const script = invocation.arguments[index + 1];

      if (script === undefined || index + 1 >= boundary) {
        return { kind: "invalid", message: "-e requires a sed script." };
      }

      scriptSources.push(script);
      hasExplicitScript = true;
      index += 1;
      continue;
    }

    return { kind: "invalid", message: `Unsupported option: ${value}.` };
  }

  if (!hasExplicitScript) {
    const script = operands.shift();

    if (script === undefined) {
      return {
        kind: "invalid",
        message: "Usage: sed [-n] [-e script]... [script] [path ...]",
      };
    }

    scriptSources.push(script);
  }

  const scripts: SedScript[] = [];
  let previousPattern: string | undefined;

  for (const source of scriptSources) {
    const parsed = parseSedScript(source, previousPattern);

    if (parsed.kind === "invalid") {
      return parsed;
    }

    scripts.push(parsed.value.script);
    previousPattern = parsed.value.pattern;
  }

  if (operands.length === 0 && invocation.stdin.kind === "none") {
    return {
      kind: "invalid",
      message: "Usage: sed [-n] [-e script]... [script] [path ...]",
    };
  }

  return {
    kind: "parsed",
    value: {
      suppressDefaultPrint,
      scripts,
      input: operands.length > 0
        ? { kind: "paths", paths: operands }
        : { kind: "stdin", text: invocation.stdin.kind === "text" ? invocation.stdin.text : "" },
    },
  };
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

function failedGrepOutcome(outcome: CommandOutcome): GrepFailure {
  if (outcome.kind !== "failed") {
    throw new Error("Grep path failures must produce failed command outcomes.");
  }

  return outcome;
}

function planGrepFiles(
  filesystem: VirtualFilesystem,
  context: CommandExecutionContext,
  options: GrepOptions,
  recursiveEntryLimit: number,
): GrepFilePlan {
  const inputs: GrepPlannedInput[] = [];
  let traversalTruncated = false;

  for (const operand of options.operands) {
    if (context.signal.aborted) {
      return { kind: "cancelled" };
    }

    const resolution = resolveVirtualPath(
      filesystem,
      context.currentDirectory,
      operand,
    );

    if (resolution.kind !== "found") {
      inputs.push({
        kind: "failure",
        failure: failedGrepOutcome(failureOutcome("grep", resolution)),
      });
      continue;
    }

    if (resolution.node.kind === "file") {
      inputs.push({ kind: "file", file: resolution.node });
      continue;
    }

    if (resolution.node.kind === "locked-file") {
      inputs.push({
        kind: "failure",
        failure: failedGrepOutcome(
          rejectedOutcome("grep", `Access is locked: ${resolution.path}`),
        ),
      });
      continue;
    }

    if (!options.recursive) {
      inputs.push({
        kind: "failure",
        failure: failedGrepOutcome(
          rejectedOutcome(
            "grep",
            `Is a directory: ${resolution.path}; use -r to search recursively.`,
          ),
        ),
      });
      continue;
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

    traversalTruncated = traversalTruncated || traversal.kind === "truncated";

    for (const entry of traversal.entries) {
      if (entry.node.kind === "file") {
        inputs.push({ kind: "file", file: entry.node });
        continue;
      }

      if (entry.node.kind === "locked-file") {
        inputs.push({
          kind: "failure",
          failure: failedGrepOutcome(
            rejectedOutcome("grep", `Access is locked: ${entry.node.path}`),
          ),
        });
      }
    }
  }

  return { kind: "planned", inputs, traversalTruncated };
}

function planGrepInputs(
  filesystem: VirtualFilesystem,
  context: CommandExecutionContext,
  options: GrepOptions,
  recursiveEntryLimit: number,
  stdin: CommandInvocation["stdin"],
): GrepFilePlan {
  if (options.operands.length === 0 && stdin.kind === "text") {
    return {
      kind: "planned",
      inputs: [{ kind: "stdin", text: stdin.text }],
      traversalTruncated: false,
    };
  }

  return planGrepFiles(filesystem, context, options, recursiveEntryLimit);
}

function readGrepInput(
  input: Exclude<GrepPlannedInput, { kind: "failure" }>,
  filesystem: VirtualFilesystem,
  documents: VirtualDocumentSupplier,
  context: CommandExecutionContext,
): Promise<TextReadResult> {
  if (input.kind === "stdin") {
    return Promise.resolve({
      kind: "read",
      text: input.text,
      sourcePath: "(standard input)",
    });
  }

  return readFile("grep", filesystem, documents, context, input.file.path);
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
    pipeline: "text",
    execute: async (invocation, context) => {
      const parsed = parseLsOptions(invocation);

      if (parsed.kind === "invalid") {
        return rejectedOutcome("ls", parsed.message);
      }

      switch (parsed.value.mode.kind) {
        case "tree":
          return executeTree(filesystem, context, recursiveEntryLimit, {
            commandName: "ls",
            showAll: parsed.value.showAll,
            maximumDepth: maximumRecursiveDepth,
            path: parsed.value.path,
          });
        case "list": {
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
          const output = parsed.value.mode.format === "long"
            ? textOutput("ls-output", formatLongListing(display))
            : textOutput(
                "ls-output",
                display.map((entry) => entry.name).join("\n"),
              );

          return succeededOutcome([output]);
        }
      }

      const exhaustiveMode: never = parsed.value.mode;
      return exhaustiveMode;
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
    pipeline: "effects",
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
    pipeline: "text",
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
    pipeline: "text",
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
    pipeline: "text",
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
      summary: "Find bounded virtual paths with direct predicates.",
      usage: "find [path] [-name pattern] [-path pattern] [-type f|d] [-maxdepth depth] [-mindepth depth]",
      examples: ["find -name '*.md'", "find projects -type f -maxdepth 2"],
    },
    pipeline: "text",
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

      const maximumDepth = parsed.value.predicates
        .filter((predicate) => predicate.kind === "maximum-depth")
        .reduce(
          (depth, predicate) => Math.min(depth, predicate.depth),
          maximumRecursiveDepth,
        );
      const traversal = traverseVirtualDirectory({
        filesystem,
        directory: resolution.directory,
        limit: recursiveEntryLimit,
        maximumDepth,
        signal: context.signal,
      });

      if (traversal.kind === "cancelled") {
        return cancelledOutcome();
      }

      const startingEntry: VirtualTraversalEntry = {
        node: resolution.directory,
        depth: 0,
      };
      const matches = [startingEntry, ...traversal.entries]
        .filter((entry) => parsed.value.predicates.every((predicate) => {
          switch (predicate.kind) {
            case "name":
              return matchesVirtualPathGlob(
                predicate.pattern,
                entry.node.name,
              );
            case "path":
              return matchesVirtualPathGlob(
                predicate.pattern,
                entry.node.path,
              );
            case "type":
              return predicate.nodeKind === "directory"
                ? entry.node.kind === "directory"
                : entry.node.kind !== "directory";
            case "maximum-depth":
              return entry.depth <= predicate.depth;
            case "minimum-depth":
              return entry.depth >= predicate.depth;
          }
        }))
        .map((entry) => entry.node.path);
      const outputs: ShellOutput[] =
        matches.length === 0 ? [] : [textOutput("find-output", matches.join("\n"))];

      if (traversal.kind === "truncated") {
        outputs.push(truncationOutput("find", recursiveEntryLimit));
      }

      return succeededOutcome(outputs);
    },
  };
}

function aggregateGrepFailures(failures: ReadonlyArray<GrepFailure>): GrepFailure {
  const first = failures[0];

  if (first === undefined) {
    throw new Error("Grep failure aggregation requires at least one failure.");
  }

  return {
    kind: "failed",
    failure: first.failure,
    diagnostics: failures.flatMap((failure) => failure.diagnostics),
  };
}

function grepLogicalLines(text: string): ReadonlyArray<string> {
  if (text.length === 0) {
    return [];
  }

  const lines = text.split("\n");

  if (text.endsWith("\n")) {
    lines.pop();
  }

  return lines;
}

function grepIncludesFilename(options: GrepOptions): boolean {
  switch (options.filenamePolicy) {
    case "include":
      return true;
    case "suppress":
      return false;
    case "automatic":
      return options.operands.length > 0 &&
        (options.recursive || options.operands.length > 1);
  }
}

function grepOutputLine(
  sourcePath: string,
  line: string,
  lineNumber: number,
  includeFilename: boolean,
  includeLineNumber: boolean,
): string {
  const filename = includeFilename ? `${sourcePath}:` : "";
  const number = includeLineNumber ? `${lineNumber}:` : "";
  return `${filename}${number}${line}`;
}

function grepOutputTruncation(): ShellOutput {
  const diagnostic: ShellDiagnostic = {
    kind: "runtime",
    id: createShellDiagnosticId("grep-output-truncated"),
    code: "runtime.truncated",
    message: "grep output stopped before exceeding 1,000 matching lines or 1 MiB.",
  };

  return {
    kind: "diagnostic",
    id: createShellOutputId("grep-output-truncated"),
    diagnostic,
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
      summary: "Search virtual files with ECMAScript regular expressions.",
      usage: "grep [-i] [-n] [-r] [-F] [-H|-h] [--] pattern [file ...]",
      examples: [
        "cat about.md | grep -n '^Typed'",
        "grep -n '^Typed' about.md",
        "grep -rH 'fixture|typed' projects notes",
        "grep -F -- '-literal' about.md",
      ],
    },
    pipeline: "text",
    execute: async (invocation, context) => {
      const parsed = parseGrepOptions(invocation);

      if (parsed.kind === "invalid") {
        return rejectedOutcome("grep", parsed.message);
      }

      const matching = (() => {
        if (parsed.value.patternMode === "fixed") {
          const literal = parsed.value.caseSensitivity === "insensitive"
            ? parsed.value.pattern.toLowerCase()
            : parsed.value.pattern;

          return { kind: "fixed", literal } as const;
        }

        try {
          const flags = parsed.value.caseSensitivity === "insensitive" ? "iu" : "u";
          return {
            kind: "regular-expression",
            expression: new RegExp(parsed.value.pattern, flags),
          } as const;
        } catch (error: unknown) {
          return {
            kind: "invalid",
            message: error instanceof Error ? error.message : "Invalid regular expression.",
          } as const;
        }
      })();

      if (matching.kind === "invalid") {
        return rejectedOutcome("grep", matching.message);
      }

      const plan = planGrepInputs(
        filesystem,
        context,
        parsed.value,
        recursiveEntryLimit,
        invocation.stdin,
      );

      if (plan.kind === "cancelled") {
        return cancelledOutcome();
      }

      const matches: string[] = [];
      const failures: GrepFailure[] = [];
      const includeFilename = grepIncludesFilename(parsed.value);
      const encoder = new TextEncoder();
      let outputBytes = 0;
      let outputTruncated = false;

      for (const input of plan.inputs) {
        if (context.signal.aborted) {
          return cancelledOutcome();
        }

        if (input.kind === "failure") {
          failures.push(input.failure);
          continue;
        }

        const source = await readGrepInput(
          input,
          filesystem,
          documents,
          context,
        );

        if (source.kind === "cancelled") {
          return cancelledOutcome();
        }

        if (source.kind === "failed") {
          failures.push(failedGrepOutcome(source.outcome));
          continue;
        }

        if (outputTruncated) {
          continue;
        }

        const lines = grepLogicalLines(source.text);

        for (let index = 0; index < lines.length; index += 1) {
          if (context.signal.aborted) {
            return cancelledOutcome();
          }

          const line = lines[index];

          if (line === undefined) {
            continue;
          }

          const matchesLine = matching.kind === "fixed"
            ? (parsed.value.caseSensitivity === "insensitive" ? line.toLowerCase() : line)
              .includes(matching.literal)
            : matching.expression.test(line);

          if (!matchesLine) {
            continue;
          }

          const outputLine = grepOutputLine(
            source.sourcePath,
            line,
            index + 1,
            includeFilename,
            parsed.value.lineNumbers,
          );
          const separatorBytes = matches.length === 0 ? 0 : 1;
          const nextBytes = outputBytes + separatorBytes + encoder.encode(outputLine).byteLength;

          if (
            matches.length === maximumGrepMatchingLines ||
            nextBytes > maximumGrepOutputBytes
          ) {
            outputTruncated = true;
            break;
          }

          matches.push(outputLine);
          outputBytes = nextBytes;
        }
      }

      if (context.signal.aborted) {
        return cancelledOutcome();
      }

      if (failures.length > 0) {
        return aggregateGrepFailures(failures);
      }

      const outputs: ShellOutput[] =
        matches.length === 0 ? [] : [textOutput("grep-output", matches.join("\n"))];

      if (plan.traversalTruncated) {
        outputs.push(truncationOutput("grep", recursiveEntryLimit));
      }

      if (outputTruncated) {
        outputs.push(grepOutputTruncation());
      }

      return succeededOutcome(outputs);
    },
  };
}

function sedAddressNumber(address: SedAddress, totalLines: number): number {
  return address.kind === "last" ? totalLines : address.number;
}

function sedAddressMatches(
  selection: SedAddressSelection,
  lineNumber: number,
  totalLines: number,
): boolean {
  if (selection.kind === "all") {
    return true;
  }

  if (selection.kind === "single") {
    return lineNumber === sedAddressNumber(selection.address, totalLines);
  }

  const start = sedAddressNumber(selection.start, totalLines);
  const end = sedAddressNumber(selection.end, totalLines);

  return end < start
    ? lineNumber === start
    : lineNumber >= start && lineNumber <= end;
}

type SedLineResult =
  | Readonly<{
      kind: "processed";
      pattern: string;
      prints: ReadonlyArray<string>;
      deleted: boolean;
    }>
  | Readonly<{ kind: "cancelled" }>;

type SedInputReadResult =
  | Readonly<{ kind: "read"; texts: ReadonlyArray<string> }>
  | Readonly<{ kind: "failed"; outcome: CommandOutcome }>
  | Readonly<{ kind: "cancelled" }>;

function executeSedScripts(
  line: string,
  lineNumber: number,
  totalLines: number,
  scripts: ReadonlyArray<SedScript>,
  signal: AbortSignal,
): SedLineResult {
  let pattern = line;
  const prints: string[] = [];

  for (const script of scripts) {
    if (signal.aborted) {
      return { kind: "cancelled" };
    }

    if (!sedAddressMatches(script.address, lineNumber, totalLines)) {
      continue;
    }

    switch (script.command.kind) {
      case "print":
        prints.push(pattern);
        break;
      case "delete":
        return { kind: "processed", pattern, prints, deleted: true };
      case "substitute":
        pattern = applyTextSubstitution(pattern, script.command.substitution).text;
        break;
    }
  }

  return { kind: "processed", pattern, prints, deleted: false };
}

type SedOutputAccumulator = {
  lines: string[];
  bytes: number;
  truncated: boolean;
};

function appendSedOutput(
  accumulator: SedOutputAccumulator,
  line: string,
  encoder: TextEncoder,
): void {
  if (accumulator.truncated) {
    return;
  }

  const separatorBytes = accumulator.lines.length === 0 ? 0 : 1;
  const nextBytes = accumulator.bytes + separatorBytes + encoder.encode(line).byteLength;

  if (
    accumulator.lines.length === maximumSedOutputLines ||
    nextBytes > maximumSedOutputBytes
  ) {
    accumulator.truncated = true;
    return;
  }

  accumulator.lines.push(line);
  accumulator.bytes = nextBytes;
}

function sedOutputTruncation(): ShellOutput {
  const diagnostic: ShellDiagnostic = {
    kind: "runtime",
    id: createShellDiagnosticId("sed-output-truncated"),
    code: "runtime.truncated",
    message: "sed output stopped before exceeding 1,000 lines or 1 MiB.",
  };

  return {
    kind: "diagnostic",
    id: createShellOutputId("sed-output-truncated"),
    diagnostic,
  };
}

async function readSedInput(
  options: SedOptions,
  filesystem: VirtualFilesystem,
  documents: VirtualDocumentSupplier,
  context: CommandExecutionContext,
): Promise<SedInputReadResult> {
  if (options.input.kind === "stdin") {
    return { kind: "read", texts: [options.input.text] };
  }

  const texts: string[] = [];

  for (const path of options.input.paths) {
    if (context.signal.aborted) {
      return { kind: "cancelled" };
    }

    const result = await readFile("sed", filesystem, documents, context, path);

    if (result.kind !== "read") {
      return result;
    }

    texts.push(result.text);
  }

  return { kind: "read", texts };
}

function createSedCommand(
  filesystem: VirtualFilesystem,
  documents: VirtualDocumentSupplier,
): CommandDefinition {
  return {
    metadata: {
      group: "gnu-like",
      name: "sed",
      aliases: [],
      summary: "Transform piped text or virtual files without mutation.",
      usage: "sed [-n] [-e script]... [script] [path ...]",
      examples: [
        "cat about.md | sed -n '1,3p'",
        "sed -e 's/demo/live/gi' -e '2d' about.md",
      ],
    },
    pipeline: "text",
    execute: async (invocation, context) => {
      const parsed = parseSedOptions(invocation);

      if (parsed.kind === "invalid") {
        return rejectedOutcome("sed", parsed.message);
      }

      const input = await readSedInput(parsed.value, filesystem, documents, context);

      if (input.kind === "cancelled") {
        return cancelledOutcome();
      }

      if (input.kind === "failed") {
        return input.outcome;
      }

      const lines = input.texts.flatMap(grepLogicalLines);
      const output: SedOutputAccumulator = { lines: [], bytes: 0, truncated: false };
      const encoder = new TextEncoder();

      for (let index = 0; index < lines.length; index += 1) {
        if (context.signal.aborted) {
          return cancelledOutcome();
        }

        const line = lines[index];

        if (line === undefined) {
          continue;
        }

        const processed = executeSedScripts(
          line,
          index + 1,
          lines.length,
          parsed.value.scripts,
          context.signal,
        );

        if (processed.kind === "cancelled") {
          return cancelledOutcome();
        }

        for (const printed of processed.prints) {
          appendSedOutput(output, printed, encoder);
        }

        if (!processed.deleted && !parsed.value.suppressDefaultPrint) {
          appendSedOutput(output, processed.pattern, encoder);
        }
      }

      if (context.signal.aborted) {
        return cancelledOutcome();
      }

      const outputs: ShellOutput[] = output.lines.length === 0
        ? []
        : [textOutput("sed-output", output.lines.join("\n"))];

      if (output.truncated) {
        outputs.push(sedOutputTruncation());
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
      usage: `${commandName} [-n count] [path]`,
      examples: [`cat about.md | ${commandName} -n 3`, `${commandName} -n 3 about.md`],
    },
    pipeline: "text",
    execute: async (invocation, context) => {
      const parsed = parseLineReaderOptions(invocation, commandName);

      if (parsed.kind === "invalid") {
        return rejectedOutcome(commandName, parsed.message);
      }

      const document: TextReadResult = parsed.value.input.kind === "stdin"
        ? {
            kind: "read",
            text: parsed.value.input.text,
            sourcePath: "(standard input)",
          }
        : await readFile(
            commandName,
            filesystem,
            documents,
            context,
            parsed.value.input.path,
          );

      if (document.kind === "cancelled") {
        return cancelledOutcome();
      }

      if (document.kind === "failed") {
        return document.outcome;
      }

      if (context.signal.aborted) {
        return cancelledOutcome();
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
    pipeline: "effects",
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

      const contentId = ContentId.tryCreate(
        document.file.documentHandle,
        "less document handle",
      );

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
            statsIdentity: contentId.kind === "valid"
              ? { kind: "countable", contentId: contentId.value }
              : { kind: "uncounted" },
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
    pipeline: "effects",
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

type ManPresentation = "raw-pager" | "vi-manpager";

type ManPagerParseResult =
  | Readonly<{ kind: "supported"; presentation: ManPresentation }>
  | Readonly<{ kind: "unsupported" }>;

type ManInvocationParseResult =
  | Readonly<{
      kind: "parsed";
      presentation: ManPresentation;
      requestedName: string;
    }>
  | Readonly<{ kind: "invalid"; message: string }>;

const manUsage = "Usage: man [-P less|vi] [--pager=less|vi] <command>";

function parseManPager(pager: string): ManPagerParseResult {
  if (pager === "less") {
    return { kind: "supported", presentation: "raw-pager" };
  }

  if (pager === "vi") {
    return { kind: "supported", presentation: "vi-manpager" };
  }

  return { kind: "unsupported" };
}

function parseManInvocation(invocation: CommandInvocation): ManInvocationParseResult {
  const [first, second, third, ...remaining] = invocation.arguments;

  if (first === undefined) {
    return { kind: "invalid", message: manUsage };
  }

  if (first === "-P") {
    if (second === undefined || third === undefined || remaining.length > 0) {
      return { kind: "invalid", message: manUsage };
    }

    const pager = parseManPager(second);

    if (pager.kind === "unsupported") {
      return { kind: "invalid", message: `Unsupported man pager: ${second}.` };
    }

    return {
      kind: "parsed",
      presentation: pager.presentation,
      requestedName: third,
    };
  }

  if (first.startsWith("--pager=")) {
    if (second === undefined || third !== undefined || remaining.length > 0) {
      return { kind: "invalid", message: manUsage };
    }

    const pager = first.slice("--pager=".length);

    const pagerResult = parseManPager(pager);

    if (pagerResult.kind === "unsupported") {
      const message = pager.length === 0
        ? "Man pager must be specified."
        : `Unsupported man pager: ${pager}.`;

      return {
        kind: "invalid",
        message,
      };
    }

    return {
      kind: "parsed",
      presentation: pagerResult.presentation,
      requestedName: second,
    };
  }

  if (first.startsWith("-")) {
    return { kind: "invalid", message: `Unsupported man option: ${first}.` };
  }

  if (second !== undefined || third !== undefined || remaining.length > 0) {
    return { kind: "invalid", message: manUsage };
  }

  return { kind: "parsed", presentation: "raw-pager", requestedName: first };
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
    pipeline: "text",
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

function createManCommand(manpages: ManpageCorpus): CommandDefinition {
  return {
    metadata: {
      group: "gnu-like",
      name: "man",
      aliases: [],
      summary: "Show a command manual.",
      usage: "man [-P less|vi] [--pager=less|vi] <command>",
      examples: ["man grep", "man -P vi grep"],
    },
    pipeline: "effects",
    execute: async (invocation, context) => {
      const parsed = parseManInvocation(invocation);

      if (parsed.kind === "invalid") {
        return rejectedOutcome("man", parsed.message);
      }

      const resolution = resolveCommand(context.registry, parsed.requestedName);

      if (resolution.kind === "missing") {
        return rejectedOutcome(
          "man",
          `No manual entry for ${parsed.requestedName}.`,
        );
      }

      const canonicalName = resolution.command.metadata.name;
      const manual = manpages.lookup(canonicalName);

      if (manual.kind === "missing") {
        return rejectedOutcome("man", `No manual entry for ${canonicalName}.`);
      }

      return succeededOutcome([], [
        {
          kind: "open-viewer",
          viewer: createDocumentViewerContent({
            title: `${canonicalName}(1)`,
            presentation: parsed.presentation,
            document: {
              text: manual.manpage.text,
              source: { path: manual.manpage.metadata.sourcePath },
            },
            statsIdentity: { kind: "uncounted" },
          }),
          disposition: { kind: "inline" },
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
    pipeline: "text",
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
    pipeline: "text",
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
  manpages,
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
    createSedCommand(filesystem, documents),
    createLineReaderCommand("head", false, filesystem, documents),
    createLineReaderCommand("tail", true, filesystem, documents),
    createLessCommand(filesystem, documents),
    createClearCommand(),
    createHistoryCommand(),
    createManCommand(manpages),
    createEchoCommand(),
    createWhoamiCommand(),
  ];
}
