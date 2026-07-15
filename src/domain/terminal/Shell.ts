import {
  backspacePromptEditor,
  createEmptyPromptEditor,
  createPromptEditorForHistory,
  deletePromptEditorAtCursor,
  insertPromptEditorText,
  movePromptEditorCursor,
  replacePromptEditorValue,
  applyNormalPromptKey,
  type NormalPromptKey,
  type PromptEditor,
} from "./PromptEditor.ts";
import { PromptMode, type PromptMode as PromptModeValue } from "./PromptBuffer.ts";
import {
  createCompletionEdit,
  type CompletionCandidate,
  type CompletionRequest,
  type CompletionResult,
} from "./Completion.ts";
import type { ArgumentLexerError, SourceOffset } from "./ArgumentLexer.ts";

declare const shellIdBrand: unique symbol;
declare const shellSessionIdBrand: unique symbol;
declare const commandIdBrand: unique symbol;
declare const shellHistoryEntryIdBrand: unique symbol;
declare const commandHistoryEntryIdBrand: unique symbol;
declare const secretPromptIdBrand: unique symbol;

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

export type SecretPromptRequest = Readonly<{
  id: SecretPromptId;
  label: string;
}>;

export type CommandEffect =
  | Readonly<{ kind: "clear-scrollback" }>
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

export type CommandHistoryEntry = Readonly<{
  id: CommandHistoryEntryId;
  source: string;
}>;

export type SecretPromptState = Readonly<{
  request: SecretPromptRequest;
  editor: PromptEditor;
}>;

export type ActiveShellPrompt =
  | Readonly<{
      kind: "command";
      editor: PromptEditor;
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
      draft: PromptEditor;
    }>;

export type ShellCompletion =
  | Readonly<{ kind: "idle" }>
  | Readonly<{
      kind: "pending";
      request: CompletionRequest;
    }>
  | Readonly<{
      kind: "suggestions";
      candidates: ReadonlyArray<CompletionCandidate>;
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
  input: PromptEditor;
  secretPrompt: SecretPrompt;
  lifecycle: CommandLifecycle;
  history: ReadonlyArray<ShellHistoryEntry>;
  scrollbackLimit: number;
  commandHistory: ReadonlyArray<CommandHistoryEntry>;
  commandHistoryLimit: number;
  historyNavigation: HistoryNavigation;
  completion: ShellCompletion;
  nextCommandSequence: number;
  nextHistorySequence: number;
  nextCommandHistorySequence: number;
  pendingEffect: ShellEffect;
}>;

export type ShellStatus =
  | Readonly<{
      kind: "ready";
      mode: PromptModeValue;
    }>
  | Readonly<{
      kind: "secret";
      mode: PromptModeValue;
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
  | Readonly<{ kind: "input.backspace" }>
  | Readonly<{ kind: "input.delete" }>
  | Readonly<{
      kind: "prompt.normal-key";
      key: NormalPromptKey;
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
  return state.lifecycle.kind === "idle";
}

function activePrompt(state: ShellState): ActiveShellPrompt {
  if (state.secretPrompt.kind === "active") {
    return { kind: "secret", prompt: state.secretPrompt.prompt };
  }

  return { kind: "command", editor: state.input };
}

function updateActiveEditor(
  state: ShellState,
  editor: PromptEditor,
): ShellState {
  if (state.secretPrompt.kind === "active") {
    return {
      ...state,
      secretPrompt: {
        kind: "active",
        prompt: { ...state.secretPrompt.prompt, editor },
      },
      completion: { kind: "idle" },
    };
  }

  return {
    ...state,
    input: editor,
    historyNavigation: { kind: "not-browsing" },
    completion: { kind: "idle" },
  };
}

function createSecretPromptState(
  request: SecretPromptRequest,
): SecretPromptState {
  return {
    request,
    editor: createEmptyPromptEditor(),
  };
}

function isMatchingCompletionRequest(
  state: ShellState,
  request: CompletionRequest,
): boolean {
  const prompt = activePrompt(state);

  return (
    prompt.kind === "command" &&
    prompt.editor.buffer.mode.kind === "insert" &&
    prompt.editor.buffer.value === request.source &&
    prompt.editor.buffer.cursor === request.cursor
  );
}

function browseOlderHistory(state: ShellState): ShellState {
  if (
    state.secretPrompt.kind === "active" ||
    state.commandHistory.length === 0 ||
    state.input.buffer.mode.kind !== "normal"
  ) {
    return state;
  }

  const navigation = state.historyNavigation;
  const index =
    navigation.kind === "not-browsing"
      ? state.commandHistory.length - 1
      : Math.max(0, navigation.index - 1);
  const entry = state.commandHistory[index];

  if (!entry) {
    return state;
  }

  return {
    ...state,
    input: createPromptEditorForHistory(
      entry.source,
      PromptMode.Normal,
      state.input.register,
    ),
    historyNavigation: {
      kind: "browsing",
      index,
      draft: navigation.kind === "not-browsing" ? state.input : navigation.draft,
    },
    completion: { kind: "idle" },
  };
}

function browseNewerHistory(state: ShellState): ShellState {
  if (
    state.secretPrompt.kind === "active" ||
    state.historyNavigation.kind === "not-browsing" ||
    state.input.buffer.mode.kind !== "normal"
  ) {
    return state;
  }

  if (state.historyNavigation.index >= state.commandHistory.length - 1) {
    return {
      ...state,
      input: state.historyNavigation.draft,
      historyNavigation: { kind: "not-browsing" },
      completion: { kind: "idle" },
    };
  }

  const index = state.historyNavigation.index + 1;
  const entry = state.commandHistory[index];

  if (!entry) {
    return state;
  }

  return {
    ...state,
    input: createPromptEditorForHistory(
      entry.source,
      PromptMode.Normal,
      state.input.register,
    ),
    historyNavigation: { ...state.historyNavigation, index },
    completion: { kind: "idle" },
  };
}

function commandEffects(outcome: CommandOutcome): ReadonlyArray<CommandEffect> {
  return outcome.kind === "succeeded" ? outcome.effects : [];
}

function requestedSecretPrompt(
  effects: ReadonlyArray<CommandEffect>,
): SecretPromptState | undefined {
  const effect = effects.find(
    (candidate) => candidate.kind === "request-secret-prompt",
  );

  if (!effect || effect.kind !== "request-secret-prompt") {
    return undefined;
  }

  return createSecretPromptState(effect.request);
}

function clearsScrollback(effects: ReadonlyArray<CommandEffect>): boolean {
  return effects.some((effect) => effect.kind === "clear-scrollback");
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
  scrollbackLimit,
  commandHistoryLimit,
}: CreateShellStateOptions): ShellState {
  assertPositiveLimit(scrollbackLimit, "Shell scrollback limits");
  assertPositiveLimit(commandHistoryLimit, "Shell command history limits");

  return {
    id,
    sessionId,
    input: createEmptyPromptEditor(),
    secretPrompt: { kind: "none" },
    lifecycle: { kind: "idle" },
    history: [],
    scrollbackLimit,
    commandHistory: [],
    commandHistoryLimit,
    historyNavigation: { kind: "not-browsing" },
    completion: { kind: "idle" },
    nextCommandSequence: 1,
    nextHistorySequence: 1,
    nextCommandHistorySequence: 1,
    pendingEffect: { kind: "none" },
  };
}

export function getActiveShellPrompt(state: ShellState): ActiveShellPrompt {
  return activePrompt(state);
}

export function getShellStatus(state: ShellState): ShellStatus {
  if (state.secretPrompt.kind === "active") {
    return {
      kind: "secret",
      mode: state.secretPrompt.prompt.editor.buffer.mode,
    };
  }

  switch (state.lifecycle.kind) {
    case "idle":
      return { kind: "ready", mode: state.input.buffer.mode };
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

      {
        const prompt = activePrompt(state);
        const editor =
          prompt.kind === "secret" ? prompt.prompt.editor : prompt.editor;

        return updateActiveEditor(state, insertPromptEditorText(editor, action.text));
      }
    case "input.replace": {
      if (!canEditPrompt(state)) {
        return state;
      }

      const prompt = activePrompt(state);
      const editor = prompt.kind === "secret" ? prompt.prompt.editor : prompt.editor;

      if (editor.buffer.mode.kind !== "insert") {
        return state;
      }

      return updateActiveEditor(
        state,
        replacePromptEditorValue(editor, action.value, action.cursor),
      );
    }
    case "input.move-cursor": {
      if (!canEditPrompt(state)) {
        return state;
      }

      const prompt = activePrompt(state);
      const editor = prompt.kind === "secret" ? prompt.prompt.editor : prompt.editor;

      if (editor.buffer.mode.kind !== "insert") {
        return state;
      }

      return updateActiveEditor(state, movePromptEditorCursor(editor, action.cursor));
    }
    case "input.backspace": {
      if (!canEditPrompt(state)) {
        return state;
      }

      const prompt = activePrompt(state);
      const editor = prompt.kind === "secret" ? prompt.prompt.editor : prompt.editor;

      if (editor.buffer.mode.kind !== "insert") {
        return state;
      }

      return updateActiveEditor(state, backspacePromptEditor(editor));
    }
    case "input.delete": {
      if (!canEditPrompt(state)) {
        return state;
      }

      const prompt = activePrompt(state);
      const editor = prompt.kind === "secret" ? prompt.prompt.editor : prompt.editor;

      if (editor.buffer.mode.kind !== "insert") {
        return state;
      }

      return updateActiveEditor(state, deletePromptEditorAtCursor(editor));
    }
    case "prompt.normal-key": {
      if (!canEditPrompt(state)) {
        return state;
      }

      if (action.key.kind === "history-older") {
        return browseOlderHistory(state);
      }

      if (action.key.kind === "history-newer") {
        return browseNewerHistory(state);
      }

      const prompt = activePrompt(state);
      const editor = prompt.kind === "secret" ? prompt.prompt.editor : prompt.editor;

      if (
        editor.buffer.mode.kind !== "normal" &&
        action.key.kind !== "escape"
      ) {
        return state;
      }

      return updateActiveEditor(state, applyNormalPromptKey(editor, action.key));
    }
    case "prompt.submit": {
      if (state.secretPrompt.kind === "active") {
        return {
          ...state,
          secretPrompt: { kind: "none" },
          completion: { kind: "idle" },
        };
      }

      if (!canEditPrompt(state) || state.input.buffer.value.trim().length === 0) {
        return state;
      }

      const command: ShellCommandRequest = {
        id: createCommandId(state.sessionId, state.nextCommandSequence),
        shellId: state.id,
        sessionId: state.sessionId,
        source: state.input.buffer.value,
      };
      const commandHistoryEntry: CommandHistoryEntry = {
        id: createCommandHistoryEntryId(
          state.sessionId,
          state.nextCommandHistorySequence,
        ),
        source: command.source,
      };

      return {
        ...state,
        input: createEmptyPromptEditor(),
        lifecycle: { kind: "running", command },
        commandHistory: appendBounded(
          state.commandHistory,
          state.commandHistoryLimit,
          commandHistoryEntry,
        ),
        historyNavigation: { kind: "not-browsing" },
        completion: { kind: "idle" },
        nextCommandSequence: state.nextCommandSequence + 1,
        nextCommandHistorySequence: state.nextCommandHistorySequence + 1,
        pendingEffect: { kind: "execute-command", command },
      };
    }
    case "prompt.cancel":
      if (state.secretPrompt.kind === "active") {
        return {
          ...state,
          secretPrompt: { kind: "none" },
          completion: { kind: "idle" },
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
        input: createEmptyPromptEditor(),
        historyNavigation: { kind: "not-browsing" },
        completion: { kind: "idle" },
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

        return updateActiveEditor(
          state,
          replacePromptEditorValue(state.input, edit.value, edit.cursor),
        );
      }

      if (action.result.kind === "multiple") {
        return {
          ...state,
          completion: {
            kind: "suggestions",
            candidates: action.result.candidates,
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

      const effects = commandEffects(action.outcome);
      const existingHistory = clearsScrollback(effects) ? [] : state.history;
      const secretPrompt = requestedSecretPrompt(effects);

      return {
        ...state,
        lifecycle: { kind: "idle" },
        history: appendBounded(existingHistory, state.scrollbackLimit, {
          id: createHistoryEntryId(
            state.sessionId,
            state.nextHistorySequence,
          ),
          command: state.lifecycle.command,
          outcome: action.outcome,
        }),
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
      }
  }
}
