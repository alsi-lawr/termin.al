import {
  lexArguments,
  type ArgumentLexerError,
} from "../../domain/terminal/ArgumentLexer.ts";
import {
  createShellDiagnosticId,
  type CommandOutcome,
  type ShellDiagnostic,
  type ShellCommandRequest,
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

function parseDiagnostic(error: ArgumentLexerError): ShellDiagnostic {
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
  }
}

function parseFailureOutcome(error: ArgumentLexerError): CommandOutcome {
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

function executionFailureOutcome(commandName: string): CommandOutcome {
  return {
    kind: "failed",
    failure: { kind: "execution-error", commandName },
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

export async function executeCommandLine({
  registry,
  request,
  signal,
}: ExecuteCommandLineOptions): Promise<CommandOutcome> {
  if (signal.aborted) {
    return cancelledOutcome();
  }

  const lexicalResult = lexArguments(request.source);

  if (lexicalResult.kind === "error") {
    return parseFailureOutcome(lexicalResult.error);
  }

  const [commandArgument, ...argumentsList] = lexicalResult.arguments;

  if (!commandArgument) {
    return emptyCommandOutcome();
  }

  const resolution = resolveCommand(registry, commandArgument.value);

  if (resolution.kind === "missing") {
    return missingCommandOutcome(resolution.requestedName);
  }

  try {
    const outcome = await resolution.command.execute(
      {
        source: request.source,
        name: resolution.command.metadata.name,
        arguments: argumentsList.map((argument) => argument.value),
        optionTerminator: lexicalResult.optionTerminator,
      },
      {
        shellId: request.shellId,
        sessionId: request.sessionId,
        currentDirectory: request.currentDirectory,
        commandHistory: request.commandHistory,
        registry,
        signal,
      },
    );

    if (signal.aborted) {
      return cancelledOutcome();
    }

    return outcome;
  } catch {
    if (signal.aborted) {
      return cancelledOutcome();
    }

    return executionFailureOutcome(resolution.command.metadata.name);
  }
}
