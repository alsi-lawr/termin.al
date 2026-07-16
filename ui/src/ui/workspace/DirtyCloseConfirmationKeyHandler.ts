export type DirtyCloseConfirmationKeyInput = Readonly<{
  key: string;
  focusedAction: "dialog" | "cancel" | "confirm";
}>;

export type DirtyCloseConfirmationKeyResult =
  | Readonly<{ kind: "cancel" }>
  | Readonly<{ kind: "confirm" }>
  | Readonly<{ kind: "focus-cancel" }>
  | Readonly<{ kind: "focus-confirm" }>
  | Readonly<{ kind: "unhandled" }>;

export function handleDirtyCloseConfirmationKey(
  input: DirtyCloseConfirmationKeyInput,
): DirtyCloseConfirmationKeyResult {
  switch (input.key) {
    case "Escape":
    case "n":
    case "N":
      return { kind: "cancel" };
    case "y":
    case "Y":
      return { kind: "confirm" };
    case "Enter":
      return input.focusedAction === "dialog"
        ? { kind: "confirm" }
        : { kind: "unhandled" };
    case "Tab":
      switch (input.focusedAction) {
        case "dialog":
          return { kind: "unhandled" };
        case "cancel":
          return { kind: "focus-confirm" };
        case "confirm":
          return { kind: "focus-cancel" };
      }
    default:
      return { kind: "unhandled" };
  }
}
