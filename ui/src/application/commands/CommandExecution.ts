import {
  lexArguments,
  createArgumentIndex,
  type ArgumentLexerToken,
  type LexedArgument,
  type OptionTerminator,
  type ShellSyntaxError,
} from "../../domain/terminal/ArgumentLexer.ts";
import {
  expandVirtualPathGlob,
  type VirtualDirectoryPath,
} from "../../domain/filesystem/VirtualFilesystem.ts";
import {
  createShellDiagnosticId,
  createShellOutputId,
  type CommandLineEvent,
  type CommandLineOutcome,
  type CommandOutcome,
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

type ListConnector = "always" | "and" | "or";

type ParsedCommand = Readonly<{
  command: LexedArgument;
  arguments: ReadonlyArray<LexedArgument>;
  optionTerminator: OptionTerminator;
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
  let hasEmptyCommand = false;
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

    while (tokenIndex < tokens.length) {
      const token = tokens[tokenIndex];

      if (token === undefined || token.kind === "operator") {
        break;
      }

      if (token.kind === "argument") {
        if (command === undefined) {
          command = token;
        } else {
          argumentsList.push(token);
        }
      } else {
        optionTerminator = {
          kind: "present",
          argumentIndex: token.argumentIndex,
          sourceStart: token.sourceStart,
          sourceEnd: token.sourceEnd,
        };
      }

      tokenIndex += 1;
    }

    if (command === undefined) {
      hasEmptyCommand = true;
    } else {
      commands.push({
        command,
        arguments: argumentsList,
        optionTerminator,
      });
    }

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

  return hasEmptyCommand
    ? { kind: "empty" }
    : { kind: "success", pipelines };
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

async function executePipeline(
  pipeline: ParsedPipeline,
  currentDirectory: VirtualDirectoryPath,
  events: CommandLineEvent[],
  options: ExecuteCommandLineOptions,
): Promise<CommandOutcome> {
  const resolved = pipeline.commands.map((command) => ({
    command,
    resolution: resolveCommand(options.registry, command.command.value),
  }));

  if (resolved.length > 1) {
    const rejected = resolved.find(
      (entry) =>
        entry.resolution.kind === "found" &&
        entry.resolution.command.pipeline === "effects",
    );

    if (rejected?.resolution.kind === "found") {
      const outcome = rejectedPipelineOutcome(
        rejected.resolution.command.metadata.name,
      );
      appendOutcome(events, outcome);
      return outcome;
    }
  }

  let stdin: CommandInvocation["stdin"] = { kind: "none" };
  let outcome: CommandOutcome | undefined;

  for (const entry of resolved) {
    if (options.signal.aborted) {
      const cancelled = cancelledOutcome();
      appendOutcome(events, cancelled);
      return cancelled;
    }

    outcome = entry.resolution.kind === "missing"
      ? missingCommandOutcome(entry.resolution.requestedName)
      : await executeCommand(
        entry.command,
        entry.resolution.command,
        stdin,
        currentDirectory,
        options,
      );

    const isFinal = entry === resolved[resolved.length - 1];

    if (outcome.kind !== "succeeded" || isFinal) {
      appendOutcome(events, outcome);
    } else {
      for (const output of outcome.outputs) {
        if (output.kind === "diagnostic") {
          events.push(outputEvent(output, events.length + 1));
        }
      }
    }

    if (outcome.kind === "cancelled") {
      return outcome;
    }

    if (options.signal.aborted) {
      const cancelled = cancelledOutcome();
      appendOutcome(events, cancelled);
      return cancelled;
    }

    stdin = {
      kind: "text",
      text: outcome.kind === "succeeded"
        ? outcome.outputs
          .flatMap((output) => output.kind === "text" ? [output.text] : [])
          .join("\n")
        : "",
    };
  }

  if (outcome === undefined) {
    throw new Error("A parsed pipeline must contain a command.");
  }

  return outcome;
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
