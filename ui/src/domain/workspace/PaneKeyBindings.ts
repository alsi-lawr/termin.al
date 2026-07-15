import {
  createShellPaneContent,
  type PaneOperation,
} from "./PaneTree.ts";

export type PanePrefixState =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "awaiting-command" }>
  | Readonly<{ kind: "awaiting-pane-number" }>;

export type PaneKeyInput = Readonly<{
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
}>;

export type PaneKeyResult =
  | Readonly<{
      kind: "ignored";
      state: PanePrefixState;
    }>
  | Readonly<{
      kind: "prefix-entered";
      state: PanePrefixState;
    }>
  | Readonly<{
      kind: "selection-pending";
      state: PanePrefixState;
    }>
  | Readonly<{
      kind: "operation";
      state: PanePrefixState;
      operation: PaneOperation;
    }>;

export const initialPanePrefixState: PanePrefixState = { kind: "idle" };

function operationForPrefixKey(key: string): PaneOperation | undefined {
  switch (key) {
    case "%":
      return {
        kind: "split",
        orientation: "horizontal",
        content: createShellPaneContent(),
      };
    case '"':
      return {
        kind: "split",
        orientation: "vertical",
        content: createShellPaneContent(),
      };
    case "h":
      return { kind: "focus-direction", direction: "left" };
    case "j":
      return { kind: "focus-direction", direction: "down" };
    case "k":
      return { kind: "focus-direction", direction: "up" };
    case "l":
      return { kind: "focus-direction", direction: "right" };
    case "H":
      return { kind: "resize", direction: "left" };
    case "J":
      return { kind: "resize", direction: "down" };
    case "K":
      return { kind: "resize", direction: "up" };
    case "L":
      return { kind: "resize", direction: "right" };
    case "o":
      return { kind: "focus-next" };
    case "x":
      return { kind: "close" };
    case "z":
      return { kind: "toggle-zoom" };
    case "{":
      return { kind: "swap", direction: "previous" };
    case "}":
      return { kind: "swap", direction: "next" };
    case " ":
      return { kind: "cycle-layout" };
    default:
      return undefined;
  }
}

function paneNumber(key: string): number | undefined {
  if (!/^[1-9]$/u.test(key)) {
    return undefined;
  }

  return Number(key);
}

export function applyPaneKeyInput(
  state: PanePrefixState,
  input: PaneKeyInput,
): PaneKeyResult {
  if (state.kind === "idle") {
    if (
      input.ctrlKey &&
      !input.metaKey &&
      input.key.toLowerCase() === "b"
    ) {
      return {
        kind: "prefix-entered",
        state: { kind: "awaiting-command" },
      };
    }

    return { kind: "ignored", state };
  }

  if (state.kind === "awaiting-pane-number") {
    const number = paneNumber(input.key);

    return number === undefined
      ? { kind: "ignored", state: initialPanePrefixState }
      : {
          kind: "operation",
          state: initialPanePrefixState,
          operation: { kind: "focus-number", number },
        };
  }

  if (input.key === "q") {
    return {
      kind: "selection-pending",
      state: { kind: "awaiting-pane-number" },
    };
  }

  const operation = operationForPrefixKey(input.key);

  return operation === undefined
    ? { kind: "ignored", state: initialPanePrefixState }
    : {
        kind: "operation",
        state: initialPanePrefixState,
        operation,
      };
}
