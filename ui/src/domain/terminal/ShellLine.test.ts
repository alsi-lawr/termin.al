import assert from "node:assert/strict";
import test from "node:test";
import {
  backspaceShellLine,
  createShellLine,
  deleteShellLine,
  deleteShellLinePreviousWord,
  insertShellLineText,
  moveShellLineCursorNextWord,
  moveShellLineCursorPreviousWord,
  replaceShellLine,
} from "./ShellLine.ts";

test("edits one immutable Unicode-safe shell line", () => {
  const replaced = replaceShellLine("one😀\r\ntwo", 4);
  const inserted = insertShellLineText(replaced, " X\nY");
  const backspaced = backspaceShellLine(inserted);
  const deleted = deleteShellLine(createShellLine("a😀b", 1));

  assert.deepEqual(replaced, { text: "one😀 two", cursor: 3 });
  assert.deepEqual(inserted, { text: "one X Y😀 two", cursor: 7 });
  assert.deepEqual(backspaced, { text: "one X 😀 two", cursor: 6 });
  assert.deepEqual(deleted, { text: "ab", cursor: 1 });
});

test("moves and deletes shell words with Emacs-compatible boundaries", () => {
  const line = createShellLine("open 😀 projects", "open 😀 projects".length);
  const previousWord = moveShellLineCursorPreviousWord(line);
  const beforePreviousWord = moveShellLineCursorPreviousWord(previousWord);
  const nextWord = moveShellLineCursorNextWord(beforePreviousWord);
  const deleted = deleteShellLinePreviousWord(line);

  assert.equal(previousWord.cursor, "open 😀 ".length);
  assert.equal(beforePreviousWord.cursor, 0);
  assert.equal(nextWord.cursor, "open".length);
  assert.deepEqual(deleted, { text: "open 😀 ", cursor: "open 😀 ".length });
});
