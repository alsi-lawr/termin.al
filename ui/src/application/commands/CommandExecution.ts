import {
  lexArguments,
  type ArgumentLexerToken,
  type LexedArgument,
  type OptionTerminator,
  type ShellSyntaxError,
  type SourceOffset,
} from "../../domain/terminal/ArgumentLexer.ts";
import {
  createShellDiagnosticId,
  createShellOutputId,
  type CommandOutcome,
  type CommandEffect,
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
  arguments: ReadonlyArray<LexedArgument>;
  optionTerminator: OptionTerminator;
}>;

type ParsedPipeline =
  | Readonly<{
      kind: "command";
      command: ParsedCommand;
    }>
  | Readonly<{
      kind: "pipeline";
      commands: ReadonlyArray<ParsedCommand>;
      position: SourceOffset;
    }>;

type ConditionalCommand = Readonly<{
  connector: "first" | "and" | "or";
  pipeline: ParsedPipeline;
}>;

type ParsedCommandLine = ReadonlyArray<ReadonlyArray<ConditionalCommand>>;

type ParsedValue<Value> = Readonly<{
  kind: "success";
  value: Value;
  nextIndex: number;
}>;

type ParseResult<Value> =
  | ParsedValue<Value>
  | Readonly<{
      kind: "error";
      error: ShellSyntaxError;
    }>;

type CommandLineParseResult =
  | Readonly<{ kind: "empty" }>
  | Readonly<{
      kind: "success";
      commandLine: ParsedCommandLine;
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

function parseCommand(
  tokens: ReadonlyArray<ArgumentLexerToken>,
  startIndex: number,
): ParseResult<ParsedCommand> {
  const firstToken = tokens[startIndex];

  if (firstToken === undefined || firstToken.kind === "operator") {
    const position = firstToken?.position;

    if (position === undefined) {
      throw new Error("A trailing operator must be handled by its owning parser.");
    }

    return {
      kind: "error",
      error: { kind: "unexpected-operator", position },
    };
  }

  const argumentsList: LexedArgument[] = [];
  let optionTerminator: OptionTerminator = { kind: "absent" };
  let nextIndex = startIndex;

  while (nextIndex < tokens.length) {
    const token = tokens[nextIndex];

    if (token === undefined || token.kind === "operator") {
      break;
    }

    if (token.kind === "argument") {
      argumentsList.push(token);
    } else {
      optionTerminator = {
        kind: "present",
        argumentIndex: token.argumentIndex,
        sourceStart: token.sourceStart,
        sourceEnd: token.sourceEnd,
      };
    }

    nextIndex += 1;
  }

  return {
    kind: "success",
    value: { arguments: argumentsList, optionTerminator },
    nextIndex,
  };
}

function parsePipeline(
  tokens: ReadonlyArray<ArgumentLexerToken>,
  startIndex: number,
): ParseResult<ParsedPipeline> {
  const firstCommand = parseCommand(tokens, startIndex);

  if (firstCommand.kind === "error") {
    return firstCommand;
  }

  const commands = [firstCommand.value];
  let nextIndex = firstCommand.nextIndex;
  let pipelinePosition: SourceOffset | undefined;

  while (nextIndex < tokens.length) {
    const token = tokens[nextIndex];

    if (token?.kind !== "operator" || token.operator !== "|") {
      break;
    }

    pipelinePosition ??= token.position;
    const commandIndex = nextIndex + 1;

    if (commandIndex >= tokens.length) {
      return {
        kind: "error",
        error: { kind: "trailing-operator", position: token.position },
      };
    }

    const command = parseCommand(tokens, commandIndex);

    if (command.kind === "error") {
      return command;
    }

    commands.push(command.value);
    nextIndex = command.nextIndex;
  }

  if (pipelinePosition === undefined) {
    return {
      kind: "success",
      value: { kind: "command", command: firstCommand.value },
      nextIndex,
    };
  }

  return {
    kind: "success",
    value: { kind: "pipeline", commands, position: pipelinePosition },
    nextIndex,
  };
}

function parseAndOrList(
  tokens: ReadonlyArray<ArgumentLexerToken>,
  startIndex: number,
): ParseResult<ReadonlyArray<ConditionalCommand>> {
  const firstPipeline = parsePipeline(tokens, startIndex);

  if (firstPipeline.kind === "error") {
    return firstPipeline;
  }

  const commands: ConditionalCommand[] = [
    { connector: "first", pipeline: firstPipeline.value },
  ];
  let nextIndex = firstPipeline.nextIndex;

  while (nextIndex < tokens.length) {
    const token = tokens[nextIndex];

    if (
      token?.kind !== "operator" ||
      (token.operator !== "&&" && token.operator !== "||")
    ) {
      break;
    }

    const pipelineIndex = nextIndex + 1;

    if (pipelineIndex >= tokens.length) {
      return {
        kind: "error",
        error: { kind: "trailing-operator", position: token.position },
      };
    }

    const pipeline = parsePipeline(tokens, pipelineIndex);

    if (pipeline.kind === "error") {
      return pipeline;
    }

    commands.push({
      connector: token.operator === "&&" ? "and" : "or",
      pipeline: pipeline.value,
    });
    nextIndex = pipeline.nextIndex;
  }

  return { kind: "success", value: commands, nextIndex };
}

function parseCommandLine(
  tokens: ReadonlyArray<ArgumentLexerToken>,
): CommandLineParseResult {
  if (tokens.length === 0) {
    return { kind: "empty" };
  }

  const lists: Array<ReadonlyArray<ConditionalCommand>> = [];
  let nextIndex = 0;

  while (nextIndex < tokens.length) {
    const list = parseAndOrList(tokens, nextIndex);

    if (list.kind === "error") {
      return list;
    }

    lists.push(list.value);
    nextIndex = list.nextIndex;

    if (nextIndex >= tokens.length) {
      break;
    }

    const token = tokens[nextIndex];

    if (token?.kind !== "operator" || token.operator !== ";") {
      if (token?.kind !== "operator") {
        throw new Error("Command parsing stopped before a non-operator token.");
      }

      return {
        kind: "error",
        error: { kind: "unexpected-operator", position: token.position },
      };
    }

    nextIndex += 1;

    if (nextIndex >= tokens.length) {
      return {
        kind: "error",
        error: { kind: "trailing-operator", position: token.position },
      };
    }
  }

  return { kind: "success", commandLine: lists };
}

function pipelinePosition(commandLine: ParsedCommandLine): SourceOffset | undefined {
  for (const list of commandLine) {
    for (const command of list) {
      if (command.pipeline.kind === "pipeline") {
        return command.pipeline.position;
      }
    }
  }

  return undefined;
}

function hasCommandName(commandLine: ParsedCommandLine): boolean {
  return commandLine.every((list) =>
    list.every((command) => {
      const commands = command.pipeline.kind === "command"
        ? [command.pipeline.command]
        : command.pipeline.commands;

      return commands.every((candidate) => candidate.arguments.length > 0);
    })
  );
}

function shouldExecute(
  connector: ConditionalCommand["connector"],
  previousOutcome: CommandOutcome | undefined,
): boolean {
  if (connector === "first" || previousOutcome === undefined) {
    return true;
  }

  if (previousOutcome.kind === "cancelled") {
    return false;
  }

  return connector === "and"
    ? previousOutcome.kind === "succeeded"
    : previousOutcome.kind === "failed";
}

function listOutput(output: ShellOutput, sequence: number): ShellOutput {
  const id = createShellOutputId(`command-list-output-${sequence}`);

  switch (output.kind) {
    case "text":
      return { ...output, id };
    case "diagnostic":
      return { ...output, id };
    case "prompt":
      return { ...output, id };
  }
}

function appendCommandResult(
  outcome: CommandOutcome,
  outputs: ShellOutput[],
  effects: CommandEffect[],
): void {
  if (outcome.kind === "succeeded") {
    for (const output of outcome.outputs) {
      outputs.push(listOutput(output, outputs.length + 1));
    }

    effects.push(...outcome.effects);
    return;
  }

  if (outcome.kind === "failed") {
    for (const diagnostic of outcome.diagnostics) {
      outputs.push(listOutput({
        kind: "diagnostic",
        id: createShellOutputId("command-list-diagnostic"),
        diagnostic,
      }, outputs.length + 1));
    }
  }
}

async function executeCommand(
  command: ParsedCommand,
  options: ExecuteCommandLineOptions,
): Promise<CommandOutcome> {
  const [commandArgument, ...argumentsList] = command.arguments;

  if (commandArgument === undefined) {
    return emptyCommandOutcome();
  }

  const resolution = resolveCommand(options.registry, commandArgument.value);

  if (resolution.kind === "missing") {
    return missingCommandOutcome(resolution.requestedName);
  }

  try {
    const outcome = await resolution.command.execute(
      {
        source: options.request.source,
        name: resolution.command.metadata.name,
        arguments: argumentsList.map((argument) => argument.value),
        optionTerminator: command.optionTerminator,
      },
      {
        shellId: options.request.shellId,
        sessionId: options.request.sessionId,
        currentDirectory: options.request.currentDirectory,
        commandHistory: options.request.commandHistory,
        registry: options.registry,
        signal: options.signal,
      },
    );

    if (options.signal.aborted) {
      return cancelledOutcome();
    }

    return outcome;
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

export async function executeCommandLine(
  options: ExecuteCommandLineOptions,
): Promise<CommandOutcome> {
  if (options.signal.aborted) {
    return cancelledOutcome();
  }

  const lexicalResult = lexArguments(options.request.source);

  if (lexicalResult.kind === "error") {
    return parseFailureOutcome(lexicalResult.error);
  }

  const parseResult = parseCommandLine(lexicalResult.tokens);

  if (parseResult.kind === "empty") {
    return emptyCommandOutcome();
  }

  if (parseResult.kind === "error") {
    return parseFailureOutcome(parseResult.error);
  }

  const unsupportedPosition = pipelinePosition(parseResult.commandLine);

  if (unsupportedPosition !== undefined) {
    return unsupportedPipelineOutcome(unsupportedPosition);
  }

  if (!hasCommandName(parseResult.commandLine)) {
    return emptyCommandOutcome();
  }

  let outcome: CommandOutcome | undefined;
  const outputs: ShellOutput[] = [];
  const effects: CommandEffect[] = [];

  for (const list of parseResult.commandLine) {
    for (const conditionalCommand of list) {
      if (options.signal.aborted || outcome?.kind === "cancelled") {
        return cancelledOutcome();
      }

      if (!shouldExecute(conditionalCommand.connector, outcome)) {
        continue;
      }

      if (conditionalCommand.pipeline.kind !== "command") {
        throw new Error("Unsupported pipelines must be rejected before execution.");
      }

      outcome = await executeCommand(conditionalCommand.pipeline.command, options);
      appendCommandResult(outcome, outputs, effects);
    }
  }

  if (outcome?.kind === "succeeded") {
    return { kind: "succeeded", outputs, effects };
  }

  return outcome ?? emptyCommandOutcome();
}
