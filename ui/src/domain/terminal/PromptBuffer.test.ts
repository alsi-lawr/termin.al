import assert from "node:assert/strict";
import test from "node:test";
import {
  PromptMode,
  backspacePromptBuffer,
  createPromptBuffer,
  deletePromptBufferAtCursor,
  insertPromptText,
  movePromptCursorLeft,
  movePromptCursorRight,
} from "./PromptBuffer.ts";

test("keeps prompt buffer cursors and mutations on Unicode code-point boundaries", () => {
  const normalized = createPromptBuffer({
    value: "a😀b",
    cursor: 2,
    mode: PromptMode.Insert,
  });
  const movedLeft = movePromptCursorLeft(normalized);
  const movedRight = movePromptCursorRight(normalized);
  const inserted = insertPromptText(
    createPromptBuffer({
      value: "ab",
      cursor: 1,
      mode: PromptMode.Insert,
    }),
    "😀",
  );
  const backspaced = backspacePromptBuffer(
    createPromptBuffer({
      value: "a😀b",
      cursor: 3,
      mode: PromptMode.Insert,
    }),
  );
  const deleted = deletePromptBufferAtCursor(normalized);

  assert.equal(normalized.cursor, 1);
  assert.equal(movedLeft.cursor, 0);
  assert.equal(movedRight.cursor, 3);
  assert.deepEqual(inserted, {
    value: "a😀b",
    cursor: 3,
    mode: PromptMode.Insert,
  });
  assert.deepEqual(backspaced, {
    value: "ab",
    cursor: 1,
    mode: PromptMode.Insert,
  });
  assert.deepEqual(deleted, {
    value: "ab",
    cursor: 1,
    mode: PromptMode.Insert,
  });
});
