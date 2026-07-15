import {
  VimMode,
  backspaceVimInsertText,
  deleteVimInsertText,
  moveVimInsertCursorToTextOffset,
  vimBufferCursorOffset,
  vimBufferText,
  type VimBuffer,
} from "../vim/VimBuffer.ts";
import {
  applyVimPromptKey,
  createEmptyVimPrompt,
  createVimPrompt,
  insertVimPromptText,
  replaceVimPromptText,
  vimPromptMode,
  type VimPromptKey,
  type VimPromptMode,
} from "./VimPrompt.ts";
import {
  createCompletionEdit,
  type CompletionCandidate,
  type CompletionRequest,
  type CompletionResult,
} from "./Completion.ts";
import type { ArgumentLexerError, SourceOffset } from "./ArgumentLexer.ts";
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
declare const shellOutputPartIdBrand: unique symbol;

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

export type ShellOutputPartId = string & {
  readonly [shellOutputPartIdBrand]: "ShellOutputPartId";
};

export type ShellDiagnostic =
  | Readonly<{
      kind: "parse";
      id: ShellDiagnosticId;
      code:
        | "parse.unterminated-single-quote"
        | "parse.unterminated-double-quote"
        | "parse.trailing-escape";
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

export type ShellTableColumn = Readonly<{
  id: ShellOutputPartId;
  label: string;
}>;

export type ShellTableCell = Readonly<{
  id: ShellOutputPartId;
  columnId: ShellOutputPartId;
  value: string;
}>;

export type ShellTableRow = Readonly<{
  id: ShellOutputPartId;
  cells: ReadonlyArray<ShellTableCell>;
}>;

export type ShellRichField = Readonly<{
  id: ShellOutputPartId;
  label: string;
  value: string;
}>;

export type ShellOutput =
  | Readonly<{
      kind: "text";
      id: ShellOutputId;
      text: string;
    }>
  | Readonly<{
      kind: "table";
      id: ShellOutputId;
      columns: ReadonlyArray<ShellTableColumn>;
      rows: ReadonlyArray<ShellTableRow>;
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
    }>
  | Readonly<{
      kind: "rich";
      id: ShellOutputId;
      title: string;
      fields: ReadonlyArray<ShellRichField>;
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

type ShellHistoryFailure =
  | Exclude<CommandFailure, { kind: "execution-error" }>
  | Readonly<{
      kind: "execution-error";
      commandName: string;
    }>;

export type ShellHistoryOutcome =
  | Exclude<CommandOutcome, { kind: "failed" }>
  | Readonly<{
      kind: "failed";
      failure: ShellHistoryFailure;
      diagnostics: ReadonlyArray<ShellDiagnostic>;
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
}>;

export type SecretPromptState = Readonly<{
  request: SecretPromptRequest;
  buffer: VimBuffer;
}>;

export type ActiveShellPrompt =
  | Readonly<{
      kind: "command";
      buffer: VimBuffer;
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
      draft: VimBuffer;
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
    }>
  | SecretPromptEffect;

export type ShellState = Readonly<{
  id: ShellId;
  sessionId: ShellSessionId;
  currentDirectory: VirtualDirectoryPath;
  input: VimBuffer;
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
      mode: VimPromptMode;
    }>
  | Readonly<{
      kind: "secret";
      mode: VimPromptMode;
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
  | Readonly<{ kind: "input.backspace" }>
  | Readonly<{ kind: "input.delete" }>
  | Readonly<{
      kind: "prompt.normal-key";
      key: VimPromptKey;
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

  return { kind: "command", buffer: state.input };
}

function updateActivePromptBuffer(
  state: ShellState,
  buffer: VimBuffer,
): ShellState {
  if (state.secretPrompt.kind === "active") {
    return {
      ...state,
      secretPrompt: {
        kind: "active",
        prompt: { ...state.secretPrompt.prompt, buffer },
      },
      completion: { kind: "idle" },
    };
  }

  return {
    ...state,
    input: buffer,
    historyNavigation: { kind: "not-browsing" },
    completion: { kind: "idle" },
  };
}

function createSecretPromptState(
  request: SecretPromptRequest,
): SecretPromptState {
  return {
    request,
    buffer: createEmptyVimPrompt(),
  };
}

function isMatchingCompletionRequest(
  state: ShellState,
  request: CompletionRequest,
): boolean {
  const prompt = activePrompt(state);

  return (
    prompt.kind === "command" &&
    vimPromptMode(prompt.buffer).kind === "insert" &&
    vimBufferText(prompt.buffer) === request.source &&
    vimBufferCursorOffset(prompt.buffer) === request.cursor
  );
}

function browseOlderHistory(state: ShellState): ShellState {
  if (
    state.secretPrompt.kind === "active" ||
    state.commandHistory.length === 0 ||
    vimPromptMode(state.input).kind !== "normal"
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
    input: createVimPrompt({
      text: entry.source,
      mode: VimMode.Normal,
      register: state.input.register,
    }),
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
    vimPromptMode(state.input).kind !== "normal"
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
    input: createVimPrompt({
      text: entry.source,
      mode: VimMode.Normal,
      register: state.input.register,
    }),
    historyNavigation: { ...state.historyNavigation, index },
    completion: { kind: "idle" },
  };
}

function commandEffects(outcome: CommandOutcome): ReadonlyArray<CommandEffect> {
  return outcome.kind === "succeeded" ? outcome.effects : [];
}

function historyOutcome(outcome: CommandOutcome): ShellHistoryOutcome {
  if (outcome.kind !== "failed") {
    return outcome;
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
    diagnostics: outcome.diagnostics,
  };
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

function changedCurrentDirectory(
  effects: ReadonlyArray<CommandEffect>,
): VirtualDirectoryPath | undefined {
  const effect = effects.find(
    (candidate) => candidate.kind === "set-current-directory",
  );

  return effect?.kind === "set-current-directory" ? effect.directory : undefined;
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

export function createShellOutputPartId(value: string): ShellOutputPartId {
  assertStableIdentifier(value, "Shell output part IDs");
  return value as ShellOutputPartId;
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
    input: createEmptyVimPrompt(),
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
      mode: vimPromptMode(state.secretPrompt.prompt.buffer),
    };
  }

  switch (state.lifecycle.kind) {
    case "idle":
      return { kind: "ready", mode: vimPromptMode(state.input) };
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
        const buffer = prompt.kind === "secret" ? prompt.prompt.buffer : prompt.buffer;

        return updateActivePromptBuffer(
          state,
          insertVimPromptText(buffer, action.text),
        );
      }
    case "input.replace": {
      if (!canEditPrompt(state)) {
        return state;
      }

      const prompt = activePrompt(state);
      const buffer = prompt.kind === "secret" ? prompt.prompt.buffer : prompt.buffer;

      if (vimPromptMode(buffer).kind !== "insert") {
        return state;
      }

      return updateActivePromptBuffer(
        state,
        replaceVimPromptText(buffer, action.value, action.cursor),
      );
    }
    case "input.move-cursor": {
      if (!canEditPrompt(state)) {
        return state;
      }

      const prompt = activePrompt(state);
      const buffer = prompt.kind === "secret" ? prompt.prompt.buffer : prompt.buffer;

      if (vimPromptMode(buffer).kind !== "insert") {
        return state;
      }

      return updateActivePromptBuffer(
        state,
        moveVimInsertCursorToTextOffset(buffer, action.cursor),
      );
    }
    case "input.backspace": {
      if (!canEditPrompt(state)) {
        return state;
      }

      const prompt = activePrompt(state);
      const buffer = prompt.kind === "secret" ? prompt.prompt.buffer : prompt.buffer;

      if (vimPromptMode(buffer).kind !== "insert") {
        return state;
      }

      return updateActivePromptBuffer(state, backspaceVimInsertText(buffer));
    }
    case "input.delete": {
      if (!canEditPrompt(state)) {
        return state;
      }

      const prompt = activePrompt(state);
      const buffer = prompt.kind === "secret" ? prompt.prompt.buffer : prompt.buffer;

      if (vimPromptMode(buffer).kind !== "insert") {
        return state;
      }

      return updateActivePromptBuffer(state, deleteVimInsertText(buffer));
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
      const buffer = prompt.kind === "secret" ? prompt.prompt.buffer : prompt.buffer;

      if (
        vimPromptMode(buffer).kind !== "normal" &&
        action.key.kind !== "escape"
      ) {
        return state;
      }

      return updateActivePromptBuffer(state, applyVimPromptKey(buffer, action.key));
    }
    case "prompt.submit": {
      if (state.secretPrompt.kind === "active") {
        const { request, buffer } = state.secretPrompt.prompt;

        return {
          ...state,
          secretPrompt: { kind: "none" },
          completion: { kind: "idle" },
          pendingEffect: {
            kind: "secret-submitted",
            requestId: request.id,
            value: createSecretPromptValue(vimBufferText(buffer)),
          },
        };
      }

      if (!canEditPrompt(state) || vimBufferText(state.input).trim().length === 0) {
        return state;
      }

      const commandHistoryEntry: CommandHistoryEntry = {
        id: createCommandHistoryEntryId(
          state.sessionId,
          state.nextCommandHistorySequence,
        ),
        source: vimBufferText(state.input),
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
        input: createEmptyVimPrompt(),
        lifecycle: { kind: "running", command },
        commandHistory,
        historyNavigation: { kind: "not-browsing" },
        completion: { kind: "idle" },
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
        input: createEmptyVimPrompt(),
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

        return updateActivePromptBuffer(
          state,
          replaceVimPromptText(state.input, edit.value, edit.cursor),
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
      const currentDirectory = changedCurrentDirectory(effects);
      const storedOutcome = historyOutcome(action.outcome);

      return {
        ...state,
        currentDirectory: currentDirectory ?? state.currentDirectory,
        lifecycle: { kind: "idle" },
        history: appendBounded(existingHistory, state.scrollbackLimit, {
          id: createHistoryEntryId(
            state.sessionId,
            state.nextHistorySequence,
          ),
          command: state.lifecycle.command,
          outcome: storedOutcome,
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
