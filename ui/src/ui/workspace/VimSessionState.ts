import type {
  VimBuffer,
  VimCommandEffect,
  VimStatus,
} from "../../domain/vim/VimBuffer.ts";

export type VimHistoryKind = "command" | "search";

export type VimMessage = Readonly<{
  text: string;
}>;

export type VimSessionState = Readonly<{
  commandHistory: ReadonlyArray<string>;
  searchHistory: ReadonlyArray<string>;
  messages: ReadonlyArray<VimMessage>;
}>;

export type VimSessionBinding = Readonly<{
  state: VimSessionState;
  onStateChange: (state: VimSessionState) => void;
}>;

export type VimHistoryNavigation =
  | Readonly<{ kind: "idle" }>
  | Readonly<{
      kind: "active";
      draft: string;
      index: number;
    }>;

export type VimHistoryDirection = "older" | "newer";

export type VimHistoryNavigationResult = Readonly<{
  input: string;
  navigation: VimHistoryNavigation;
}>;

export type VimMessagePresentation =
  | Readonly<{ kind: "none" }>
  | Readonly<{
      kind: "message";
      message: VimMessage;
    }>;

export type VimSessionListing =
  | Readonly<{ kind: "none" }>
  | Readonly<{
      kind: "lines";
      lines: ReadonlyArray<string>;
    }>;

type VimSubmission = Readonly<{
  history: VimHistoryKind;
  source: string;
  previous: VimBuffer;
  next: VimBuffer;
}>;

const capacity = 100;

export const initialVimHistoryNavigation: VimHistoryNavigation = {
  kind: "idle",
};

export const emptyVimSessionListing: VimSessionListing = { kind: "none" };

export function createVimSessionState(): VimSessionState {
  return { commandHistory: [], searchHistory: [], messages: [] };
}

export function vimHistory(
  state: VimSessionState,
  kind: VimHistoryKind,
): ReadonlyArray<string> {
  return kind === "command" ? state.commandHistory : state.searchHistory;
}

function appendHistory(
  history: ReadonlyArray<string>,
  source: string,
): ReadonlyArray<string> {
  if (source.length === 0) {
    return history;
  }

  return [...history.filter((entry) => entry !== source), source].slice(
    -capacity,
  );
}

export function navigateVimHistory(
  history: ReadonlyArray<string>,
  input: string,
  navigation: VimHistoryNavigation,
  direction: VimHistoryDirection,
): VimHistoryNavigationResult {
  const draft = navigation.kind === "idle" ? input : navigation.draft;
  const matches = history.filter((entry) => entry.startsWith(draft));

  if (matches.length === 0 || (navigation.kind === "idle" && direction === "newer")) {
    return { input, navigation };
  }

  if (navigation.kind === "idle") {
    const index = matches.length - 1;
    return {
      input: matches[index] ?? input,
      navigation: { kind: "active", draft, index },
    };
  }

  if (direction === "older") {
    const index = Math.max(0, navigation.index - 1);
    return {
      input: matches[index] ?? input,
      navigation: { ...navigation, index },
    };
  }

  const index = navigation.index + 1;

  return index >= matches.length
    ? { input: draft, navigation: initialVimHistoryNavigation }
    : {
        input: matches[index] ?? draft,
        navigation: { ...navigation, index },
      };
}

export function vimCommandEffectMessage(
  effect: VimCommandEffect,
): VimMessagePresentation {
  switch (effect.kind) {
    case "none":
    case "show-history":
    case "show-messages":
      return { kind: "none" };
    case "write":
      return { kind: "message", message: { text: "Write requested" } };
    case "quit":
      return { kind: "message", message: { text: "Quit requested" } };
    case "force-quit":
      return { kind: "message", message: { text: "Force quit requested" } };
    case "write-quit":
      return { kind: "message", message: { text: "Write and quit requested" } };
    case "preview":
      return { kind: "message", message: { text: "Preview requested" } };
    case "unrecognized-command":
      return { kind: "message", message: { text: "Unknown command" } };
  }
}

export function vimStatusMessage(status: VimStatus): VimMessagePresentation {
  switch (status.kind) {
    case "none":
      return { kind: "none" };
    case "invalid-input":
      return { kind: "message", message: { text: `Invalid input: ${status.source}` } };
    case "invalid-search":
      return { kind: "message", message: { text: `Invalid pattern: ${status.query}` } };
    case "no-search-match":
      return { kind: "message", message: { text: `Pattern not found: ${status.query}` } };
    case "no-previous-search":
      return { kind: "message", message: { text: "No previous search pattern" } };
    case "invalid-substitution":
      return { kind: "message", message: { text: `Invalid substitution: ${status.message}` } };
    case "no-substitution-match":
      return { kind: "message", message: { text: `Pattern not found: ${status.pattern}` } };
    case "read-only":
      return { kind: "message", message: { text: `Read-only: ${status.source}` } };
  }
}

function submissionMessages(submission: VimSubmission): ReadonlyArray<VimMessage> {
  const messages: VimMessage[] = [];

  if (submission.previous.commandEffect !== submission.next.commandEffect) {
    const presentation = vimCommandEffectMessage(submission.next.commandEffect);
    if (presentation.kind === "message") {
      messages.push(presentation.message);
    }
  }

  if (submission.previous.status !== submission.next.status) {
    const presentation = vimStatusMessage(submission.next.status);
    if (presentation.kind === "message") {
      messages.push(presentation.message);
    }
  }

  return messages;
}

export function recordVimSubmission(
  state: VimSessionState,
  submission: VimSubmission,
): VimSessionState {
  const history = appendHistory(vimHistory(state, submission.history), submission.source);
  const messages = [...state.messages, ...submissionMessages(submission)].slice(
    -capacity,
  );

  return submission.history === "command"
    ? { ...state, commandHistory: history, messages }
    : { ...state, searchHistory: history, messages };
}

export function vimSessionListing(
  state: VimSessionState,
  effect: VimCommandEffect,
): VimSessionListing {
  switch (effect.kind) {
    case "show-history":
      return {
        kind: "lines",
        lines: vimHistory(state, effect.history).map(
          (entry, index) => `${index + 1}  ${entry}`,
        ),
      };
    case "show-messages":
      return { kind: "lines", lines: state.messages.map((message) => message.text) };
    case "none":
    case "write":
    case "quit":
    case "force-quit":
    case "write-quit":
    case "preview":
    case "unrecognized-command":
      return emptyVimSessionListing;
  }
}
