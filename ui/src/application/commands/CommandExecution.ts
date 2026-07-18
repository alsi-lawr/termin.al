import {
  lexArguments,
  type ArgumentLexerToken,
  type LexedArgument,
  type OptionTerminator,
  type ShellSyntaxError,
  type SourceOffset,
} from "../../domain/terminal/ArgumentLexer.ts";
import type { VirtualDirectoryPath } from "../../domain/filesystem/VirtualFilesystem.ts";
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
  type CommandRegistry,
} from "./CommandRegistry.ts";

export type ExecuteCommandLineOptions = Readonly<{
  registry: CommandRegistry;
  request: ShellCommandRequest;
  signal: AbortSignal;
}>;

type ParsedCommand = Readonly<{
  connector: "always" | "and" | "or";
  command: LexedArgument;
  arguments: ReadonlyArray<LexedArgument>;
  optionTerminator: OptionTerminator;
}>;

type CommandLineParseResult =
  | Readonly<{ kind: "empty" }>
  | Readonly<{
      kind: "success";
      commands: ReadonlyArray<ParsedCommand>;
      pipelinePosition: SourceOffset | undefined;
    }>
  | Readonly<{
      kind: "error";
      error: ShellSyntaxError;
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

function unsupportedPipelineOutcome(position: SourceOffset): CommandOutcome {
  return {
    kind: "failed",
    failure: { kind: "unsupported-pipeline", position },
    diagnostics: [
      {
        kind: "command",
        id: createShellDiagnosticId("pipeline-unsupported"),
        code: "command.pipeline-unsupported",
        message: "Pipelines are not supported yet.",
        position,
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

  const commands: ParsedCommand[] = [];
  let connector: ParsedCommand["connector"] = "always";
  let hasEmptyCommand = false;
  let pipelinePosition: SourceOffset | undefined;
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
        connector,
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
      pipelinePosition ??= operator.position;
      connector = "always";
    } else if (operator.operator === "&&") {
      connector = "and";
    } else if (operator.operator === "||") {
      connector = "or";
    } else {
      connector = "always";
    }

    tokenIndex += 1;
  }

  return hasEmptyCommand
    ? { kind: "empty" }
    : { kind: "success", commands, pipelinePosition };
}

function shouldExecute(
  connector: ParsedCommand["connector"],
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

async function executeCommand(
  command: ParsedCommand,
  currentDirectory: VirtualDirectoryPath,
  options: ExecuteCommandLineOptions,
): Promise<CommandOutcome> {
  const resolution = resolveCommand(options.registry, command.command.value);

  if (resolution.kind === "missing") {
    return missingCommandOutcome(resolution.requestedName);
  }

  try {
    return await resolution.command.execute(
      {
        source: options.request.source,
        name: resolution.command.metadata.name,
        arguments: command.arguments.map((argument) => argument.value),
        optionTerminator: command.optionTerminator,
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

    return executionFailureOutcome(resolution.command.metadata.name, cause);
  }
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

  if (parseResult.pipelinePosition !== undefined) {
    return completedLine(unsupportedPipelineOutcome(parseResult.pipelinePosition));
  }

  const events: CommandLineEvent[] = [];
  let currentDirectory = options.request.currentDirectory;
  let outcome: CommandOutcome | undefined;

  for (const command of parseResult.commands) {
    if (options.signal.aborted || outcome?.kind === "cancelled") {
      const cancelled = cancelledOutcome();
      appendOutcome(events, cancelled);
      return lineOutcome(events, cancelled);
    }

    if (!shouldExecute(command.connector, outcome)) {
      continue;
    }

    outcome = await executeCommand(command, currentDirectory, options);
    appendOutcome(events, outcome);
    currentDirectory = nextCurrentDirectory(currentDirectory, outcome);

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
