import assert from "node:assert/strict";
import test from "node:test";
import { handleDirtyCloseConfirmationKey } from "./DirtyCloseConfirmationKeyHandler.ts";

test("cycles the two dirty-close actions with Tab and Shift-Tab", () => {
  assert.deepEqual(
    handleDirtyCloseConfirmationKey({ key: "Tab", focusedAction: "cancel" }),
    { kind: "focus-confirm" },
  );
  assert.deepEqual(
    handleDirtyCloseConfirmationKey({ key: "Tab", focusedAction: "confirm" }),
    { kind: "focus-cancel" },
  );
});

test("keeps editing on Escape and leaves other keys alone", () => {
  assert.deepEqual(
    handleDirtyCloseConfirmationKey({
      key: "Escape",
      focusedAction: "cancel",
    }),
    { kind: "cancel" },
  );
  assert.deepEqual(
    handleDirtyCloseConfirmationKey({ key: "Enter", focusedAction: "confirm" }),
    { kind: "unhandled" },
  );
});
