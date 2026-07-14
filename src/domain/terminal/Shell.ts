import {
  backspacePromptBuffer,
  createEmptyPromptBuffer,
  createPromptBuffer,
  deletePromptBufferAtCursor,
  insertPromptText,
  movePromptCursorLeft,
  movePromptCursorRight,
  setPromptMode,
  type PromptBuffer,
  type PromptMode,
} from "./PromptBuffer.ts";
import type { ArgumentLexerError, SourceOffset } from "./ArgumentLexer.ts";

declare const shellIdBrand: unique symbol;
declare const shellSessionIdBrand: unique symbol;
declare const commandIdBrand: unique symbol;
declare const shellHistoryEntryIdBrand: unique symbol;

export type ShellId = string & {
  readonly [shellIdBrand]: "ShellId";
};

export type ShellSessionId = string & {
  readonly [shellSessionIdBrand]: "ShellSessionId";
};

export type CommandId = string & {
  readonly [commandIdBrand]: "CommandId";
};

export type ShellHistoryEntryId = string & {
  readonly [shellHistoryEntryIdBrand]: "ShellHistoryEntryId";
};

export type ShellDiagnostic =
  | Readonly<{
      kind: "parse";
      code:
        | "parse.unterminated-single-quote"
        | "parse.unterminated-double-quote"
        | "parse.trailing-escape";
      message: string;
      position: SourceOffset;
    }>
  | Readonly<{
      kind: "command";
      code: "command.empty" | "command.not-found" | "command.rejected";
      message: string;
    }>
  | Readonly<{
      kind: "runtime";
      code: "runtime.execution-failed" | "runtime.cancelled";
      message: string;
    }>;

export type ShellOutput =
  | Readonly<{
      kind: "text";
      text: string;
    }>
  | Readonly<{
      kind: "table";
      columns: ReadonlyArray<string>;
      rows: ReadonlyArray<ReadonlyArray<string>>;
    }>
  | Readonly<{
      kind: "diagnostic";
      diagnostic: ShellDiagnostic;
    }>
  | Readonly<{
      kind: "prompt";
      label: string;
      message: string;
    }>
  | Readonly<{
      kind: "rich";
      title: string;
      lines: ReadonlyArray<string>;
    }>;

export type CommandEffect =
  | Readonly<{ kind: "clear-scrollback" }>
  | Readonly<{
      kind: "request-public-prompt";
      label: string;
    }>;

export type CommandFailure =
  | Readonly<{
      kind: "empty-command";
    }>
  | Readonly<{
      kind: "parse-error";
      error: ArgumentLexerError;
    }>
  | Readonly<{
      kind: "command-not-found";
      commandName: string;
    }>
  | Readonly<{
      kind: "command-rejected";
      commandName: string;
      message: string;
    }>
  | Readonly<{
      kind: "execution-error";
      commandName: string;
    }>;

export type CommandOutcome =
  | Readonly<{
      kind: "succeeded";
      outputs: ReadonlyArray<ShellOutput>;
      effects: ReadonlyArray<CommandEffect>;
    }>
  | Readonly<{
      kind: "failed";
      failure: CommandFailure;
      diagnostics: ReadonlyArray<ShellDiagnostic>;
    }>
  | Readonly<{
      kind: "cancelled";
      diagnostic: Extract<ShellDiagnostic, { kind: "runtime" }>;
    }>;

export type ShellCommandRequest = Readonly<{
  id: CommandId;
  shellId: ShellId;
  sessionId: ShellSessionId;
  source: string;
}>;

export type CommandLifecycle =
  | Readonly<{ kind: "idle" }>
  | Readonly<{
      kind: "running";
      command: ShellCommandRequest;
    }>
  | Readonly<{
      kind: "cancelling";
      command: ShellCommandRequest;
    }>;

export type ShellHistoryEntry = Readonly<{
  id: ShellHistoryEntryId;
  command: ShellCommandRequest;
  outcome: CommandOutcome;
}>;

export type ShellEffect =
  | Readonly<{ kind: "none" }>
  | Readonly<{
      kind: "execute-command";
      command: ShellCommandRequest;
    }>
  | Readonly<{
      kind: "cancel-command";
      commandId: CommandId;
    }>;

export type ShellState = Readonly<{
  id: ShellId;
  sessionId: ShellSessionId;
  input: PromptBuffer;
  lifecycle: CommandLifecycle;
  history: ReadonlyArray<ShellHistoryEntry>;
  historyLimit: number;
  nextCommandSequence: number;
  nextHistorySequence: number;
  pendingEffect: ShellEffect;
}>;

export type ShellStatus =
  | Readonly<{
      kind: "ready";
      mode: PromptMode;
    }>
  | Readonly<{
      kind: "running";
      commandId: CommandId;
    }>
  | Readonly<{
      kind: "cancelling";
      commandId: CommandId;
    }>;

export type CreateShellStateOptions = Readonly<{
  id: ShellId;
  sessionId: ShellSessionId;
  historyLimit: number;
}>;

export type ShellAction =
  | Readonly<{
      kind: "input.insert";
      text: string;
    }>
  | Readonly<{ kind: "input.move-left" }>
  | Readonly<{ kind: "input.move-right" }>
  | Readonly<{ kind: "input.backspace" }>
  | Readonly<{ kind: "input.delete" }>
  | Readonly<{
      kind: "input.set-mode";
      mode: PromptMode;
    }>
  | Readonly<{ kind: "command.submit" }>
  | Readonly<{ kind: "command.cancel" }>
  | Readonly<{
      kind: "command.settled";
      commandId: CommandId;
      outcome: CommandOutcome;
    }>
  | Readonly<{
      kind: "effect.consumed";
      commandId: CommandId;
    }>;

const stableIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;

function assertStableIdentifier(value: string, label: string): void {
  if (!stableIdentifierPattern.test(value)) {
    throw new Error(`${label} values must be stable identifier strings.`);
  }
}

function createCommandId(
  sessionId: ShellSessionId,
  sequence: number,
): CommandId {
  return `${sessionId}-command-${sequence}` as CommandId;
}

function createHistoryEntryId(
  sessionId: ShellSessionId,
  sequence: number,
): ShellHistoryEntryId {
  return `${sessionId}-history-${sequence}` as ShellHistoryEntryId;
}

function createEmptyInput(mode: PromptMode): PromptBuffer {
  return createPromptBuffer({ value: "", cursor: 0, mode });
}

function appendHistory(
  history: ReadonlyArray<ShellHistoryEntry>,
  historyLimit: number,
  entry: ShellHistoryEntry,
): ReadonlyArray<ShellHistoryEntry> {
  const nextHistory = [...history, entry];

  if (nextHistory.length <= historyLimit) {
    return nextHistory;
  }

  return nextHistory.slice(nextHistory.length - historyLimit);
}

function canEditPrompt(state: ShellState): boolean {
  return state.lifecycle.kind === "idle";
}

export function createShellId(value: string): ShellId {
  assertStableIdentifier(value, "Shell IDs");
  return value as ShellId;
}

export function createShellSessionId(value: string): ShellSessionId {
  assertStableIdentifier(value, "Shell session IDs");
  return value as ShellSessionId;
}

export function createShellState({
  id,
  sessionId,
  historyLimit,
}: CreateShellStateOptions): ShellState {
  if (!Number.isSafeInteger(historyLimit) || historyLimit < 1) {
    throw new Error("Shell history limits must be positive integers.");
  }

  return {
    id,
    sessionId,
    input: createEmptyPromptBuffer(),
    lifecycle: { kind: "idle" },
    history: [],
    historyLimit,
    nextCommandSequence: 1,
    nextHistorySequence: 1,
    pendingEffect: { kind: "none" },
  };
}

export function getShellStatus(state: ShellState): ShellStatus {
  switch (state.lifecycle.kind) {
    case "idle":
      return { kind: "ready", mode: state.input.mode };
    case "running":
      return {
        kind: "running",
        commandId: state.lifecycle.command.id,
      };
    case "cancelling":
      return {
        kind: "cancelling",
        commandId: state.lifecycle.command.id,
      };
  }
}

export function reduceShellState(
  state: ShellState,
  action: ShellAction,
): ShellState {
  switch (action.kind) {
    case "input.insert":
      if (!canEditPrompt(state)) {
        return state;
      }

      return { ...state, input: insertPromptText(state.input, action.text) };
    case "input.move-left":
      if (!canEditPrompt(state)) {
        return state;
      }

      return { ...state, input: movePromptCursorLeft(state.input) };
    case "input.move-right":
      if (!canEditPrompt(state)) {
        return state;
      }

      return { ...state, input: movePromptCursorRight(state.input) };
    case "input.backspace":
      if (!canEditPrompt(state)) {
        return state;
      }

      return { ...state, input: backspacePromptBuffer(state.input) };
    case "input.delete":
      if (!canEditPrompt(state)) {
        return state;
      }

      return {
        ...state,
        input: deletePromptBufferAtCursor(state.input),
      };
    case "input.set-mode":
      if (!canEditPrompt(state)) {
        return state;
      }

      return {
        ...state,
        input: setPromptMode(state.input, action.mode),
      };
    case "command.submit": {
      if (!canEditPrompt(state) || state.input.value.trim().length === 0) {
        return state;
      }

      const command: ShellCommandRequest = {
        id: createCommandId(state.sessionId, state.nextCommandSequence),
        shellId: state.id,
        sessionId: state.sessionId,
        source: state.input.value,
      };

      return {
        ...state,
        input: createEmptyInput(state.input.mode),
        lifecycle: { kind: "running", command },
        nextCommandSequence: state.nextCommandSequence + 1,
        pendingEffect: { kind: "execute-command", command },
      };
    }
    case "command.cancel":
      if (state.lifecycle.kind !== "running") {
        return state;
      }

      return {
        ...state,
        lifecycle: { kind: "cancelling", command: state.lifecycle.command },
        pendingEffect: {
          kind: "cancel-command",
          commandId: state.lifecycle.command.id,
        },
      };
    case "command.settled":
      if (
        state.lifecycle.kind === "idle" ||
        state.lifecycle.command.id !== action.commandId
      ) {
        return state;
      }

      return {
        ...state,
        lifecycle: { kind: "idle" },
        history: appendHistory(state.history, state.historyLimit, {
          id: createHistoryEntryId(
            state.sessionId,
            state.nextHistorySequence,
          ),
          command: state.lifecycle.command,
          outcome: action.outcome,
        }),
        nextHistorySequence: state.nextHistorySequence + 1,
        pendingEffect: { kind: "none" },
      };
    case "effect.consumed":
      switch (state.pendingEffect.kind) {
        case "none":
          return state;
        case "execute-command":
          if (state.pendingEffect.command.id !== action.commandId) {
            return state;
          }

          return { ...state, pendingEffect: { kind: "none" } };
        case "cancel-command":
          if (state.pendingEffect.commandId !== action.commandId) {
            return state;
          }

          return { ...state, pendingEffect: { kind: "none" } };
      }
  }
}
