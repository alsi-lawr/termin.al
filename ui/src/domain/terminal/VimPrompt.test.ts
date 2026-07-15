import assert from "node:assert/strict";
import test from "node:test";
import {
  VimMode,
  backspaceVimInsertText,
  deleteVimInsertText,
  insertVimText,
  moveVimInsertCursorToTextOffset,
  replaceVimInsertText,
  vimBufferCursorOffset,
  vimBufferText,
} from "../vim/VimBuffer.ts";
import {
  applyVimPromptKey,
  createVimPrompt,
  insertVimPromptText,
  normalVimPromptKeyFromKeyboard,
  replaceVimPromptText,
  vimPromptMode,
} from "./VimPrompt.ts";

test("projects terminal prompt editing through shared Vim transitions", () => {
  const prompt = createVimPrompt({
    text: "one two three",
    mode: VimMode.Normal,
    register: { kind: "empty" },
  });
  const atStart = applyVimPromptKey(prompt, { kind: "digit", digit: 0 });
  const counted = applyVimPromptKey(atStart, { kind: "digit", digit: 2 });
  const deleting = applyVimPromptKey(counted, {
    kind: "operator",
    operator: "delete",
  });
  const deleted = applyVimPromptKey(deleting, {
    kind: "motion",
    motion: "word-forward",
  });
  const pasted = applyVimPromptKey(deleted, { kind: "paste-before" });
  const wholeLineDeleted = applyVimPromptKey(
    applyVimPromptKey(
      createVimPrompt({
        text: "abc",
        mode: VimMode.Normal,
        register: { kind: "empty" },
      }),
      { kind: "operator", operator: "delete" },
    ),
    { kind: "operator", operator: "delete" },
  );
  const wholeLinePasted = applyVimPromptKey(wholeLineDeleted, {
    kind: "paste-after",
  });
  const inserted = replaceVimInsertText(
    createVimPrompt({
      text: "",
      mode: VimMode.Insert,
      register: { kind: "character", text: "kept" },
    }),
    "a😀b",
    2,
  );
  const deletedAstral = deleteVimInsertText(inserted);
  const backspaced = backspaceVimInsertText(
    moveVimInsertCursorToTextOffset(inserted, 3),
  );

  assert.equal(vimBufferCursorOffset(prompt), 12);
  assert.equal(vimBufferText(deleted), "three");
  assert.deepEqual(deleted.register, { kind: "character", text: "one two " });
  assert.equal(vimBufferText(pasted), "one two three");
  assert.deepEqual(wholeLineDeleted.register, {
    kind: "character",
    text: "abc",
  });
  assert.equal(vimBufferText(wholeLinePasted), "abc");
  assert.equal(vimBufferCursorOffset(inserted), 1);
  assert.equal(vimBufferText(deletedAstral), "ab");
  assert.equal(vimBufferText(backspaced), "ab");
  assert.deepEqual(inserted.register, { kind: "character", text: "kept" });
  assert.deepEqual(vimPromptMode(pasted), VimMode.Normal);
});

test("filters terminal prompt keys and bounds shared Vim history", () => {
  let prompt = createVimPrompt({
    text: "",
    mode: VimMode.Insert,
    register: { kind: "empty" },
  });

  for (let index = 0; index < 101; index += 1) {
    prompt = insertVimText(prompt, "x");
  }

  assert.equal(prompt.undoStack.length, 100);
  assert.deepEqual(normalVimPromptKeyFromKeyboard("j", false, false), {
    kind: "recognized",
    key: { kind: "history-newer" },
  });
  assert.deepEqual(normalVimPromptKeyFromKeyboard("k", false, false), {
    kind: "recognized",
    key: { kind: "history-older" },
  });
  assert.deepEqual(normalVimPromptKeyFromKeyboard("Home", false, false), {
    kind: "recognized",
    key: { kind: "motion", motion: "line-start" },
  });
  assert.deepEqual(normalVimPromptKeyFromKeyboard("y", false, false), {
    kind: "unrecognized",
  });
});

test("constructs and updates terminal prompts as one canonical line", () => {
  const source = "before😀\r\nafter\rmiddle\nend";
  const expected = "before😀 after middle end";
  const constructed = createVimPrompt({
    text: source,
    mode: VimMode.Normal,
    register: { kind: "empty" },
  });
  const replaced = replaceVimPromptText(
    createVimPrompt({
      text: "",
      mode: VimMode.Insert,
      register: { kind: "empty" },
    }),
    source,
    source.length,
  );
  const pasted = insertVimPromptText(
    createVimPrompt({
      text: "prefix ",
      mode: VimMode.Insert,
      register: { kind: "empty" },
    }),
    source,
  );

  assert.deepEqual(constructed.lines, [expected]);
  assert.deepEqual(replaced.lines, [expected]);
  assert.equal(vimBufferCursorOffset(replaced), expected.length);
  assert.deepEqual(pasted.lines, ["prefix before😀 after middle end"]);
});
