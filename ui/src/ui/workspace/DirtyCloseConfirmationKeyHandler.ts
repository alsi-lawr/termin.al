type DirtyCloseFocusedAction = "dialog" | "cancel" | "confirm";

export type DirtyCloseActionsVisibility = "hidden" | "visible";

export type DirtyCloseConfirmationKeyInput =
  | Readonly<{
      kind: "key";
      key: string;
      focusedAction: DirtyCloseFocusedAction;
    }>
  | Readonly<{
      kind: "tab";
      focusedAction: DirtyCloseFocusedAction;
      actionsVisibility: DirtyCloseActionsVisibility;
      direction: "backward" | "forward";
    }>;

export type DirtyCloseConfirmationKeyResult =
  | Readonly<{ kind: "cancel" }>
  | Readonly<{ kind: "confirm" }>
  | Readonly<{ kind: "focus-dialog" }>
  | Readonly<{ kind: "focus-cancel" }>
  | Readonly<{ kind: "focus-confirm" }>
  | Readonly<{ kind: "unhandled" }>;

type DirtyCloseActionElement = Readonly<{
  getClientRects: () => ArrayLike<unknown>;
}>;

export function dirtyCloseActionsVisibility(
  cancelAction: DirtyCloseActionElement | null,
  confirmAction: DirtyCloseActionElement | null,
): DirtyCloseActionsVisibility {
  if (cancelAction === null || confirmAction === null) {
    return "hidden";
  }

  return cancelAction.getClientRects().length > 0 &&
    confirmAction.getClientRects().length > 0
    ? "visible"
    : "hidden";
}

export function handleDirtyCloseConfirmationKey(
  input: DirtyCloseConfirmationKeyInput,
): DirtyCloseConfirmationKeyResult {
  if (input.kind === "tab") {
    if (input.actionsVisibility === "hidden") {
      return { kind: "focus-dialog" };
    }

    switch (input.focusedAction) {
      case "dialog":
        return input.direction === "forward"
          ? { kind: "focus-cancel" }
          : { kind: "focus-confirm" };
      case "cancel":
        return { kind: "focus-confirm" };
      case "confirm":
        return { kind: "focus-cancel" };
    }
  }

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
    default:
      return { kind: "unhandled" };
  }
}
