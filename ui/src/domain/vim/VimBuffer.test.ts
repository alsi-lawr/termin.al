import assert from "node:assert/strict";
import test from "node:test";
import {
  VimMode,
  appendVimCommandInput,
  applyNormalVimKey,
  applyVimPromptKey,
  backspaceVimInsertText,
  createVimBuffer,
  createVimPromptBuffer,
  deleteVimInsertText,
  insertVimText,
  normalVimPromptKeyFromKeyboard,
  replaceVimInsertText,
  vimPromptMode,
  isVimBufferDirty,
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
  const restoredPasted = applyNormalVimKey(undone, { kind: "redo" });
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

  assert.deepEqual(
    {
      deleted: vimBufferText(deleted),
      pasted: vimBufferText(pasted),
      undone: vimBufferText(undone),
      restoredPasted: vimBufferText(restoredPasted),
    },
    {
      deleted: "two\nthree",
      pasted: "one two\nthree",
      undone: "two\nthree",
      restoredPasted: "one two\nthree",
    },
  );
  assert.deepEqual(deleted.register, { kind: "character", text: "one " });
  assert.deepEqual(undone.register, { kind: "character", text: "one " });
  assert.deepEqual(restoredPasted.register, {
    kind: "character",
    text: "one ",
  });
  assert.equal(undone.mode.kind, "normal");
  assert.equal(restoredPasted.mode.kind, "normal");
  assert.equal(isVimBufferDirty(undone), true);
  assert.equal(isVimBufferDirty(restoredPasted), false);
  assert.equal(changed.mode.kind, "insert");
  assert.equal(vimBufferText(inserted), "hi");
  assert.deepEqual(yanked.register, {
    kind: "line",
    lines: ["alpha", "beta"],
  });
});

test("bounds undo and redo history at 100 snapshots", () => {
  const initialText = "x".repeat(100);
  let edited = createVimBuffer({ text: initialText, mode: VimMode.Normal });

  for (let index = 0; index < 100; index += 1) {
    edited = applyNormalVimKey(edited, { kind: "delete-character" });
  }

  assert.equal(edited.undoStack.length, 100);
  assert.equal(edited.redoStack.length, 0);
  assert.equal(vimBufferText(edited), "");
  assert.equal(isVimBufferDirty(edited), true);

  let undone = edited;

  for (let index = 0; index < 100; index += 1) {
    undone = applyNormalVimKey(undone, { kind: "undo" });
  }

  assert.equal(undone.undoStack.length, 0);
  assert.equal(undone.redoStack.length, 100);
  assert.equal(vimBufferText(undone), initialText);
  assert.equal(undone.mode.kind, "normal");
  assert.equal(isVimBufferDirty(undone), false);

  let redone = undone;

  for (let index = 0; index < 100; index += 1) {
    redone = applyNormalVimKey(redone, { kind: "redo" });
  }

  assert.equal(redone.undoStack.length, 100);
  assert.equal(redone.redoStack.length, 0);
  assert.equal(vimBufferText(redone), "");
  assert.equal(redone.mode.kind, "normal");
  assert.equal(isVimBufferDirty(redone), true);
});

test("evicts the oldest snapshot when undo history exceeds 100 entries", () => {
  const initialText = "x".repeat(101);
  let edited = createVimBuffer({ text: initialText, mode: VimMode.Normal });

  for (let index = 0; index < 101; index += 1) {
    edited = applyNormalVimKey(edited, { kind: "delete-character" });
  }

  assert.equal(edited.undoStack.length, 100);

  let oldestRetained = edited;

  for (let index = 0; index < 100; index += 1) {
    oldestRetained = applyNormalVimKey(oldestRetained, { kind: "undo" });
  }

  assert.equal(oldestRetained.redoStack.length, 100);
  assert.equal(vimBufferText(oldestRetained), "x".repeat(100));
  assert.equal(
    vimBufferText(
      applyNormalVimKey(oldestRetained, { kind: "undo" }),
    ),
    "x".repeat(100),
  );
});

test("replays redo snapshots in order and clears redo after a new edit", () => {
  const start = createVimBuffer({ text: "abcd", mode: VimMode.Normal });
  const first = applyNormalVimKey(start, { kind: "delete-character" });
  const second = applyNormalVimKey(first, { kind: "delete-character" });
  const third = applyNormalVimKey(second, { kind: "delete-character" });
  const undoThird = applyNormalVimKey(third, { kind: "undo" });
  const undoSecond = applyNormalVimKey(undoThird, { kind: "undo" });
  const redoSecond = applyNormalVimKey(undoSecond, { kind: "redo" });
  const redoThird = applyNormalVimKey(redoSecond, { kind: "redo" });

  assert.deepEqual(
    [
      vimBufferText(first),
      vimBufferText(second),
      vimBufferText(third),
      vimBufferText(undoThird),
      vimBufferText(undoSecond),
      vimBufferText(redoSecond),
      vimBufferText(redoThird),
    ],
    ["bcd", "cd", "d", "cd", "bcd", "cd", "d"],
  );

  const rewound = applyNormalVimKey(redoThird, { kind: "undo" });
  const moved = applyNormalVimKey(rewound, {
    kind: "motion",
    motion: "right",
  });
  const editedAfterUndo = applyNormalVimKey(moved, {
    kind: "delete-character",
  });
  const redoAttempt = applyNormalVimKey(editedAfterUndo, { kind: "redo" });

  assert.equal(editedAfterUndo.redoStack.length, 0);
  assert.equal(vimBufferText(redoAttempt), "c");
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

test("projects one-line prompt editing through shared Vim transitions", () => {
  const prompt = createVimPromptBuffer({
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
      createVimPromptBuffer({
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
    createVimPromptBuffer({
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

test("keeps prompt key and snapshot behavior concrete and bounded", () => {
  let prompt = createVimPromptBuffer({
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
