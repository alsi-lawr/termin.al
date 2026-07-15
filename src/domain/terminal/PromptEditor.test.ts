import assert from "node:assert/strict";
import test from "node:test";
import { PromptMode } from "./PromptBuffer.ts";
import {
  applyNormalPromptKey,
  createEmptyPromptEditor,
  createPromptEditorForHistory,
  insertPromptEditorText,
  normalPromptKeyFromKeyboard,
} from "./PromptEditor.ts";

test("moves by counted horizontal, word, and line motions", () => {
  const editor = applyNormalPromptKey(
    createPromptEditorForHistory("one two three", PromptMode.Normal, ""),
    { kind: "digit", digit: 0 },
  );
  const word = applyNormalPromptKey(editor, {
    kind: "motion",
    motion: "word-forward",
  });
  const wordEnd = applyNormalPromptKey(word, {
    kind: "motion",
    motion: "word-end",
  });
  const wordBack = applyNormalPromptKey(wordEnd, {
    kind: "motion",
    motion: "word-backward",
  });
  const counted = applyNormalPromptKey(
    applyNormalPromptKey(wordBack, { kind: "digit", digit: 3 }),
    { kind: "motion", motion: "right" },
  );
  const lineEnd = applyNormalPromptKey(counted, {
    kind: "motion",
    motion: "line-end",
  });
  const lineStart = applyNormalPromptKey(lineEnd, {
    kind: "digit",
    digit: 0,
  });

  assert.equal(word.buffer.cursor, 4);
  assert.equal(wordEnd.buffer.cursor, 6);
  assert.equal(wordBack.buffer.cursor, 4);
  assert.equal(counted.buffer.cursor, 7);
  assert.equal(lineEnd.buffer.cursor, 12);
  assert.equal(lineStart.buffer.cursor, 0);
});

test("applies counted delete and change operators to one prompt line", () => {
  const editor = applyNormalPromptKey(
    createPromptEditorForHistory("one two three", PromptMode.Normal, ""),
    { kind: "digit", digit: 0 },
  );
  const counted = applyNormalPromptKey(editor, { kind: "digit", digit: 2 });
  const deleting = applyNormalPromptKey(counted, {
    kind: "operator",
    operator: "delete",
  });
  const deleted = applyNormalPromptKey(deleting, {
    kind: "motion",
    motion: "word-forward",
  });

  assert.equal(deleted.buffer.value, "three");
  assert.equal(deleted.register, "one two ");
  assert.equal(deleted.buffer.mode.kind, "normal");

  const changeEditor = applyNormalPromptKey(
    createPromptEditorForHistory("hello world", PromptMode.Normal, ""),
    { kind: "digit", digit: 0 },
  );
  const changing = applyNormalPromptKey(changeEditor, {
    kind: "operator",
    operator: "change",
  });
  const changed = applyNormalPromptKey(changing, {
    kind: "motion",
    motion: "word-forward",
  });
  const inserted = insertPromptEditorText(changed, "hi ");

  assert.equal(changed.buffer.value, "world");
  assert.equal(changed.buffer.mode.kind, "insert");
  assert.equal(inserted.buffer.value, "hi world");

  const toLineStart = applyNormalPromptKey(
    applyNormalPromptKey(
      createPromptEditorForHistory("abc", PromptMode.Normal, ""),
      { kind: "operator", operator: "delete" },
    ),
    { kind: "digit", digit: 0 },
  );

  assert.equal(toLineStart.buffer.value, "c");
  assert.equal(toLineStart.register, "ab");
});

test("pastes the unnamed register and supports undo and redo", () => {
  const editor = applyNormalPromptKey(
    createPromptEditorForHistory("abc", PromptMode.Normal, ""),
    { kind: "digit", digit: 0 },
  );
  const positioned = applyNormalPromptKey(editor, {
    kind: "motion",
    motion: "right",
  });
  const deleted = applyNormalPromptKey(positioned, {
    kind: "delete-character",
  });
  const pasted = applyNormalPromptKey(deleted, { kind: "paste-before" });
  const undone = applyNormalPromptKey(pasted, { kind: "undo" });
  const redone = applyNormalPromptKey(undone, { kind: "redo" });

  assert.equal(deleted.buffer.value, "ac");
  assert.equal(deleted.register, "b");
  assert.equal(pasted.buffer.value, "abc");
  assert.equal(undone.buffer.value, "ac");
  assert.equal(redone.buffer.value, "abc");
});

test("switches between insert and normal prompt modes", () => {
  const inserted = insertPromptEditorText(createEmptyPromptEditor(), "abc");
  const normal = applyNormalPromptKey(inserted, { kind: "escape" });
  const append = applyNormalPromptKey(normal, { kind: "insert-after" });

  assert.equal(inserted.buffer.cursor, 3);
  assert.deepEqual(normal.buffer, {
    value: "abc",
    cursor: 2,
    mode: { kind: "normal" },
  });
  assert.deepEqual(append.buffer, {
    value: "abc",
    cursor: 3,
    mode: { kind: "insert" },
  });
});

test("translates only supported normal-mode keyboard input", () => {
  assert.deepEqual(normalPromptKeyFromKeyboard("w", false, false), {
    kind: "recognized",
    key: { kind: "motion", motion: "word-forward" },
  });
  assert.deepEqual(normalPromptKeyFromKeyboard("r", true, false), {
    kind: "recognized",
    key: { kind: "redo" },
  });
  assert.deepEqual(normalPromptKeyFromKeyboard("q", false, false), {
    kind: "unrecognized",
  });
});
