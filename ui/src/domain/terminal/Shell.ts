import type { ShellSyntaxError, SourceOffset } from "./ArgumentLexer.ts";
import {
  createCompletionEdit,
  createCompletionPrefixEdit,
  longestCommonCompletionPrefix,
  type CompletionCandidate,
  type CompletionRequest,
  type CompletionResult,
} from "./Completion.ts";
import {
  backspaceShellLine,
  createEmptyShellLine,
  createShellLine,
  deleteShellLine,
  deleteShellLinePreviousWord,
  insertShellLineText,
  moveShellLineCursor,
  moveShellLineCursorEnd,
  moveShellLineCursorLeft,
  moveShellLineCursorNextWord,
  moveShellLineCursorPreviousWord,
  moveShellLineCursorRight,
  moveShellLineCursorStart,
  replaceShellLine,
  type ShellLine,
} from "./ShellLine.ts";
import type { VirtualDirectoryPath } from "../filesystem/VirtualFilesystem.ts";
import type {
  ViewerContent,
  ViewerOpenDisposition,
} from "../../content/ViewerContent.ts";

declare const shellIdBrand: unique symbol;
declare const shellSessionIdBrand: unique symbol;
declare const commandIdBrand: unique symbol;
declare const shellHistoryEntryIdBrand: unique symbol;
declare const commandHistoryEntryIdBrand: unique symbol;
declare const secretPromptIdBrand: unique symbol;
declare const secretPromptValueBrand: unique symbol;
declare const shellDiagnosticIdBrand: unique symbol;
declare const shellOutputIdBrand: unique symbol;

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

export type CommandHistoryEntryId = string & {
  readonly [commandHistoryEntryIdBrand]: "CommandHistoryEntryId";
};

export type SecretPromptId = string & {
  readonly [secretPromptIdBrand]: "SecretPromptId";
};

export type SecretPromptValue = string & {
  readonly [secretPromptValueBrand]: "SecretPromptValue";
};

export type ShellDiagnosticId = string & {
  readonly [shellDiagnosticIdBrand]: "ShellDiagnosticId";
};

export type ShellOutputId = string & {
  readonly [shellOutputIdBrand]: "ShellOutputId";
};

export type ShellDiagnostic =
  | Readonly<{
      kind: "parse";
      id: ShellDiagnosticId;
      code:
        | "parse.unterminated-single-quote"
        | "parse.unterminated-double-quote"
        | "parse.trailing-escape"
        | "parse.unsupported-background-operator"
        | "parse.unexpected-operator"
        | "parse.trailing-operator";
      message: string;
      position: SourceOffset;
    }>
  | Readonly<{
      kind: "command";
      id: ShellDiagnosticId;
      code: "command.empty" | "command.not-found" | "command.rejected";
      message: string;
    }>
  | Readonly<{
      kind: "runtime";
      id: ShellDiagnosticId;
      code:
        | "runtime.execution-failed"
        | "runtime.cancelled"
        | "runtime.content-unavailable"
        | "runtime.truncated";
      message: string;
    }>;

export type ShellOutput =
  | Readonly<{
      kind: "text";
      id: ShellOutputId;
      text: string;
    }>
  | Readonly<{
      kind: "diagnostic";
      id: ShellOutputId;
      diagnostic: ShellDiagnostic;
    }>
  | Readonly<{
      kind: "prompt";
      id: ShellOutputId;
      label: string;
      message: string;
    }>;

export type SecretPromptRequest = Readonly<{
  id: SecretPromptId;
  label: string;
}>;

export type SecretPromptEffect =
  | Readonly<{
      kind: "secret-submitted";
      requestId: SecretPromptId;
      value: SecretPromptValue;
    }>
  | Readonly<{
      kind: "secret-cancelled";
      requestId: SecretPromptId;
    }>;

export type CommandEffect =
  | Readonly<{ kind: "clear-scrollback" }>
  | Readonly<{
      kind: "set-current-directory";
      directory: VirtualDirectoryPath;
    }>
  | Readonly<{
      kind: "open-viewer";
      viewer: ViewerContent;
      disposition: ViewerOpenDisposition;
    }>
  | Readonly<{
      kind: "request-secret-prompt";
      request: SecretPromptRequest;
    }>;

export type CommandFailure =
  | Readonly<{
      kind: "empty-command";
    }>
  | Readonly<{
      kind: "parse-error";
      error: ShellSyntaxError;
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
      cause: Error;
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

export type CommandLineEvent =
  | Readonly<{
      kind: "output";
      output: ShellOutput;
    }>
  | Readonly<{
      kind: "effect";
      effect: CommandEffect;
    }>;

export type CommandLineOutcome =
  | Readonly<{
      kind: "succeeded";
      events: ReadonlyArray<CommandLineEvent>;
    }>
  | Readonly<{
      kind: "failed";
      events: ReadonlyArray<CommandLineEvent>;
      failure: CommandFailure;
    }>
  | Readonly<{
      kind: "cancelled";
      events: ReadonlyArray<CommandLineEvent>;
    }>;

type ShellHistoryFailure =
  | Exclude<CommandFailure, { kind: "execution-error" }>
  | Readonly<{
      kind: "execution-error";
      commandName: string;
    }>;

export type ShellHistoryOutcome =
  | Exclude<CommandLineOutcome, { kind: "failed" }>
  | Readonly<{
      kind: "failed";
      failure: ShellHistoryFailure;
      events: ReadonlyArray<CommandLineEvent>;
    }>;

export type ShellCommandRequest = Readonly<{
  id: CommandId;
  shellId: ShellId;
  sessionId: ShellSessionId;
  source: string;
  currentDirectory: VirtualDirectoryPath;
  commandHistory: ReadonlyArray<CommandHistoryEntry>;
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
  outcome: ShellHistoryOutcome;
}>;

export type CommandHistoryEntry = Readonly<{
  id: CommandHistoryEntryId;
  source: string;
  currentDirectory: VirtualDirectoryPath;
}>;

export type SecretPromptState = Readonly<{
  request: SecretPromptRequest;
  line: ShellLine;
}>;

export type ActiveShellPrompt =
  | Readonly<{
      kind: "command";
      line: ShellLine;
    }>
  | Readonly<{
      kind: "secret";
      prompt: SecretPromptState;
    }>;

export type SecretPrompt =
  | Readonly<{ kind: "none" }>
  | Readonly<{
      kind: "active";
      prompt: SecretPromptState;
    }>;

export type HistoryNavigation =
  | Readonly<{ kind: "not-browsing" }>
  | Readonly<{
      kind: "browsing";
      index: number;
      draft: ShellLine;
    }>;

export type ShellCompletionSelection =
  | Readonly<{ kind: "none" }>
  | Readonly<{
      kind: "selected";
      index: number;
    }>;

export type ShellCompletion =
  | Readonly<{ kind: "idle" }>
  | Readonly<{
      kind: "pending";
      request: CompletionRequest;
    }>
  | Readonly<{
      kind: "suggestions";
      request: CompletionRequest;
      candidates: ReadonlyArray<CompletionCandidate>;
      selection: ShellCompletionSelection;
    }>;

export type ShellAutosuggestion =
  | Readonly<{ kind: "none" }>
  | Readonly<{
      kind: "suggestion";
      value: string;
      suffix: string;
    }>;

export type ShellAutosuggestionState =
  | Readonly<{ kind: "available" }>
  | Readonly<{ kind: "dismissed" }>;

export type CompletionCycleDirection = "next" | "previous";

export type ShellEffect =
  | Readonly<{ kind: "none" }>
  | Readonly<{
      kind: "execute-command";
      command: ShellCommandRequest;
    }>
  | Readonly<{
      kind: "cancel-command";
      commandId: CommandId;
    }>
  | SecretPromptEffect;

export type ShellState = Readonly<{
  id: ShellId;
  sessionId: ShellSessionId;
  currentDirectory: VirtualDirectoryPath;
  input: ShellLine;
  secretPrompt: SecretPrompt;
  lifecycle: CommandLifecycle;
  history: ReadonlyArray<ShellHistoryEntry>;
  scrollbackLimit: number;
  commandHistory: ReadonlyArray<CommandHistoryEntry>;
  commandHistoryLimit: number;
  historyNavigation: HistoryNavigation;
  completion: ShellCompletion;
  autosuggestion: ShellAutosuggestionState;
  nextCommandSequence: number;
  nextHistorySequence: number;
  nextCommandHistorySequence: number;
  pendingEffect: ShellEffect;
}>;

export type ShellStatus =
  | Readonly<{ kind: "ready" }>
  | Readonly<{ kind: "secret" }>
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
  currentDirectory: VirtualDirectoryPath;
  scrollbackLimit: number;
  commandHistoryLimit: number;
}>;

export type ShellAction =
  | Readonly<{
      kind: "input.insert";
      text: string;
    }>
  | Readonly<{
      kind: "input.replace";
      value: string;
      cursor: number;
    }>
  | Readonly<{
      kind: "input.move-cursor";
      cursor: number;
    }>
  | Readonly<{ kind: "input.move-left" }>
  | Readonly<{ kind: "input.move-right" }>
  | Readonly<{ kind: "input.move-start" }>
  | Readonly<{ kind: "input.move-end" }>
  | Readonly<{ kind: "input.move-previous-word" }>
  | Readonly<{ kind: "input.move-next-word" }>
  | Readonly<{ kind: "input.backspace" }>
  | Readonly<{ kind: "input.delete" }>
  | Readonly<{ kind: "input.delete-previous-word" }>
  | Readonly<{ kind: "history.older" }>
  | Readonly<{ kind: "history.newer" }>
  | Readonly<{ kind: "completion.dismiss" }>
  | Readonly<{
      kind: "completion.cycle";
      direction: CompletionCycleDirection;
    }>
  | Readonly<{ kind: "prompt.submit" }>
  | Readonly<{ kind: "prompt.cancel" }>
  | Readonly<{
      kind: "secret.begin";
      request: SecretPromptRequest;
    }>
  | Readonly<{
      kind: "completion.request";
      request: CompletionRequest;
    }>
  | Readonly<{
      kind: "completion.resolved";
      request: CompletionRequest;
      result: CompletionResult;
    }>
  | Readonly<{
      kind: "completion.failed";
      request: CompletionRequest;
    }>
  | Readonly<{ kind: "command.cancel" }>
  | Readonly<{
      kind: "command.settled";
      commandId: CommandId;
      outcome: CommandLineOutcome;
    }>
  | Readonly<{
      kind: "effect.consumed";
      commandId: CommandId;
    }>
  | Readonly<{
      kind: "secret-prompt.effect.consumed";
      requestId: SecretPromptId;
    }>;

const stableIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;

function assertStableIdentifier(value: string, label: string): void {
  if (!stableIdentifierPattern.test(value)) {
    throw new Error(`${label} values must be stable identifier strings.`);
  }
}

function assertPositiveLimit(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer.`);
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

function createCommandHistoryEntryId(
  sessionId: ShellSessionId,
  sequence: number,
): CommandHistoryEntryId {
  return `${sessionId}-command-history-${sequence}` as CommandHistoryEntryId;
}

function appendBounded<Value>(
  values: ReadonlyArray<Value>,
  limit: number,
  value: Value,
): ReadonlyArray<Value> {
  const nextValues = [...values, value];

  if (nextValues.length <= limit) {
    return nextValues;
  }

  return nextValues.slice(nextValues.length - limit);
}

function canEditPrompt(state: ShellState): boolean {
  return (
    state.lifecycle.kind === "idle" &&
    !isPendingSecretPromptEffect(state.pendingEffect)
  );
}

function isPendingSecretPromptEffect(effect: ShellEffect): effect is SecretPromptEffect {
  return effect.kind === "secret-submitted" || effect.kind === "secret-cancelled";
}

function createSecretPromptValue(value: string): SecretPromptValue {
  return value as SecretPromptValue;
}

function activePrompt(state: ShellState): ActiveShellPrompt {
  if (state.secretPrompt.kind === "active") {
    return { kind: "secret", prompt: state.secretPrompt.prompt };
  }

  return { kind: "command", line: state.input };
}

function promptLine(prompt: ActiveShellPrompt): ShellLine {
  return prompt.kind === "secret" ? prompt.prompt.line : prompt.line;
}

function updateActivePromptLine(state: ShellState, line: ShellLine): ShellState {
  const currentLine = promptLine(activePrompt(state));

  if (currentLine.text === line.text && currentLine.cursor === line.cursor) {
    return state;
  }

  if (state.secretPrompt.kind === "active") {
    return {
      ...state,
      secretPrompt: {
        kind: "active",
        prompt: { ...state.secretPrompt.prompt, line },
      },
      completion: { kind: "idle" },
    };
  }

  return {
    ...state,
    input: line,
    historyNavigation: { kind: "not-browsing" },
    completion: { kind: "idle" },
    autosuggestion: { kind: "available" },
  };
}

function createSecretPromptState(
  request: SecretPromptRequest,
): SecretPromptState {
  return {
    request,
    line: createEmptyShellLine(),
  };
}

function isMatchingCompletionRequest(
  state: ShellState,
  request: CompletionRequest,
): boolean {
  const prompt = activePrompt(state);

  return (
    prompt.kind === "command" &&
    prompt.line.text === request.source &&
    prompt.line.cursor === request.cursor
  );
}

function browseOlderHistory(state: ShellState): ShellState {
  if (state.secretPrompt.kind === "active" || state.commandHistory.length === 0) {
    return state;
  }

  const navigation = state.historyNavigation;
  const index =
    navigation.kind === "not-browsing"
      ? state.commandHistory.length - 1
      : Math.max(0, navigation.index - 1);
  const entry = state.commandHistory[index];

  if (entry === undefined) {
    return state;
  }

  return {
    ...state,
    input: createShellLine(entry.source),
    historyNavigation: {
      kind: "browsing",
      index,
      draft: navigation.kind === "not-browsing" ? state.input : navigation.draft,
    },
    completion: { kind: "idle" },
    autosuggestion: { kind: "available" },
  };
}

function browseNewerHistory(state: ShellState): ShellState {
  if (
    state.secretPrompt.kind === "active" ||
    state.historyNavigation.kind === "not-browsing"
  ) {
    return state;
  }

  if (state.historyNavigation.index >= state.commandHistory.length - 1) {
    return {
      ...state,
      input: state.historyNavigation.draft,
      historyNavigation: { kind: "not-browsing" },
      completion: { kind: "idle" },
      autosuggestion: { kind: "available" },
    };
  }

  const index = state.historyNavigation.index + 1;
  const entry = state.commandHistory[index];

  if (entry === undefined) {
    return state;
  }

  return {
    ...state,
    input: createShellLine(entry.source),
    historyNavigation: { ...state.historyNavigation, index },
    completion: { kind: "idle" },
    autosuggestion: { kind: "available" },
  };
}

function historyOutcome(
  outcome: CommandLineOutcome,
  events: ReadonlyArray<CommandLineEvent>,
): ShellHistoryOutcome {
  if (outcome.kind !== "failed") {
    return { ...outcome, events };
  }

  const failure: ShellHistoryFailure = outcome.failure.kind === "execution-error"
    ? {
        kind: "execution-error",
        commandName: outcome.failure.commandName,
      }
    : outcome.failure;

  return {
    kind: "failed",
    failure,
    events,
  };
}

function requestedSecretPrompt(
  events: ReadonlyArray<CommandLineEvent>,
): SecretPromptState | undefined {
  for (const event of events) {
    if (event.kind === "effect" && event.effect.kind === "request-secret-prompt") {
      return createSecretPromptState(event.effect.request);
    }
  }

  return undefined;
}

function lastClearIndex(events: ReadonlyArray<CommandLineEvent>): number {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];

    if (event?.kind === "effect" && event.effect.kind === "clear-scrollback") {
      return index;
    }
  }

  return -1;
}

function changedCurrentDirectory(
  events: ReadonlyArray<CommandLineEvent>,
): VirtualDirectoryPath | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];

    if (
      event?.kind === "effect" &&
      event.effect.kind === "set-current-directory"
    ) {
      return event.effect.directory;
    }
  }

  return undefined;
}

function selectedCompletionCandidate(
  completion: ShellCompletion,
): CompletionCandidate | undefined {
  if (
    completion.kind !== "suggestions" ||
    completion.selection.kind !== "selected"
  ) {
    return undefined;
  }

  return completion.candidates[completion.selection.index];
}

function acceptSelectedCompletion(state: ShellState): ShellState | undefined {
  if (state.secretPrompt.kind === "active" || state.completion.kind !== "suggestions") {
    return undefined;
  }

  const candidate = selectedCompletionCandidate(state.completion);

  if (candidate === undefined) {
    return undefined;
  }

  const edit = createCompletionEdit(state.completion.request, candidate);

  return {
    ...state,
    input: replaceShellLine(edit.value, edit.cursor),
    historyNavigation: { kind: "not-browsing" },
    completion: { kind: "idle" },
    autosuggestion: { kind: "available" },
  };
}

function acceptPromptSuggestionAtLineEnd(state: ShellState): ShellState | undefined {
  if (state.secretPrompt.kind === "active" || state.input.cursor !== state.input.text.length) {
    return undefined;
  }

  const selectedCompletion = acceptSelectedCompletion(state);

  if (selectedCompletion !== undefined) {
    return selectedCompletion;
  }

  const suggestion = getShellAutosuggestion(state);

  if (suggestion.kind === "none") {
    return undefined;
  }

  return {
    ...state,
    input: createShellLine(suggestion.value),
    historyNavigation: { kind: "not-browsing" },
    completion: { kind: "idle" },
    autosuggestion: { kind: "available" },
  };
}

function cycleCompletion(
  state: ShellState,
  direction: CompletionCycleDirection,
): ShellState {
  if (state.completion.kind !== "suggestions") {
    return state;
  }

  const length = state.completion.candidates.length;

  if (length === 0) {
    return { ...state, completion: { kind: "idle" } };
  }

  const currentIndex = state.completion.selection.kind === "selected"
    ? state.completion.selection.index
    : undefined;
  let index: number;

  if (currentIndex === undefined) {
    index = direction === "next" ? 0 : length - 1;
  } else if (direction === "next") {
    index = (currentIndex + 1) % length;
  } else {
    index = (currentIndex - 1 + length) % length;
  }

  return {
    ...state,
    completion: {
      ...state.completion,
      selection: { kind: "selected", index },
    },
  };
}

export function createShellId(value: string): ShellId {
  assertStableIdentifier(value, "Shell IDs");
  return value as ShellId;
}

export function createShellSessionId(value: string): ShellSessionId {
  assertStableIdentifier(value, "Shell session IDs");
  return value as ShellSessionId;
}

export function createSecretPromptId(value: string): SecretPromptId {
  assertStableIdentifier(value, "Secret prompt IDs");
  return value as SecretPromptId;
}

export function createShellDiagnosticId(value: string): ShellDiagnosticId {
  assertStableIdentifier(value, "Shell diagnostic IDs");
  return value as ShellDiagnosticId;
}

export function createShellOutputId(value: string): ShellOutputId {
  assertStableIdentifier(value, "Shell output IDs");
  return value as ShellOutputId;
}

export function createSecretPromptRequest(
  id: SecretPromptId,
  label: string,
): SecretPromptRequest {
  if (label.length === 0 || label.trim() !== label) {
    throw new Error("Secret prompt labels must be non-empty trimmed strings.");
  }

  return { id, label };
}

export function createShellState({
  id,
  sessionId,
  currentDirectory,
  scrollbackLimit,
  commandHistoryLimit,
}: CreateShellStateOptions): ShellState {
  assertPositiveLimit(scrollbackLimit, "Shell scrollback limits");
  assertPositiveLimit(commandHistoryLimit, "Shell command history limits");

  return {
    id,
    sessionId,
    currentDirectory,
    input: createEmptyShellLine(),
    secretPrompt: { kind: "none" },
    lifecycle: { kind: "idle" },
    history: [],
    scrollbackLimit,
    commandHistory: [],
    commandHistoryLimit,
    historyNavigation: { kind: "not-browsing" },
    completion: { kind: "idle" },
    autosuggestion: { kind: "available" },
    nextCommandSequence: 1,
    nextHistorySequence: 1,
    nextCommandHistorySequence: 1,
    pendingEffect: { kind: "none" },
  };
}

export function getActiveShellPrompt(state: ShellState): ActiveShellPrompt {
  return activePrompt(state);
}

export function getShellAutosuggestion(state: ShellState): ShellAutosuggestion {
  if (
    state.secretPrompt.kind === "active" ||
    state.lifecycle.kind !== "idle" ||
    state.completion.kind !== "idle" ||
    state.autosuggestion.kind === "dismissed" ||
    state.input.cursor !== state.input.text.length ||
    state.input.text.length === 0
  ) {
    return { kind: "none" };
  }

  for (let index = state.commandHistory.length - 1; index >= 0; index -= 1) {
    const entry = state.commandHistory[index];

    if (
      entry !== undefined &&
      entry.source !== state.input.text &&
      entry.source.startsWith(state.input.text)
    ) {
      return {
        kind: "suggestion",
        value: entry.source,
        suffix: entry.source.slice(state.input.text.length),
      };
    }
  }

  return { kind: "none" };
}

export function getShellStatus(state: ShellState): ShellStatus {
  if (state.secretPrompt.kind === "active") {
    return { kind: "secret" };
  }

  switch (state.lifecycle.kind) {
    case "idle":
      return { kind: "ready" };
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

      return updateActivePromptLine(
        state,
        insertShellLineText(promptLine(activePrompt(state)), action.text),
      );
    case "input.replace":
      if (!canEditPrompt(state)) {
        return state;
      }

      return updateActivePromptLine(
        state,
        replaceShellLine(action.value, action.cursor),
      );
    case "input.move-cursor":
      if (!canEditPrompt(state)) {
        return state;
      }

      return updateActivePromptLine(
        state,
        moveShellLineCursor(promptLine(activePrompt(state)), action.cursor),
      );
    case "input.move-left":
      if (!canEditPrompt(state)) {
        return state;
      }

      return updateActivePromptLine(
        state,
        moveShellLineCursorLeft(promptLine(activePrompt(state))),
      );
    case "input.move-right": {
      if (!canEditPrompt(state)) {
        return state;
      }

      const accepted = acceptPromptSuggestionAtLineEnd(state);

      if (accepted !== undefined) {
        return accepted;
      }

      return updateActivePromptLine(
        state,
        moveShellLineCursorRight(promptLine(activePrompt(state))),
      );
    }
    case "input.move-start":
      if (!canEditPrompt(state)) {
        return state;
      }

      return updateActivePromptLine(
        state,
        moveShellLineCursorStart(promptLine(activePrompt(state))),
      );
    case "input.move-end": {
      if (!canEditPrompt(state)) {
        return state;
      }

      const accepted = acceptPromptSuggestionAtLineEnd(state);

      if (accepted !== undefined) {
        return accepted;
      }

      return updateActivePromptLine(
        state,
        moveShellLineCursorEnd(promptLine(activePrompt(state))),
      );
    }
    case "input.move-previous-word":
      if (!canEditPrompt(state)) {
        return state;
      }

      return updateActivePromptLine(
        state,
        moveShellLineCursorPreviousWord(promptLine(activePrompt(state))),
      );
    case "input.move-next-word":
      if (!canEditPrompt(state)) {
        return state;
      }

      return updateActivePromptLine(
        state,
        moveShellLineCursorNextWord(promptLine(activePrompt(state))),
      );
    case "input.backspace":
      if (!canEditPrompt(state)) {
        return state;
      }

      return updateActivePromptLine(
        state,
        backspaceShellLine(promptLine(activePrompt(state))),
      );
    case "input.delete":
      if (!canEditPrompt(state)) {
        return state;
      }

      return updateActivePromptLine(
        state,
        deleteShellLine(promptLine(activePrompt(state))),
      );
    case "input.delete-previous-word":
      if (!canEditPrompt(state)) {
        return state;
      }

      return updateActivePromptLine(
        state,
        deleteShellLinePreviousWord(promptLine(activePrompt(state))),
      );
    case "history.older":
      return canEditPrompt(state) ? browseOlderHistory(state) : state;
    case "history.newer":
      return canEditPrompt(state) ? browseNewerHistory(state) : state;
    case "completion.dismiss":
      if (
        state.completion.kind === "idle" &&
        state.autosuggestion.kind === "dismissed"
      ) {
        return state;
      }

      return {
        ...state,
        completion: { kind: "idle" },
        autosuggestion: { kind: "dismissed" },
      };
    case "completion.cycle":
      return canEditPrompt(state) ? cycleCompletion(state, action.direction) : state;
    case "prompt.submit": {
      const acceptedCompletion = acceptSelectedCompletion(state);

      if (acceptedCompletion !== undefined) {
        return acceptedCompletion;
      }

      if (state.secretPrompt.kind === "active") {
        const { request, line } = state.secretPrompt.prompt;

        return {
          ...state,
          secretPrompt: { kind: "none" },
          completion: { kind: "idle" },
          pendingEffect: {
            kind: "secret-submitted",
            requestId: request.id,
            value: createSecretPromptValue(line.text),
          },
        };
      }

      if (!canEditPrompt(state) || state.input.text.trim().length === 0) {
        return state;
      }

      const commandHistoryEntry: CommandHistoryEntry = {
        id: createCommandHistoryEntryId(
          state.sessionId,
          state.nextCommandHistorySequence,
        ),
        source: state.input.text,
        currentDirectory: state.currentDirectory,
      };
      const commandHistory = appendBounded(
        state.commandHistory,
        state.commandHistoryLimit,
        commandHistoryEntry,
      );
      const command: ShellCommandRequest = {
        id: createCommandId(state.sessionId, state.nextCommandSequence),
        shellId: state.id,
        sessionId: state.sessionId,
        source: commandHistoryEntry.source,
        currentDirectory: state.currentDirectory,
        commandHistory,
      };

      return {
        ...state,
        input: createEmptyShellLine(),
        lifecycle: { kind: "running", command },
        commandHistory,
        historyNavigation: { kind: "not-browsing" },
        completion: { kind: "idle" },
        autosuggestion: { kind: "available" },
        nextCommandSequence: state.nextCommandSequence + 1,
        nextCommandHistorySequence: state.nextCommandHistorySequence + 1,
        pendingEffect: { kind: "execute-command", command },
      };
    }
    case "prompt.cancel":
      if (isPendingSecretPromptEffect(state.pendingEffect)) {
        return state;
      }

      if (state.secretPrompt.kind === "active") {
        const { request } = state.secretPrompt.prompt;

        return {
          ...state,
          secretPrompt: { kind: "none" },
          completion: { kind: "idle" },
          pendingEffect: {
            kind: "secret-cancelled",
            requestId: request.id,
          },
        };
      }

      if (state.lifecycle.kind === "running") {
        return {
          ...state,
          lifecycle: { kind: "cancelling", command: state.lifecycle.command },
          pendingEffect: {
            kind: "cancel-command",
            commandId: state.lifecycle.command.id,
          },
        };
      }

      if (state.lifecycle.kind === "cancelling") {
        return state;
      }

      return {
        ...state,
        input: createEmptyShellLine(),
        historyNavigation: { kind: "not-browsing" },
        completion: { kind: "idle" },
        autosuggestion: { kind: "available" },
      };
    case "secret.begin":
      if (!canEditPrompt(state) || state.secretPrompt.kind === "active") {
        return state;
      }

      return {
        ...state,
        secretPrompt: {
          kind: "active",
          prompt: createSecretPromptState(action.request),
        },
        completion: { kind: "idle" },
        autosuggestion: { kind: "available" },
      };
    case "completion.request":
      if (!canEditPrompt(state) || !isMatchingCompletionRequest(state, action.request)) {
        return state;
      }

      return {
        ...state,
        completion: { kind: "pending", request: action.request },
      };
    case "completion.resolved":
      if (
        state.completion.kind !== "pending" ||
        state.completion.request !== action.request ||
        !isMatchingCompletionRequest(state, action.request)
      ) {
        return state;
      }

      if (action.result.kind === "single") {
        const edit = createCompletionEdit(action.request, action.result.candidate);

        return updateActivePromptLine(
          state,
          replaceShellLine(edit.value, edit.cursor),
        );
      }

      if (action.result.kind === "multiple") {
        const commonPrefix = longestCommonCompletionPrefix(
          action.result.candidates,
        );
        const edit = createCompletionPrefixEdit(action.request, commonPrefix);

        return {
          ...state,
          input: replaceShellLine(edit.value, edit.cursor),
          historyNavigation: { kind: "not-browsing" },
          autosuggestion: { kind: "available" },
          completion: {
            kind: "suggestions",
            request: action.request,
            candidates: action.result.candidates,
            selection: { kind: "none" },
          },
        };
      }

      return { ...state, completion: { kind: "idle" } };
    case "completion.failed":
      if (
        state.completion.kind !== "pending" ||
        state.completion.request !== action.request
      ) {
        return state;
      }

      return { ...state, completion: { kind: "idle" } };
    case "command.cancel":
      return reduceShellState(state, { kind: "prompt.cancel" });
    case "command.settled": {
      if (
        state.lifecycle.kind === "idle" ||
        state.lifecycle.command.id !== action.commandId
      ) {
        return state;
      }

      const clearIndex = lastClearIndex(action.outcome.events);
      const visibleEvents = clearIndex === -1
        ? action.outcome.events
        : action.outcome.events.slice(clearIndex + 1);
      const secretPrompt = requestedSecretPrompt(action.outcome.events);
      const currentDirectory = changedCurrentDirectory(action.outcome.events);
      const storedOutcome = historyOutcome(action.outcome, visibleEvents);
      const priorHistory = clearIndex === -1 ? state.history : [];
      const keepsCommandLine = clearIndex === -1 || visibleEvents.some(
        (event) => event.kind === "output",
      );
      const history = keepsCommandLine
        ? appendBounded(priorHistory, state.scrollbackLimit, {
            id: createHistoryEntryId(
              state.sessionId,
              state.nextHistorySequence,
            ),
            command: state.lifecycle.command,
            outcome: storedOutcome,
          })
        : priorHistory;

      return {
        ...state,
        currentDirectory: currentDirectory ?? state.currentDirectory,
        lifecycle: { kind: "idle" },
        history,
        secretPrompt:
          secretPrompt === undefined
            ? state.secretPrompt
            : { kind: "active", prompt: secretPrompt },
        nextHistorySequence: state.nextHistorySequence + 1,
        pendingEffect: { kind: "none" },
      };
    }
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
        case "secret-submitted":
        case "secret-cancelled":
          return state;
      }
    case "secret-prompt.effect.consumed":
      if (
        !isPendingSecretPromptEffect(state.pendingEffect) ||
        state.pendingEffect.requestId !== action.requestId
      ) {
        return state;
      }

      return { ...state, pendingEffect: { kind: "none" } };
  }
}
