export type DirtyCloseConfirmationKeyInput = Readonly<{
  key: string;
  focusedAction: "cancel" | "confirm";
}>;

export type DirtyCloseConfirmationKeyResult =
  | Readonly<{ kind: "cancel" }>
  | Readonly<{ kind: "focus-cancel" }>
  | Readonly<{ kind: "focus-confirm" }>
  | Readonly<{ kind: "unhandled" }>;

export function handleDirtyCloseConfirmationKey(
  input: DirtyCloseConfirmationKeyInput,
): DirtyCloseConfirmationKeyResult {
  switch (input.key) {
    case "Escape":
      return { kind: "cancel" };
    case "Tab":
      return input.focusedAction === "cancel"
        ? { kind: "focus-confirm" }
        : { kind: "focus-cancel" };
    default:
      return { kind: "unhandled" };
  }
}
