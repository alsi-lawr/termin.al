import assert from "node:assert/strict";
import test from "node:test";
import { handleDirtyCloseConfirmationKey } from "./DirtyCloseConfirmationKeyHandler.ts";

test("cycles the two mobile dirty-close actions with Tab", () => {
  assert.deepEqual(
    handleDirtyCloseConfirmationKey({ key: "Tab", focusedAction: "cancel" }),
    { kind: "focus-confirm" },
  );
  assert.deepEqual(
    handleDirtyCloseConfirmationKey({ key: "Tab", focusedAction: "confirm" }),
    { kind: "focus-cancel" },
  );
  assert.deepEqual(
    handleDirtyCloseConfirmationKey({ key: "Tab", focusedAction: "dialog" }),
    { kind: "unhandled" },
  );
});

test("confirms from the dialog with y or Enter", () => {
  for (const key of ["y", "Y", "Enter"]) {
    assert.deepEqual(
      handleDirtyCloseConfirmationKey({ key, focusedAction: "dialog" }),
      { kind: "confirm" },
    );
  }
});

test("cancels from the dialog with n or Escape", () => {
  for (const key of ["n", "N", "Escape"]) {
    assert.deepEqual(
      handleDirtyCloseConfirmationKey({ key, focusedAction: "dialog" }),
      { kind: "cancel" },
    );
  }
});

test("preserves native Enter activation for mobile action buttons", () => {
  for (const focusedAction of ["cancel", "confirm"] as const) {
    assert.deepEqual(
      handleDirtyCloseConfirmationKey({ key: "Enter", focusedAction }),
      { kind: "unhandled" },
    );
  }
});
