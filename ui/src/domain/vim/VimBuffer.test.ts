import assert from "node:assert/strict";
import test from "node:test";
import {
  VimMode,
  appendVimCommandInput,
  applyNormalVimKey,
  createVimBuffer,
  insertVimText,
  moveVimInsertCursorToTextOffset,
  normalVimKeyFromKeyboard,
  submitVimCommand,
  vimBufferCursorOffset,
  vimBufferText,
} from "./VimBuffer.ts";

test("moves through counted character, word, line, and document motions", () => {
  const buffer = createVimBuffer({
    text: "one two\nthree four\nfive",
    mode: VimMode.Normal,
  });
  const word = applyNormalVimKey(buffer, {
    kind: "motion",
    motion: "word-forward",
  });
  const line = applyNormalVimKey(word, {
    kind: "motion",
    motion: "line-next",
  });
  const counted = applyNormalVimKey(
    applyNormalVimKey(line, { kind: "digit", digit: 3 }),
    { kind: "motion", motion: "right" },
  );
  const documentEnd = applyNormalVimKey(counted, {
    kind: "motion",
    motion: "document-end",
  });
  const documentStart = applyNormalVimKey(documentEnd, {
    kind: "motion",
    motion: "document-start",
  });

  assert.deepEqual(word.cursor, { line: 0, column: 4 });
  assert.deepEqual(line.cursor, { line: 1, column: 4 });
  assert.deepEqual(counted.cursor, { line: 1, column: 7 });
  assert.deepEqual(documentEnd.cursor, { line: 2, column: 3 });
  assert.deepEqual(documentStart.cursor, { line: 0, column: 0 });
});

test("applies delete, change, yank, paste, undo, and redo through the unnamed register", () => {
  const start = createVimBuffer({
    text: "one two\nthree",
    mode: VimMode.Normal,
  });
  const deleting = applyNormalVimKey(start, {
    kind: "operator",
    operator: "delete",
  });
  const deleted = applyNormalVimKey(deleting, {
    kind: "motion",
    motion: "word-forward",
  });
  const pasted = applyNormalVimKey(deleted, { kind: "paste-before" });
  const undone = applyNormalVimKey(pasted, { kind: "undo" });
  const redone = applyNormalVimKey(undone, { kind: "redo" });
  const changing = applyNormalVimKey(
    createVimBuffer({ text: "hello", mode: VimMode.Normal }),
    { kind: "operator", operator: "change" },
  );
  const changed = applyNormalVimKey(changing, {
    kind: "motion",
    motion: "word-forward",
  });
  const inserted = insertVimText(changed, "hi");
  const yanking = applyNormalVimKey(
    createVimBuffer({ text: "alpha\nbeta", mode: VimMode.Normal }),
    { kind: "operator", operator: "yank" },
  );
  const yanked = applyNormalVimKey(yanking, {
    kind: "motion",
    motion: "line-next",
  });

  assert.equal(vimBufferText(deleted), "two\nthree");
  assert.deepEqual(deleted.register, { kind: "character", text: "one " });
  assert.equal(vimBufferText(pasted), "one two\nthree");
  assert.equal(vimBufferText(undone), "two\nthree");
  assert.equal(vimBufferText(redone), "one two\nthree");
  assert.equal(changed.mode.kind, "insert");
  assert.equal(vimBufferText(inserted), "hi");
  assert.deepEqual(yanked.register, {
    kind: "line",
    lines: ["alpha", "beta"],
  });
});

test("keeps linewise visual selections immutable and applies their operator", () => {
  const buffer = createVimBuffer({
    text: "one\ntwo\nthree",
    mode: VimMode.Normal,
  });
  const visual = applyNormalVimKey(buffer, { kind: "enter-visual-line" });
  const selected = applyNormalVimKey(visual, {
    kind: "motion",
    motion: "line-next",
  });
  const deleted = applyNormalVimKey(selected, {
    kind: "operator",
    operator: "delete",
  });

  assert.deepEqual(selected.selection, {
    kind: "line",
    anchorLine: 0,
    activeLine: 1,
  });
  assert.equal(vimBufferText(deleted), "three");
  assert.deepEqual(deleted.register, { kind: "line", lines: ["one", "two"] });
  assert.equal(deleted.mode.kind, "normal");
});

test("searches literal text with n and N and keeps Unicode cursor boundaries", () => {
  const start = createVimBuffer({
    text: "😀 one\n😀 two",
    mode: VimMode.Normal,
  });
  const searchMode = applyNormalVimKey(start, { kind: "enter-search" });
  const typed = appendVimCommandInput(searchMode, "😀");
  const first = submitVimCommand(typed);
  const next = applyNormalVimKey(first, { kind: "search-next" });
  const previous = applyNormalVimKey(next, { kind: "search-previous" });

  assert.deepEqual(first.cursor, { line: 1, column: 0 });
  assert.deepEqual(next.cursor, { line: 0, column: 0 });
  assert.deepEqual(previous.cursor, { line: 1, column: 0 });
});

test("parses only generic command-mode effects", () => {
  const start = createVimBuffer({ text: "", mode: VimMode.Normal });
  const write = submitVimCommand(
    appendVimCommandInput(
      applyNormalVimKey(start, { kind: "enter-command" }),
      "w",
    ),
  );
  const quit = submitVimCommand(
    appendVimCommandInput(
      applyNormalVimKey(start, { kind: "enter-command" }),
      "q",
    ),
  );
  const forceQuit = submitVimCommand(
    appendVimCommandInput(
      applyNormalVimKey(start, { kind: "enter-command" }),
      "q!",
    ),
  );

  assert.deepEqual(write.commandEffect, { kind: "write" });
  assert.deepEqual(quit.commandEffect, { kind: "quit" });
  assert.deepEqual(forceQuit.commandEffect, { kind: "force-quit" });
  assert.equal(write.mode.kind, "normal");
});

test("maps only practical normal-mode keys", () => {
  assert.deepEqual(normalVimKeyFromKeyboard("V", false, false), {
    kind: "recognized",
    key: { kind: "enter-visual-line" },
  });
  assert.deepEqual(normalVimKeyFromKeyboard("y", false, false), {
    kind: "recognized",
    key: { kind: "operator", operator: "yank" },
  });
  assert.deepEqual(normalVimKeyFromKeyboard("q", false, false), {
    kind: "unrecognized",
  });
});

test("maps multiline native editor offsets through Unicode-safe Vim cursors", () => {
  const buffer = createVimBuffer({
    text: "a😀\nsecond",
    mode: VimMode.Insert,
  });
  const normalized = moveVimInsertCursorToTextOffset(buffer, 2);
  const secondLine = moveVimInsertCursorToTextOffset(buffer, 4);

  assert.deepEqual(normalized.cursor, { line: 0, column: 1 });
  assert.equal(vimBufferCursorOffset(normalized), 1);
  assert.deepEqual(secondLine.cursor, { line: 1, column: 0 });
  assert.equal(vimBufferCursorOffset(secondLine), 4);
});
