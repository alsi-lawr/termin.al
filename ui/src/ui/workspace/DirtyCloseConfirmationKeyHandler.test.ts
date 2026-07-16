import assert from "node:assert/strict";
import test from "node:test";
import {
  dirtyCloseActionsVisibility,
  handleDirtyCloseConfirmationKey,
  type DirtyCloseConfirmationKeyInput,
} from "./DirtyCloseConfirmationKeyHandler.ts";

function keyInput(
  key: string,
  focusedAction: "dialog" | "cancel" | "confirm" = "dialog",
): DirtyCloseConfirmationKeyInput {
  return { kind: "key", key, focusedAction };
}

function tabInput(
  focusedAction: "dialog" | "cancel" | "confirm",
  actionsVisibility: "hidden" | "visible",
  direction: "backward" | "forward" = "forward",
): DirtyCloseConfirmationKeyInput {
  return {
    kind: "tab",
    focusedAction,
    actionsVisibility,
    direction,
  };
}

test("maps responsive action layout to hidden and visible focus states", () => {
  const hiddenAction = { getClientRects: () => [] };
  const visibleAction = { getClientRects: () => [{}] };

  assert.equal(dirtyCloseActionsVisibility(null, visibleAction), "hidden");
  assert.equal(
    dirtyCloseActionsVisibility(hiddenAction, visibleAction),
    "hidden",
  );
  assert.equal(
    dirtyCloseActionsVisibility(visibleAction, visibleAction),
    "visible",
  );
});

test("contains desktop Tab and Shift-Tab on the alertdialog", () => {
  for (const direction of ["forward", "backward"] as const) {
    for (const focusedAction of ["dialog", "cancel", "confirm"] as const) {
      assert.deepEqual(
        handleDirtyCloseConfirmationKey(
          tabInput(focusedAction, "hidden", direction),
        ),
        { kind: "focus-dialog" },
      );
    }
  }
});

test("cycles mobile Tab between the visible dirty-close actions", () => {
  assert.deepEqual(
    handleDirtyCloseConfirmationKey(tabInput("dialog", "visible")),
    { kind: "focus-cancel" },
  );
  assert.deepEqual(
    handleDirtyCloseConfirmationKey(
      tabInput("dialog", "visible", "backward"),
    ),
    { kind: "focus-confirm" },
  );
  assert.deepEqual(
    handleDirtyCloseConfirmationKey(tabInput("cancel", "visible")),
    { kind: "focus-confirm" },
  );
  assert.deepEqual(
    handleDirtyCloseConfirmationKey(tabInput("confirm", "visible")),
    { kind: "focus-cancel" },
  );
});

test("confirms from the dialog with y or Enter", () => {
  for (const key of ["y", "Y", "Enter"]) {
    assert.deepEqual(handleDirtyCloseConfirmationKey(keyInput(key)), {
      kind: "confirm",
    });
  }
});

test("cancels from the dialog with n or Escape", () => {
  for (const key of ["n", "N", "Escape"]) {
    assert.deepEqual(handleDirtyCloseConfirmationKey(keyInput(key)), {
      kind: "cancel",
    });
  }
});

test("preserves native Enter activation for mobile action buttons", () => {
  for (const focusedAction of ["cancel", "confirm"] as const) {
    assert.deepEqual(
      handleDirtyCloseConfirmationKey(keyInput("Enter", focusedAction)),
      { kind: "unhandled" },
    );
  }
});
