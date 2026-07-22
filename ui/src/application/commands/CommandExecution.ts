import {
  lexArguments,
  createArgumentIndex,
  type ArgumentLexerToken,
  type LexedArgument,
  type LexedRedirection,
  type OptionTerminator,
  type RedirectionOperator,
  type ShellSyntaxError,
} from "../../domain/terminal/ArgumentLexer.ts";
import {
  expandVirtualPathGlob,
  resolveVirtualPath,
  writableVirtualFileText,
  writeVirtualFile,
  type VirtualAbsolutePath,
  type VirtualDirectoryPath,
  type VirtualFileWriteResult,
} from "../../domain/filesystem/VirtualFilesystem.ts";
import {
  createShellDiagnosticId,
  createShellOutputId,
  type CommandLineEvent,
  type CommandLineOutcome,
  type CommandOutcome,
  type CommandHistoryPersistence,
  type ShellDiagnostic,
  type ShellCommandRequest,
  type ShellOutput,
} from "../../domain/terminal/Shell.ts";
import {
  resolveCommand,
  type CommandDefinition,
  type CommandInvocation,
  type CommandRegistry,
} from "./CommandRegistry.ts";

export type ExecuteCommandLineOptions = Readonly<{
  registry: CommandRegistry;
  request: ShellCommandRequest;
  signal: AbortSignal;
}>;

const persistentCommandHistory = { kind: "persistent" } as const;

type ListConnector = "always" | "and" | "or";

type ParsedCommand = Readonly<{
  command: LexedArgument | undefined;
  arguments: ReadonlyArray<LexedArgument>;
  optionTerminator: OptionTerminator;
  redirections: ReadonlyArray<ParsedRedirection>;
}>;

type ParsedRedirection = Readonly<{
  descriptor: number;
  operator: RedirectionOperator;
  operand: string;
  position: LexedRedirection["position"];
}>;

type ParsedPipeline = Readonly<{
  connector: ListConnector;
  commands: ReadonlyArray<ParsedCommand>;
}>;

type CommandLineParseResult =
  | Readonly<{ kind: "empty" }>
  | Readonly<{
      kind: "success";
      pipelines: ReadonlyArray<ParsedPipeline>;
    }>
  | Readonly<{
      kind: "error";
      error: ShellSyntaxError;
    }>;

type ExpandedCommandArguments = Readonly<{
  arguments: ReadonlyArray<string>;
  optionTerminator: OptionTerminator;
}>;

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

function parseDiagnostic(error: ShellSyntaxError): ShellDiagnostic {
  switch (error.kind) {
    case "unterminated-single-quote":
      return {
        kind: "parse",
        id: createShellDiagnosticId("unterminated-single-quote"),
        code: "parse.unterminated-single-quote",
        message: "A single-quoted argument was not closed.",
        position: error.position,
      };
    case "unterminated-double-quote":
      return {
        kind: "parse",
        id: createShellDiagnosticId("unterminated-double-quote"),
        code: "parse.unterminated-double-quote",
        message: "A double-quoted argument was not closed.",
        position: error.position,
      };
    case "trailing-escape":
      return {
        kind: "parse",
        id: createShellDiagnosticId("trailing-escape"),
        code: "parse.trailing-escape",
        message: "An escape character must be followed by a character.",
        position: error.position,
      };
    case "unsupported-background-operator":
      return {
        kind: "parse",
        id: createShellDiagnosticId("unsupported-background-operator"),
        code: "parse.unsupported-background-operator",
        message: "Background commands are not supported.",
        position: error.position,
      };
    case "unsupported-redirection":
      return {
        kind: "parse",
        id: createShellDiagnosticId("unsupported-redirection"),
        code: "parse.unsupported-redirection",
        message: "Here-documents and here-strings are not supported.",
        position: error.position,
      };
    case "unsupported-file-descriptor":
      return {
        kind: "parse",
        id: createShellDiagnosticId("unsupported-file-descriptor"),
        code: "parse.unsupported-file-descriptor",
        message: "Redirection supports file descriptors 0 through 9.",
        position: error.position,
      };
    case "unexpected-operator":
      return {
        kind: "parse",
        id: createShellDiagnosticId("unexpected-operator"),
        code: "parse.unexpected-operator",
        message: "An operator must have a command on both sides.",
        position: error.position,
      };
    case "trailing-operator":
      return {
        kind: "parse",
        id: createShellDiagnosticId("trailing-operator"),
        code: "parse.trailing-operator",
        message: "An operator must be followed by a command.",
        position: error.position,
      };
    case "missing-redirection-operand":
      return {
        kind: "parse",
        id: createShellDiagnosticId("missing-redirection-operand"),
        code: "parse.missing-redirection-operand",
        message: "A redirection operator must be followed by an operand.",
        position: error.position,
      };
    case "invalid-redirection-operand":
      return {
        kind: "parse",
        id: createShellDiagnosticId("invalid-redirection-operand"),
        code: "parse.invalid-redirection-operand",
        message: "Descriptor redirection requires a descriptor from 0 through 9 or '-'.",
        position: error.position,
      };
  }
}

function parseFailureOutcome(error: ShellSyntaxError): CommandOutcome {
  return {
    kind: "failed",
    failure: { kind: "parse-error", error },
    diagnostics: [parseDiagnostic(error)],
  };
}

function emptyCommandOutcome(): CommandOutcome {
  return {
    kind: "failed",
    failure: { kind: "empty-command" },
    diagnostics: [
      {
        kind: "command",
        id: createShellDiagnosticId("empty-command"),
        code: "command.empty",
        message: "Enter a command before submitting.",
      },
    ],
  };
}

function rejectedPipelineOutcome(commandName: string): CommandOutcome {
  return {
    kind: "failed",
    failure: {
      kind: "command-rejected",
      commandName,
      message: `${commandName} cannot be used in a pipeline.`,
    },
    diagnostics: [
      {
        kind: "command",
        id: createShellDiagnosticId("pipeline-command-rejected"),
        code: "command.rejected",
        message: `${commandName} cannot be used in a pipeline.`,
      },
    ],
  };
}

function missingCommandOutcome(commandName: string): CommandOutcome {
  return {
    kind: "failed",
    failure: { kind: "command-not-found", commandName },
    diagnostics: [
      {
        kind: "command",
        id: createShellDiagnosticId("command-not-found"),
        code: "command.not-found",
        message: `Command not found: ${commandName}`,
      },
    ],
  };
}

function executionFailureOutcome(
  commandName: string,
  cause: Error,
): CommandOutcome {
  return {
    kind: "failed",
    failure: { kind: "execution-error", commandName, cause },
    diagnostics: [
      {
        kind: "runtime",
        id: createShellDiagnosticId("execution-failed"),
        code: "runtime.execution-failed",
        message: "The command could not complete.",
      },
    ],
  };
}

function parseCommandLine(
  tokens: ReadonlyArray<ArgumentLexerToken>,
): CommandLineParseResult {
  if (tokens.length === 0) {
    return { kind: "empty" };
  }

  const pipelines: ParsedPipeline[] = [];
  let commands: ParsedCommand[] = [];
  let connector: ListConnector = "always";
  let tokenIndex = 0;

  while (tokenIndex < tokens.length) {
    const firstToken = tokens[tokenIndex];

    if (firstToken?.kind === "operator") {
      return {
        kind: "error",
        error: { kind: "unexpected-operator", position: firstToken.position },
      };
    }

    let command: LexedArgument | undefined;
    const argumentsList: LexedArgument[] = [];
    let optionTerminator: OptionTerminator = { kind: "absent" };
    const redirections: ParsedRedirection[] = [];

    while (tokenIndex < tokens.length) {
      const token = tokens[tokenIndex];

      if (token === undefined || token.kind === "operator") {
        break;
      }

      if (token.kind === "redirection") {
        const operandToken = tokens[tokenIndex + 1];

        if (
          operandToken === undefined ||
          operandToken.kind === "operator" ||
          operandToken.kind === "redirection"
        ) {
          return {
            kind: "error",
            error: {
              kind: "missing-redirection-operand",
              position: token.position,
            },
          };
        }

        const operand = operandToken.kind === "argument"
          ? operandToken.value
          : "--";
        const duplicatesDescriptor = token.operator === "<&" ||
          token.operator === ">&";

        if (duplicatesDescriptor && !/^(?:[0-9]|-)$/u.test(operand)) {
          return {
            kind: "error",
            error: {
              kind: "invalid-redirection-operand",
              position: token.position,
            },
          };
        }

        redirections.push({
          descriptor: token.descriptor,
          operator: token.operator,
          operand,
          position: token.position,
        });
        tokenIndex += 2;
        continue;
      }

      if (token.kind === "argument") {
        if (command === undefined) {
          command = token;
        } else {
          argumentsList.push(token);
        }
      } else if (optionTerminator.kind === "absent") {
        optionTerminator = {
          kind: "present",
          argumentIndex: createArgumentIndex(
            command === undefined ? 0 : argumentsList.length + 1,
          ),
          sourceStart: token.sourceStart,
          sourceEnd: token.sourceEnd,
        };
      } else {
        const argument: LexedArgument = {
          kind: "argument",
          value: "--",
          protectedGlobMetacharacterOffsets: [],
          sourceStart: token.sourceStart,
          sourceEnd: token.sourceEnd,
        };

        if (command === undefined) {
          command = argument;
        } else {
          argumentsList.push(argument);
        }
      }

      tokenIndex += 1;
    }

    if (command === undefined && redirections.length === 0) {
      return { kind: "empty" };
    }

    commands.push({
      command,
      arguments: argumentsList,
      optionTerminator,
      redirections,
    });

    const operator = tokens[tokenIndex];

    if (operator === undefined) {
      break;
    }

    if (operator.kind !== "operator") {
      throw new Error("Command parsing stopped before a non-operator token.");
    }

    if (operator.operator === "&") {
      return {
        kind: "error",
        error: {
          kind: "unsupported-background-operator",
          position: operator.position,
        },
      };
    }

    if (tokenIndex + 1 >= tokens.length) {
      return {
        kind: "error",
        error: { kind: "trailing-operator", position: operator.position },
      };
    }

    if (operator.operator === "|") {
      tokenIndex += 1;
      continue;
    } else if (operator.operator === "&&") {
      pipelines.push({ connector, commands });
      commands = [];
      connector = "and";
    } else if (operator.operator === "||") {
      pipelines.push({ connector, commands });
      commands = [];
      connector = "or";
    } else {
      pipelines.push({ connector, commands });
      commands = [];
      connector = "always";
    }

    tokenIndex += 1;
  }

  pipelines.push({ connector, commands });

  return { kind: "success", pipelines };
}

export function commandHistoryPersistenceForSource(
  registry: CommandRegistry,
  source: string,
): CommandHistoryPersistence {
  const lexicalResult = lexArguments(source);

  if (lexicalResult.kind === "error") {
    return persistentCommandHistory;
  }

  const parseResult = parseCommandLine(lexicalResult.tokens);

  if (parseResult.kind !== "success") {
    return persistentCommandHistory;
  }

  for (const pipeline of parseResult.pipelines) {
    for (const command of pipeline.commands) {
      if (command.command === undefined) {
        continue;
      }

      const resolution = resolveCommand(registry, command.command.value);

      if (
        resolution.kind === "found" &&
        resolution.command.historyPersistence !== undefined
      ) {
        return resolution.command.historyPersistence;
      }
    }
  }

  return persistentCommandHistory;
}

function shouldExecute(
  connector: ListConnector,
  previousOutcome: CommandOutcome | undefined,
): boolean {
  if (connector === "always" || previousOutcome === undefined) {
    return true;
  }

  if (previousOutcome.kind === "cancelled") {
    return false;
  }

  return connector === "and"
    ? previousOutcome.kind === "succeeded"
    : previousOutcome.kind === "failed";
}

function outputEvent(output: ShellOutput, sequence: number): CommandLineEvent {
  return {
    kind: "output",
    output: {
      ...output,
      id: createShellOutputId(`command-list-output-${sequence}`),
    },
  };
}

function appendOutcome(
  events: CommandLineEvent[],
  outcome: CommandOutcome,
): void {
  if (outcome.kind === "succeeded") {
    for (const output of outcome.outputs) {
      events.push(outputEvent(output, events.length + 1));
    }

    for (const effect of outcome.effects) {
      events.push({ kind: "effect", effect });
    }
    return;
  }

  const diagnostics = outcome.kind === "failed"
    ? outcome.diagnostics
    : [outcome.diagnostic];

  for (const diagnostic of diagnostics) {
    events.push(outputEvent({
      kind: "diagnostic",
      id: createShellOutputId("command-list-diagnostic"),
      diagnostic,
    }, events.length + 1));
  }
}

function lineOutcome(
  events: ReadonlyArray<CommandLineEvent>,
  outcome: CommandOutcome,
): CommandLineOutcome {
  switch (outcome.kind) {
    case "succeeded":
      return { kind: "succeeded", events };
    case "failed":
      return { kind: "failed", events, failure: outcome.failure };
    case "cancelled":
      return { kind: "cancelled", events };
  }
}

function nextCurrentDirectory(
  currentDirectory: VirtualDirectoryPath,
  outcome: CommandOutcome,
): VirtualDirectoryPath {
  if (outcome.kind !== "succeeded") {
    return currentDirectory;
  }

  let nextDirectory = currentDirectory;

  for (const effect of outcome.effects) {
    if (effect.kind === "set-current-directory") {
      nextDirectory = effect.directory;
    }
  }

  return nextDirectory;
}

function reachesInteractionBoundary(outcome: CommandOutcome): boolean {
  return outcome.kind === "succeeded" && outcome.effects.some(
    (effect) =>
      effect.kind === "open-viewer" ||
      effect.kind === "request-secret-prompt",
  );
}

function expandCommandArguments(
  command: ParsedCommand,
  currentDirectory: VirtualDirectoryPath,
  options: ExecuteCommandLineOptions,
): ExpandedCommandArguments {
  const expansions = command.arguments.map((argument) => {
    const matches = expandVirtualPathGlob({
      filesystem: options.registry.filesystem,
      currentDirectory,
      value: argument.value,
      protectedMetacharacterOffsets: argument.protectedGlobMetacharacterOffsets,
    });

    return matches.length === 0 ? [argument.value] : matches;
  });
  const expandedArguments = expansions.flat();

  const optionTerminator = command.optionTerminator.kind === "absent"
    ? command.optionTerminator
    : {
        ...command.optionTerminator,
        argumentIndex: createArgumentIndex(
          expansions
            .slice(0, command.optionTerminator.argumentIndex)
            .flat().length,
        ),
      };

  return { arguments: expandedArguments, optionTerminator };
}

async function executeCommand(
  command: ParsedCommand,
  definition: CommandDefinition,
  stdin: CommandInvocation["stdin"],
  currentDirectory: VirtualDirectoryPath,
  options: ExecuteCommandLineOptions,
): Promise<CommandOutcome> {
  const expanded = expandCommandArguments(command, currentDirectory, options);

  try {
    return await definition.execute(
      {
        source: options.request.source,
        name: definition.metadata.name,
        arguments: expanded.arguments,
        optionTerminator: expanded.optionTerminator,
        stdin,
      },
      {
        shellId: options.request.shellId,
        sessionId: options.request.sessionId,
        currentDirectory,
        commandHistory: options.request.commandHistory,
        registry: options.registry,
        signal: options.signal,
      },
    );
  } catch (thrown: unknown) {
    if (options.signal.aborted) {
      return cancelledOutcome();
    }

    const cause = thrown instanceof Error
      ? thrown
      : new Error("Command execution failed.", { cause: thrown });

    return executionFailureOutcome(definition.metadata.name, cause);
  }
}

type OutputDestination =
  | Readonly<{ kind: "terminal" }>
  | Readonly<{ kind: "pipeline" }>
  | Readonly<{
      kind: "file";
      path: VirtualAbsolutePath;
      initialText: string;
      write: "append" | "from-start";
    }>;

type DescriptorTarget =
  | Readonly<{ kind: "closed" }>
  | Readonly<{ kind: "input"; stdin: CommandInvocation["stdin"] }>
  | Readonly<{ kind: "output"; destination: OutputDestination }>
  | Readonly<{
      kind: "read-write";
      stdin: Extract<CommandInvocation["stdin"], { kind: "text" }>;
      destination: OutputDestination;
    }>;

type RedirectionSetupResult =
  | Readonly<{
      kind: "ready";
      descriptors: ReadonlyArray<DescriptorTarget>;
    }>
  | Readonly<{
      kind: "failed";
      outcome: Extract<CommandOutcome, { kind: "failed" }>;
      descriptors: ReadonlyArray<DescriptorTarget>;
    }>
  | Readonly<{ kind: "cancelled" }>;

type ReadRedirectionFileResult =
  | Readonly<{
      kind: "read";
      path: VirtualAbsolutePath;
      text: string;
    }>
  | Readonly<{ kind: "not-found" }>
  | Readonly<{ kind: "failed"; message: string }>
  | Readonly<{ kind: "cancelled" }>;

type FileWriteResult =
  | Readonly<{ kind: "written"; path: VirtualAbsolutePath }>
  | Readonly<{
      kind: "failed";
      outcome: Extract<CommandOutcome, { kind: "failed" }>;
    }>;

function redirectionFailure(
  message: string,
): Extract<CommandOutcome, { kind: "failed" }> {
  return {
    kind: "failed",
    failure: { kind: "redirection-error", message },
    diagnostics: [{
      kind: "command",
      id: createShellDiagnosticId("redirection-failed"),
      code: "command.rejected",
      message,
    }],
  };
}

function writeFailureMessage(result: Exclude<VirtualFileWriteResult, { kind: "written" }>): string {
  switch (result.kind) {
    case "invalid-path":
      return `Invalid redirection path: ${result.input}`;
    case "not-found":
      return `Redirection parent does not exist: ${result.path}`;
    case "not-directory":
      return `Redirection parent is not a directory: ${result.path}`;
    case "is-directory":
      return `Cannot redirect to a directory: ${result.path}`;
    case "locked":
      return `Cannot redirect to locked file: ${result.path}`;
  }
}

function applyFileWrite(
  options: ExecuteCommandLineOptions,
  currentDirectory: VirtualDirectoryPath,
  path: string,
  text: string,
): FileWriteResult {
  const result = writeVirtualFile(
    options.registry.filesystem,
    currentDirectory,
    path,
    text,
  );

  if (result.kind !== "written") {
    return {
      kind: "failed",
      outcome: redirectionFailure(writeFailureMessage(result)),
    };
  }

  options.registry.onFilesystemChange(result.overlay);
  return { kind: "written", path: result.path };
}

async function readRedirectionFile(
  options: ExecuteCommandLineOptions,
  currentDirectory: VirtualDirectoryPath,
  operand: string,
): Promise<ReadRedirectionFileResult> {
  const resolution = resolveVirtualPath(
    options.registry.filesystem,
    currentDirectory,
    operand,
  );

  if (resolution.kind === "not-found") {
    return { kind: "not-found" };
  }

  if (resolution.kind === "invalid-path") {
    return { kind: "failed", message: `Invalid redirection path: ${operand}` };
  }

  if (resolution.kind === "not-directory") {
    return {
      kind: "failed",
      message: `Redirection parent is not a directory: ${resolution.path}`,
    };
  }

  if (resolution.kind === "locked") {
    return {
      kind: "failed",
      message: `Cannot redirect from locked file: ${resolution.path}`,
    };
  }

  if (resolution.node.kind === "directory") {
    return {
      kind: "failed",
      message: `Cannot redirect from a directory: ${resolution.path}`,
    };
  }

  if (resolution.node.kind === "locked-file") {
    return {
      kind: "failed",
      message: `Cannot redirect from locked file: ${resolution.path}`,
    };
  }

  const writableText = writableVirtualFileText(
    options.registry.filesystem,
    resolution.path,
  );

  if (writableText !== undefined) {
    return { kind: "read", path: resolution.path, text: writableText };
  }

  const document = await options.registry.documents.read(
    resolution.node.documentHandle,
    options.signal,
  );

  if (options.signal.aborted || document.kind === "cancelled") {
    return { kind: "cancelled" };
  }

  return document.kind === "available"
    ? { kind: "read", path: resolution.path, text: document.document.text }
    : {
        kind: "failed",
        message: `Redirection content is unavailable: ${resolution.path}`,
      };
}

function descriptorTarget(
  descriptors: ReadonlyArray<DescriptorTarget>,
  descriptor: number,
): DescriptorTarget {
  return descriptors[descriptor] ?? { kind: "closed" };
}

function withDescriptor(
  descriptors: ReadonlyArray<DescriptorTarget>,
  descriptor: number,
  target: DescriptorTarget,
): ReadonlyArray<DescriptorTarget> {
  return descriptors.map((current, index) =>
    index === descriptor ? target : current
  );
}

async function applyRedirections(
  command: ParsedCommand,
  pipelineInput: CommandInvocation["stdin"],
  pipelineOutput: OutputDestination,
  currentDirectory: VirtualDirectoryPath,
  options: ExecuteCommandLineOptions,
): Promise<RedirectionSetupResult> {
  const terminal: OutputDestination = { kind: "terminal" };
  const closed: DescriptorTarget = { kind: "closed" };
  let descriptors: ReadonlyArray<DescriptorTarget> = [
    { kind: "input", stdin: pipelineInput },
    { kind: "output", destination: pipelineOutput },
    { kind: "output", destination: terminal },
    ...Array.from({ length: 7 }, () => closed),
  ];

  for (const redirection of command.redirections) {
    if (options.signal.aborted) {
      return { kind: "cancelled" };
    }

    if (redirection.operator === "<&" || redirection.operator === ">&") {
      if (redirection.operand === "-") {
        descriptors = withDescriptor(
          descriptors,
          redirection.descriptor,
          { kind: "closed" },
        );
        continue;
      }

      const source = descriptorTarget(descriptors, Number(redirection.operand));
      const compatible = redirection.operator === "<&"
        ? source.kind === "input" || source.kind === "read-write"
        : source.kind === "output" || source.kind === "read-write";

      if (!compatible) {
        return {
          kind: "failed",
          outcome: redirectionFailure(
            `File descriptor ${redirection.operand} is not compatible with ${redirection.operator}.`,
          ),
          descriptors,
        };
      }

      descriptors = withDescriptor(
        descriptors,
        redirection.descriptor,
        source,
      );
      continue;
    }

    if (redirection.operator === ">" || redirection.operator === ">|") {
      const opened = applyFileWrite(
        options,
        currentDirectory,
        redirection.operand,
        "",
      );

      if (opened.kind === "failed") {
        return { ...opened, descriptors };
      }

      descriptors = withDescriptor(descriptors, redirection.descriptor, {
        kind: "output",
        destination: {
          kind: "file",
          path: opened.path,
          initialText: "",
          write: "from-start",
        },
      });
      continue;
    }

    const read = await readRedirectionFile(
      options,
      currentDirectory,
      redirection.operand,
    );

    if (read.kind === "cancelled") {
      return { kind: "cancelled" };
    }

    if (
      read.kind === "not-found" &&
      (redirection.operator === ">>" || redirection.operator === "<>")
    ) {
      const opened = applyFileWrite(
        options,
        currentDirectory,
        redirection.operand,
        "",
      );

      if (opened.kind === "failed") {
        return { ...opened, descriptors };
      }

      const destination: OutputDestination = {
        kind: "file",
        path: opened.path,
        initialText: "",
        write: redirection.operator === ">>" ? "append" : "from-start",
      };
      descriptors = withDescriptor(
        descriptors,
        redirection.descriptor,
        redirection.operator === ">>"
          ? { kind: "output", destination }
          : {
              kind: "read-write",
              stdin: { kind: "text", text: "" },
              destination,
            },
      );
      continue;
    }

    if (read.kind !== "read") {
      const message = read.kind === "not-found"
        ? `Redirection file does not exist: ${redirection.operand}`
        : read.message;
      return {
        kind: "failed",
        outcome: redirectionFailure(message),
        descriptors,
      };
    }

    if (redirection.operator === ">>") {
      descriptors = withDescriptor(descriptors, redirection.descriptor, {
        kind: "output",
        destination: {
          kind: "file",
          path: read.path,
          initialText: read.text,
          write: "append",
        },
      });
      continue;
    }

    descriptors = withDescriptor(
      descriptors,
      redirection.descriptor,
      redirection.operator === "<>"
        ? {
            kind: "read-write",
            stdin: { kind: "text", text: read.text },
            destination: {
              kind: "file",
              path: read.path,
              initialText: read.text,
              write: "from-start",
            },
          }
        : { kind: "input", stdin: { kind: "text", text: read.text } },
    );
  }

  return { kind: "ready", descriptors };
}

function commandInput(
  descriptors: ReadonlyArray<DescriptorTarget>,
): CommandInvocation["stdin"] {
  const input = descriptorTarget(descriptors, 0);
  return input.kind === "input" || input.kind === "read-write"
    ? input.stdin
    : { kind: "none" };
}

function descriptorOutput(
  descriptors: ReadonlyArray<DescriptorTarget>,
  descriptor: number,
): OutputDestination | undefined {
  const target = descriptorTarget(descriptors, descriptor);
  return target.kind === "output" || target.kind === "read-write"
    ? target.destination
    : undefined;
}

type RedirectableOutput = Exclude<ShellOutput, { kind: "prompt" }>;

function redirectedOutputText(output: RedirectableOutput): string {
  switch (output.kind) {
    case "text":
      return output.text;
    case "diagnostic":
      return output.diagnostic.message;
  }
}

function redirectedFileText(
  destination: Extract<OutputDestination, { kind: "file" }>,
  text: string,
): string {
  return destination.write === "append"
    ? destination.initialText + text
    : text + destination.initialText.slice(text.length);
}

function routeFailureThroughStandardError(
  outcome: Extract<CommandOutcome, { kind: "failed" }>,
  descriptors: ReadonlyArray<DescriptorTarget>,
  currentDirectory: VirtualDirectoryPath,
  events: CommandLineEvent[],
  options: ExecuteCommandLineOptions,
): string {
  const destination = descriptorOutput(descriptors, 2);

  if (destination === undefined) {
    return "";
  }

  if (destination.kind === "terminal") {
    appendOutcome(events, outcome);
    return "";
  }

  const text = outcome.diagnostics.map((diagnostic) => diagnostic.message).join("\n");

  if (destination.kind === "pipeline") {
    return text;
  }

  void applyFileWrite(
    options,
    currentDirectory,
    destination.path,
    redirectedFileText(destination, text),
  );
  return "";
}

async function routeOutcome(
  outcome: CommandOutcome,
  descriptors: ReadonlyArray<DescriptorTarget>,
  currentDirectory: VirtualDirectoryPath,
  events: CommandLineEvent[],
  options: ExecuteCommandLineOptions,
): Promise<Readonly<{ outcome: CommandOutcome; pipelineText: string }>> {
  const redirected = new Map<OutputDestination, string[]>();
  let outputFailure: Extract<CommandOutcome, { kind: "failed" }> | undefined;
  const route = (output: RedirectableOutput, descriptor: number): boolean => {
    const destination = descriptorOutput(descriptors, descriptor);

    if (destination === undefined) {
      return false;
    }

    if (destination.kind === "terminal") {
      events.push(outputEvent(output, events.length + 1));
      return true;
    }

    const text = redirectedOutputText(output);
    const pieces = redirected.get(destination) ?? [];
    pieces.push(text);
    redirected.set(destination, pieces);
    return true;
  };

  if (outcome.kind === "succeeded") {
    for (const output of outcome.outputs) {
      if (output.kind === "prompt") {
        events.push(outputEvent(output, events.length + 1));
      } else {
        const descriptor = output.kind === "diagnostic" ? 2 : 1;

        if (!route(output, descriptor) && descriptor === 1) {
          outputFailure = redirectionFailure(
            "File descriptor 1 is not writable.",
          );
        }
      }
    }

    for (const effect of outcome.effects) {
      events.push({ kind: "effect", effect });
    }
  } else {
    const diagnostics = outcome.kind === "failed"
      ? outcome.diagnostics
      : [outcome.diagnostic];

    for (const diagnostic of diagnostics) {
      void route({
        kind: "diagnostic",
        id: createShellOutputId("redirected-diagnostic"),
        diagnostic,
      }, 2);
    }
  }

  if (outputFailure !== undefined) {
    redirected.clear();
    const pipelineText = routeFailureThroughStandardError(
      outputFailure,
      descriptors,
      currentDirectory,
      events,
      options,
    );
    return { outcome: outputFailure, pipelineText };
  }

  let pipelineText = "";

  for (const [destination, pieces] of redirected) {
    const text = pieces.join("\n");

    if (destination.kind === "pipeline") {
      pipelineText = text;
      continue;
    }

    if (destination.kind === "terminal") {
      throw new Error("Terminal output must be emitted before redirection flush.");
    }

    const write = applyFileWrite(
      options,
      currentDirectory,
      destination.path,
      redirectedFileText(destination, text),
    );

    if (write.kind === "failed") {
      const failurePipelineText = routeFailureThroughStandardError(
        write.outcome,
        descriptors,
        currentDirectory,
        events,
        options,
      );
      return { outcome: write.outcome, pipelineText: failurePipelineText };
    }
  }

  return { outcome, pipelineText };
}

async function executePipeline(
  pipeline: ParsedPipeline,
  currentDirectory: VirtualDirectoryPath,
  events: CommandLineEvent[],
  options: ExecuteCommandLineOptions,
): Promise<CommandOutcome> {
  const resolved = pipeline.commands.map((command) => ({
    command,
    resolution: command.command === undefined
      ? { kind: "null" } satisfies Readonly<{ kind: "null" }>
      : resolveCommand(options.registry, command.command.value),
  }));

  let pipelineInput: CommandInvocation["stdin"] = { kind: "none" };
  let outcome: CommandOutcome | undefined;
  let firstRedirectionFailure:
    | Extract<CommandOutcome, { kind: "failed" }>
    | undefined;

  for (const entry of resolved) {
    if (options.signal.aborted) {
      const cancelled = cancelledOutcome();
      appendOutcome(events, cancelled);
      return cancelled;
    }

    const isFinal = entry === resolved[resolved.length - 1];
    const setup = await applyRedirections(
      entry.command,
      pipelineInput,
      isFinal ? { kind: "terminal" } : { kind: "pipeline" },
      currentDirectory,
      options,
    );

    if (setup.kind === "cancelled") {
      const cancelled = cancelledOutcome();
      appendOutcome(events, cancelled);
      return cancelled;
    }

    if (setup.kind === "failed") {
      outcome = setup.outcome;
      firstRedirectionFailure ??= setup.outcome;
      pipelineInput = {
        kind: "text",
        text: routeFailureThroughStandardError(
          setup.outcome,
          setup.descriptors,
          currentDirectory,
          events,
          options,
        ),
      };

      if (isFinal) {
        return firstRedirectionFailure;
      }

      continue;
    }

    if (entry.resolution.kind === "null") {
      outcome = { kind: "succeeded", outputs: [], effects: [] };
    } else if (entry.resolution.kind === "missing") {
      outcome = missingCommandOutcome(entry.resolution.requestedName);
    } else {
      outcome = await executeCommand(
        entry.command,
        entry.resolution.command,
        commandInput(setup.descriptors),
        currentDirectory,
        options,
      );
    }
    const routed = await routeOutcome(
      outcome,
      setup.descriptors,
      currentDirectory,
      events,
      options,
    );
    outcome = routed.outcome;
    pipelineInput = { kind: "text", text: routed.pipelineText };

    if (
      outcome.kind === "failed" &&
      outcome.failure.kind === "redirection-error"
    ) {
      firstRedirectionFailure ??= outcome;
    }

    if (outcome.kind === "cancelled") {
      return outcome;
    }

    if (options.signal.aborted) {
      const cancelled = cancelledOutcome();
      appendOutcome(events, cancelled);
      return cancelled;
    }

  }

  if (outcome === undefined) {
    throw new Error("A parsed pipeline must contain a command.");
  }

  return firstRedirectionFailure ?? outcome;
}

function completedLine(
  outcome: CommandOutcome,
): CommandLineOutcome {
  const events: CommandLineEvent[] = [];
  appendOutcome(events, outcome);
  return lineOutcome(events, outcome);
}

export async function executeCommandLine(
  options: ExecuteCommandLineOptions,
): Promise<CommandLineOutcome> {
  if (options.signal.aborted) {
    return completedLine(cancelledOutcome());
  }

  const lexicalResult = lexArguments(options.request.source);

  if (lexicalResult.kind === "error") {
    return completedLine(parseFailureOutcome(lexicalResult.error));
  }

  const parseResult = parseCommandLine(lexicalResult.tokens);

  if (parseResult.kind === "empty") {
    return completedLine(emptyCommandOutcome());
  }

  if (parseResult.kind === "error") {
    return completedLine(parseFailureOutcome(parseResult.error));
  }

  for (const pipeline of parseResult.pipelines) {
    if (pipeline.commands.length < 2) {
      continue;
    }

    for (const command of pipeline.commands) {
      if (command.command === undefined) {
        continue;
      }

      const resolution = resolveCommand(options.registry, command.command.value);

      if (resolution.kind === "found" && resolution.command.pipeline === "effects") {
        return completedLine(
          rejectedPipelineOutcome(resolution.command.metadata.name),
        );
      }
    }
  }

  const events: CommandLineEvent[] = [];
  let currentDirectory = options.request.currentDirectory;
  let outcome: CommandOutcome | undefined;

  for (const pipeline of parseResult.pipelines) {
    if (options.signal.aborted || outcome?.kind === "cancelled") {
      const cancelled = cancelledOutcome();
      appendOutcome(events, cancelled);
      return lineOutcome(events, cancelled);
    }

    if (!shouldExecute(pipeline.connector, outcome)) {
      continue;
    }

    outcome = await executePipeline(pipeline, currentDirectory, events, options);
    if (pipeline.commands.length === 1) {
      currentDirectory = nextCurrentDirectory(currentDirectory, outcome);
    }

    if (outcome.kind === "cancelled") {
      return lineOutcome(events, outcome);
    }

    if (options.signal.aborted) {
      const cancelled = cancelledOutcome();
      appendOutcome(events, cancelled);
      return lineOutcome(events, cancelled);
    }

    if (reachesInteractionBoundary(outcome)) {
      return lineOutcome(events, outcome);
    }
  }

  return outcome === undefined
    ? completedLine(emptyCommandOutcome())
    : lineOutcome(events, outcome);
}
