import assert from "node:assert/strict";
import test from "node:test";
import {
  VimMode,
  appendVimCommandInput,
  applyNormalVimKey,
  createVimBuffer,
  insertVimText,
  isVimBufferDirty,
  moveVimInsertCursorToTextOffset,
  normalVimKeyFromKeyboard,
  replaceVimInsertText,
  submitVimCommand,
  vimBufferCursorOffset,
  vimBufferText,
  type VimBuffer,
  type VimNormalKey,
  type VimRegister,
} from "./VimBuffer.ts";

function mappedKey(
  key: string,
  ctrlKey = false,
  metaKey = false,
): VimNormalKey {
  const match = normalVimKeyFromKeyboard(key, ctrlKey, metaKey);

  if (match.kind === "unrecognized") {
    throw new Error(`Expected ${key} to be a recognized Vim key.`);
  }

  return match.key;
}

function press(buffer: VimBuffer, ...keys: ReadonlyArray<string>): VimBuffer {
  let next = buffer;

  for (const key of keys) {
    next = applyNormalVimKey(next, mappedKey(key));
  }

  return next;
}

function pressControl(buffer: VimBuffer, key: string): VimBuffer {
  return applyNormalVimKey(buffer, mappedKey(key, true));
}

test("parses counts once and preserves the desired column for vertical motions", () => {
  const start = createVimBuffer({
    text: "abcdef\nx\nabcdef\n  z",
    mode: VimMode.Normal,
  });
  const positioned = press(start, "l", "l", "l", "l");
  const shortLine = press(positioned, "j");
  const restored = press(shortLine, "j");
  const counted = press(positioned, "5", "j");
  const boundary = press(counted, "j");

  assert.deepEqual(shortLine.cursor, { line: 1, column: 0 });
  assert.deepEqual(restored.cursor, { line: 2, column: 4 });
  assert.deepEqual(counted.cursor, { line: 3, column: 2 });
  assert.deepEqual(boundary.cursor, counted.cursor);
  assert.deepEqual(boundary.status, { kind: "invalid-input", source: "j" });

  const firstNonblank = press(start, "+");
  const resetGoal = press(press(positioned, "+"), "-");

  assert.deepEqual(firstNonblank.cursor, { line: 1, column: 0 });
  assert.deepEqual(resetGoal.cursor, { line: 0, column: 0 });
});

test("maps logical aliases without restoring the removed one-key document-start shortcut", () => {
  const start = createVimBuffer({ text: "abcd\n  ef", mode: VimMode.Normal });
  const right = applyNormalVimKey(start, mappedKey("ArrowRight"));
  const space = press(right, " ");
  const home = applyNormalVimKey(space, mappedKey("Home"));
  const end = applyNormalVimKey(home, mappedKey("End"));
  const backspace = applyNormalVimKey(end, mappedKey("Backspace"));
  const down = pressControl(backspace, "n");
  const up = pressControl(down, "p");
  const ctrlH = pressControl(up, "h");
  const enter = applyNormalVimKey(home, mappedKey("Enter"));
  const bareG = press(start, "g");

  assert.deepEqual(right.cursor, { line: 0, column: 1 });
  assert.deepEqual(space.cursor, { line: 0, column: 2 });
  assert.deepEqual(home.cursor, { line: 0, column: 0 });
  assert.deepEqual(end.cursor, { line: 0, column: 3 });
  assert.deepEqual(backspace.cursor, { line: 0, column: 2 });
  assert.deepEqual(down.cursor, { line: 1, column: 2 });
  assert.deepEqual(up.cursor, { line: 0, column: 2 });
  assert.deepEqual(ctrlH.cursor, { line: 0, column: 1 });
  assert.deepEqual(enter.cursor, { line: 1, column: 2 });
  assert.equal(bareG.pending.kind, "prefix");
  assert.deepEqual(bareG.cursor, start.cursor);
});

test("resolves line anchors and count-addressed line-end behavior explicitly", () => {
  const start = createVimBuffer({
    text: "   abc   \n\n   ",
    mode: VimMode.Normal,
  });
  const inside = press(start, "l", "l", "l", "l");
  const firstNonblank = press(inside, "^");
  const lineStart = press(firstNonblank, "0");
  const lastNonblank = press(lineStart, "g", "_");
  const secondEnd = press(start, "2", "$");
  const thirdEnd = press(start, "3", "$");
  const impossible = press(start, "4", "$");

  assert.deepEqual(firstNonblank.cursor, { line: 0, column: 3 });
  assert.deepEqual(lineStart.cursor, { line: 0, column: 0 });
  assert.deepEqual(lastNonblank.cursor, { line: 0, column: 5 });
  assert.deepEqual(secondEnd.cursor, { line: 1, column: 0 });
  assert.deepEqual(thirdEnd.cursor, { line: 2, column: 2 });
  assert.deepEqual(impossible.cursor, start.cursor);
  assert.deepEqual(impossible.status, {
    kind: "invalid-input",
    source: "4$",
  });

  const deletedLine = press(start, "d", "_");
  assert.equal(vimBufferText(deletedLine), "\n   ");
  assert.deepEqual(deletedLine.register, {
    kind: "line",
    lines: ["   abc   "],
  });
});

test("anchors empty and all-blank lines at column zero with exclusive ranges", () => {
  const empty = createVimBuffer({ text: "", mode: VimMode.Normal });
  const emptyAnchor = press(empty, "^");
  const emptyYank = press(empty, "y", "^");
  const allBlank = press(
    createVimBuffer({ text: "   ", mode: VimMode.Normal }),
    "l",
    "l",
  );
  const allBlankAnchor = press(allBlank, "^");
  const allBlankDelete = press(allBlank, "d", "^");

  assert.deepEqual(emptyAnchor.cursor, { line: 0, column: 0 });
  assert.deepEqual(emptyYank.register, { kind: "character", text: "" });
  assert.equal(vimBufferText(emptyYank), "");
  assert.deepEqual(allBlankAnchor.cursor, { line: 0, column: 0 });
  assert.equal(vimBufferText(allBlankDelete), " ");
  assert.deepEqual(allBlankDelete.register, {
    kind: "character",
    text: "  ",
  });
});

test("implements gg and G with addressed lines, saturation, and invalid prefixes", () => {
  const start = createVimBuffer({
    text: "zero\n one\n  two\n   three\n    four\n     five",
    mode: VimMode.Normal,
  });
  const middle = press(start, "4", "j");
  const first = press(middle, "g", "g");
  const fifth = press(start, "5", "g", "g");
  const final = press(start, "G");
  const addressedFirst = press(final, "1", "G");
  const saturated = press(
    start,
    ..."99999999999999999999999999999999999999999999999999",
    "g",
    "g",
  );
  const invalid = press(start, "g", "x");
  const cleared = press(invalid, "l");

  assert.deepEqual(first.cursor, { line: 0, column: 0 });
  assert.deepEqual(fifth.cursor, { line: 4, column: 4 });
  assert.deepEqual(final.cursor, { line: 5, column: 5 });
  assert.deepEqual(addressedFirst.cursor, { line: 0, column: 0 });
  assert.deepEqual(saturated.cursor, { line: 5, column: 5 });
  assert.deepEqual(invalid.cursor, start.cursor);
  assert.deepEqual(invalid.status, { kind: "invalid-input", source: "gx" });
  assert.deepEqual(cleared.status, { kind: "none" });
});

test("distinguishes small words, WORDs, inclusive ends, and g word extensions", () => {
  const start = createVimBuffer({
    text: "αβ,!?  gamma delta",
    mode: VimMode.Normal,
  });
  const punctuation = press(start, "w");
  const smallNext = press(punctuation, "w");
  const bigNext = press(start, "W");
  const smallEnd = press(start, "e");
  const punctuationEnd = press(smallEnd, "e");
  const backward = press(smallNext, "b");
  const previousEnd = press(smallNext, "g", "e");
  const previousWORDEnd = press(bigNext, "g", "E");

  assert.deepEqual(punctuation.cursor, { line: 0, column: 2 });
  assert.deepEqual(smallNext.cursor, { line: 0, column: 7 });
  assert.deepEqual(bigNext.cursor, { line: 0, column: 7 });
  assert.deepEqual(smallEnd.cursor, { line: 0, column: 1 });
  assert.deepEqual(punctuationEnd.cursor, { line: 0, column: 4 });
  assert.deepEqual(backward.cursor, { line: 0, column: 2 });
  assert.deepEqual(previousEnd.cursor, { line: 0, column: 4 });
  assert.deepEqual(previousWORDEnd.cursor, { line: 0, column: 4 });

  const acrossEmptyLine = press(
    createVimBuffer({ text: "one\n\ntwo", mode: VimMode.Normal }),
    "w",
  );
  assert.deepEqual(acrossEmptyLine.cursor, { line: 1, column: 0 });
});

test("multiplies operator and motion counts and applies explicit range kinds", () => {
  const counted = press(
    createVimBuffer({
      text: "one two three four five six seven",
      mode: VimMode.Normal,
    }),
    "2",
    "d",
    "3",
    "w",
  );
  const deleteRight = press(
    createVimBuffer({ text: "abcd", mode: VimMode.Normal }),
    "d",
    "l",
  );
  const deleteLeft = press(press(
    createVimBuffer({ text: "abcd", mode: VimMode.Normal }),
    "l",
    "l",
  ), "d", "h");
  const deleteEnd = press(
    createVimBuffer({ text: "abcd", mode: VimMode.Normal }),
    "l",
    "d",
    "$",
  );
  const doubled = press(
    createVimBuffer({ text: "one\ntwo\nthree", mode: VimMode.Normal }),
    "2",
    "d",
    "d",
  );
  const changed = press(
    createVimBuffer({ text: "hello world", mode: VimMode.Normal }),
    "c",
    "e",
  );
  const inserted = insertVimText(changed, "hi");
  const yanked = press(
    createVimBuffer({ text: "alpha\nbeta", mode: VimMode.Normal }),
    "y",
    "j",
  );
  const saturatedProduct = press(
    createVimBuffer({ text: "one two three", mode: VimMode.Normal }),
    ..."9999999999999999999999999999999999999999",
    "d",
    ..."9999999999999999999999999999999999999999",
    "w",
  );

  assert.equal(vimBufferText(counted), "seven");
  assert.equal(vimBufferText(deleteRight), "bcd");
  assert.equal(vimBufferText(deleteLeft), "acd");
  assert.equal(vimBufferText(deleteEnd), "a");
  assert.equal(vimBufferText(doubled), "three");
  assert.equal(changed.mode.kind, "insert");
  assert.equal(vimBufferText(inserted), "hi world");
  assert.deepEqual(yanked.register, {
    kind: "line",
    lines: ["alpha", "beta"],
  });
  assert.equal(vimBufferText(saturatedProduct), "");
});

test("finds and tills counted targets and repeats accepted finds", () => {
  const start = createVimBuffer({ text: "abacad", mode: VimMode.Normal });
  const secondA = press(start, "2", "f", "a");
  const repeated = press(press(start, "f", "a"), ";");
  const reversed = press(repeated, ",");
  const sameAfterReverse = press(reversed, ";");
  const repeatStart = createVimBuffer({
    text: "a1a2a3a4a",
    mode: VimMode.Normal,
  });
  const countedRepeated = press(press(repeatStart, "f", "a"), "3", ";");
  const countedReversed = press(countedRepeated, "2", ",");
  const till = press(start, "t", "a");
  const backwardTill = press(press(start, "$"), "2", "T", "a");
  const missed = press(press(start, "f", "a"), "f", "z");
  const repeatAfterMiss = press(missed, ";");

  assert.deepEqual(secondA.cursor, { line: 0, column: 4 });
  assert.deepEqual(repeated.cursor, { line: 0, column: 4 });
  assert.deepEqual(reversed.cursor, { line: 0, column: 2 });
  assert.deepEqual(sameAfterReverse.cursor, { line: 0, column: 4 });
  assert.deepEqual(countedRepeated.cursor, { line: 0, column: 8 });
  assert.deepEqual(countedReversed.cursor, { line: 0, column: 4 });
  assert.deepEqual(till.cursor, { line: 0, column: 1 });
  assert.deepEqual(backwardTill.cursor, { line: 0, column: 3 });
  assert.deepEqual(missed.cursor, { line: 0, column: 2 });
  assert.deepEqual(missed.status, { kind: "invalid-input", source: "fz" });
  assert.deepEqual(repeatAfterMiss.cursor, { line: 0, column: 4 });

  const deletedFind = press(start, "d", "f", "a");
  const deletedTill = press(start, "d", "t", "a");
  const backwardFind = press(press(start, "$"), "d", "F", "a");
  const backwardExclusiveTill = press(
    press(start, "$"),
    "d",
    "2",
    "T",
    "a",
  );

  assert.equal(vimBufferText(deletedFind), "cad");
  assert.equal(vimBufferText(deletedTill), "acad");
  assert.equal(vimBufferText(backwardFind), "abaca");
  assert.equal(vimBufferText(backwardExclusiveTill), "aba");
  assert.deepEqual(backwardExclusiveTill.register, {
    kind: "character",
    text: "cad",
  });

  const crossLine = press(
    createVimBuffer({ text: "abc\na", mode: VimMode.Normal }),
    "f",
    "a",
  );
  assert.deepEqual(crossLine.status, { kind: "invalid-input", source: "fa" });
});

test("matches nested fixed delimiters and treats counted percent as a file percentage", () => {
  const nested = createVimBuffer({ text: "(a[{}]b)", mode: VimMode.Normal });
  const outer = press(nested, "%");
  const inner = press(nested, "3", "l", "%");
  const unmatched = press(
    createVimBuffer({ text: "(abc", mode: VimMode.Normal }),
    "%",
  );
  const percentage = press(
    createVimBuffer({ text: "a\n b\n  c\n   d", mode: VimMode.Normal }),
    "5",
    "0",
    "%",
  );
  const invalidPercentage = press(
    createVimBuffer({ text: "a\nb", mode: VimMode.Normal }),
    "1",
    "0",
    "1",
    "%",
  );
  const deletedHalf = press(
    createVimBuffer({ text: "a\nb\nc\nd", mode: VimMode.Normal }),
    "d",
    "5",
    "0",
    "%",
  );
  const explicitOperatorOne = press(
    createVimBuffer({ text: "a\nb\nc", mode: VimMode.Normal }),
    "j",
    "1",
    "d",
    "G",
  );

  assert.deepEqual(outer.cursor, { line: 0, column: 7 });
  assert.deepEqual(inner.cursor, { line: 0, column: 4 });
  assert.deepEqual(unmatched.status, { kind: "invalid-input", source: "%" });
  assert.deepEqual(percentage.cursor, { line: 1, column: 1 });
  assert.deepEqual(invalidPercentage.status, {
    kind: "invalid-input",
    source: "101%",
  });
  assert.equal(vimBufferText(deletedHalf), "c\nd");
  assert.equal(vimBufferText(explicitOperatorOne), "c");
});

test("applies matched-delimiter ranges through delete, change, and yank", () => {
  const text = "(a[b]c) tail";
  const deleted = press(
    createVimBuffer({ text, mode: VimMode.Normal }),
    "d",
    "%",
  );
  const changed = press(
    createVimBuffer({ text, mode: VimMode.Normal }),
    "c",
    "%",
  );
  const yanked = press(
    createVimBuffer({ text, mode: VimMode.Normal }),
    "y",
    "%",
  );
  const matchedRegister = { kind: "character", text: "(a[b]c)" };

  assert.equal(vimBufferText(deleted), " tail");
  assert.deepEqual(deleted.register, matchedRegister);
  assert.equal(vimBufferText(changed), " tail");
  assert.equal(changed.mode.kind, "insert");
  assert.deepEqual(changed.register, matchedRegister);
  assert.equal(vimBufferText(yanked), text);
  assert.deepEqual(yanked.register, matchedRegister);
});

test("Escape cancels every pending stage and invalid input mutates only status and pending", () => {
  const start = createVimBuffer({ text: "abc def", mode: VimMode.Normal });
  const stages = [
    press(start, "2"),
    press(start, "d"),
    press(start, "g"),
    press(start, "f"),
    press(start, "["),
    press(start, "m"),
    press(start, "d", "i"),
  ];

  for (const pending of stages) {
    const cancelled = applyNormalVimKey(pending, mappedKey("Escape"));
    assert.equal(cancelled.pending.kind, "none");
    assert.deepEqual(cancelled.status, { kind: "none" });
    assert.equal(vimBufferText(cancelled), vimBufferText(start));
    assert.deepEqual(cancelled.cursor, start.cursor);
  }

  const withRegister = press(start, "y", "w");
  const invalid = press(withRegister, "g", "q");

  assert.equal(vimBufferText(invalid), vimBufferText(withRegister));
  assert.deepEqual(invalid.cursor, withRegister.cursor);
  assert.deepEqual(invalid.selection, withRegister.selection);
  assert.deepEqual(invalid.register, withRegister.register);
  assert.deepEqual(invalid.undoStack, withRegister.undoStack);
  assert.deepEqual(invalid.redoStack, withRegister.redoStack);
  assert.deepEqual(invalid.mode, withRegister.mode);
  assert.equal(invalid.pending.kind, "none");
  assert.deepEqual(invalid.status, { kind: "invalid-input", source: "gq" });
});

test("keeps linewise visual movement on the shared resolver contract", () => {
  const start = createVimBuffer({
    text: "one\ntwo\nthree",
    mode: VimMode.Normal,
  });
  const visual = press(start, "V");
  const selected = press(visual, "j");
  const deleted = press(selected, "d");

  assert.deepEqual(selected.selection, {
    kind: "line",
    anchorLine: 0,
    activeLine: 1,
  });
  assert.equal(vimBufferText(deleted), "three");
  assert.deepEqual(deleted.register, { kind: "line", lines: ["one", "two"] });
  assert.equal(deleted.mode.kind, "normal");
});

test("preserves surrogate-safe cursor and range boundaries", () => {
  const start = createVimBuffer({ text: "a😀b 😀", mode: VimMode.Normal });
  const emoji = press(start, "l");
  const afterEmoji = press(emoji, "l");
  const found = press(start, "f", "😀");
  const deleted = press(start, "d", "f", "😀");

  assert.deepEqual(emoji.cursor, { line: 0, column: 1 });
  assert.deepEqual(afterEmoji.cursor, { line: 0, column: 3 });
  assert.deepEqual(found.cursor, { line: 0, column: 1 });
  assert.equal(vimBufferText(deleted), "b 😀");
});

test("retains undo, redo, paste, and bounded history behavior", () => {
  const start = createVimBuffer({ text: "abcd", mode: VimMode.Normal });
  const first = press(start, "x");
  const second = press(first, "x");
  const pasted = press(second, "P");
  const undone = press(pasted, "u");
  const redone = applyNormalVimKey(undone, mappedKey("r", true));

  assert.equal(vimBufferText(first), "bcd");
  assert.equal(vimBufferText(second), "cd");
  assert.equal(vimBufferText(pasted), "bcd");
  assert.equal(vimBufferText(undone), "cd");
  assert.equal(vimBufferText(redone), "bcd");

  let edited = createVimBuffer({ text: "x".repeat(101), mode: VimMode.Normal });

  for (let index = 0; index < 101; index += 1) {
    edited = press(edited, "x");
  }

  assert.equal(edited.undoStack.length, 100);
  assert.equal(edited.redoStack.length, 0);

  let rewound = edited;

  for (let index = 0; index < 100; index += 1) {
    rewound = press(rewound, "u");
  }

  assert.equal(rewound.redoStack.length, 100);
  assert.equal(vimBufferText(rewound), "x".repeat(100));
  assert.equal(isVimBufferDirty(rewound), true);
});

test("retains command, search, and insert-mode behavior", () => {
  const start = createVimBuffer({
    text: "😀 one\n😀 two",
    mode: VimMode.Normal,
  });
  const searchMode = press(start, "/");
  const typed = appendVimCommandInput(searchMode, "😀");
  const first = submitVimCommand(typed);
  const next = press(first, "n");
  const previous = press(next, "N");

  assert.deepEqual(first.cursor, { line: 1, column: 0 });
  assert.deepEqual(next.cursor, { line: 0, column: 0 });
  assert.deepEqual(previous.cursor, { line: 1, column: 0 });

  const write = submitVimCommand(
    appendVimCommandInput(press(start, ":"), "w"),
  );
  assert.deepEqual(write.commandEffect, { kind: "write" });

  const insert = createVimBuffer({ text: "a😀\nsecond", mode: VimMode.Insert });
  const normalized = moveVimInsertCursorToTextOffset(insert, 2);
  const secondLine = moveVimInsertCursorToTextOffset(insert, 4);

  assert.deepEqual(normalized.cursor, { line: 0, column: 1 });
  assert.equal(vimBufferCursorOffset(normalized), 1);
  assert.deepEqual(secondLine.cursor, { line: 1, column: 0 });
  assert.equal(vimBufferCursorOffset(secondLine), 4);
});

test("keyboard mapping exposes finite parser input and accepted control aliases", () => {
  assert.deepEqual(normalVimKeyFromKeyboard("g", false, false), {
    kind: "recognized",
    key: { kind: "literal", value: "g" },
  });
  assert.deepEqual(normalVimKeyFromKeyboard("Home", false, false), {
    kind: "recognized",
    key: { kind: "motion", motion: "line-start" },
  });
  assert.deepEqual(normalVimKeyFromKeyboard("n", true, false), {
    kind: "recognized",
    key: { kind: "motion", motion: "line-next" },
  });
  assert.deepEqual(normalVimKeyFromKeyboard("b", true, false), {
    kind: "unrecognized",
  });
  assert.deepEqual(normalVimKeyFromKeyboard("x", false, true), {
    kind: "unrecognized",
  });
});

test("moves across fixed POSIX sentences, paragraphs, and roff sections", () => {
  const sentences = createVimBuffer({
    text: "One.)]  Two? One space. Next\n\n.SH Heading\nThree!  Four",
    mode: VimMode.Normal,
  });
  const second = press(sentences, ")");
  const heading = press(sentences, "2", ")");
  const backwards = press(press(sentences, "G"), "2", "(");

  assert.deepEqual(second.cursor, { line: 0, column: 8 });
  assert.deepEqual(heading.cursor, { line: 1, column: 0 });
  assert.deepEqual(backwards.cursor, { line: 1, column: 0 });

  const paragraphs = createVimBuffer({
    text: "first\n   \nstill first\n\n.IP item\nbody\n.SH section\nlast",
    mode: VimMode.Normal,
  });
  const whitespaceIsNotMotionBoundary = press(paragraphs, "}");
  const nextMacro = press(whitespaceIsNotMotionBoundary, "}");
  const previous = press(nextMacro, "{");

  assert.deepEqual(whitespaceIsNotMotionBoundary.cursor, { line: 3, column: 0 });
  assert.deepEqual(nextMacro.cursor, { line: 4, column: 0 });
  assert.deepEqual(previous.cursor, { line: 3, column: 0 });

  const sections = createVimBuffer({
    text: ".SH one\ntext\n}\n.H two\ntext\n{three\n}\n\fpage",
    mode: VimMode.Normal,
  });

  assert.deepEqual(press(sections, "]", "]").cursor, { line: 3, column: 0 });
  assert.deepEqual(press(sections, "2", "]", "]").cursor, { line: 5, column: 0 });
  assert.deepEqual(press(press(sections, "G"), "2", "[", "[").cursor, { line: 5, column: 0 });
  assert.deepEqual(press(press(sections, "G"), "[", "]").cursor, { line: 6, column: 0 });
  assert.deepEqual(press(sections, "]", "[").cursor, { line: 2, column: 0 });

  const structuralDelete = press(sections, "d", "]", "]");
  const structuralYank = press(sections, "y", "]", "[");
  const structuralChange = press(sections, "c", "]", "]");
  assert.equal(vimBufferText(structuralDelete), ".H two\ntext\n{three\n}\n\fpage");
  assert.deepEqual(structuralYank.register, { kind: "line", lines: [".SH one", "text"] });
  assert.equal(structuralChange.mode.kind, "insert");

  const invalid = press(sections, "[", "x");
  const cancelled = applyNormalVimKey(press(sections, "["), mappedKey("Escape"));
  assert.deepEqual(invalid.status, { kind: "invalid-input", source: "[x" });
  assert.equal(cancelled.pending.kind, "none");

  const sectionPairs = ["SH", "NH", "H ", "HU", "nh", "sh"];
  for (const macro of sectionPairs) {
    const result = press(
      createVimBuffer({ text: "head\ntext\n." + macro + " title", mode: VimMode.Normal }),
      "]", "]",
    );
    assert.deepEqual(result.cursor, { line: 2, column: 0 });
  }

  const paragraphPairs = [
    "IP", "LP", "PP", "QP", "P ", "TP", "HP", "LI",
    "Pp", "Lp", "It", "pp", "lp", "ip", "bp",
  ];
  for (const macro of paragraphPairs) {
    const result = press(
      createVimBuffer({ text: "head\ntext\n." + macro + " body", mode: VimMode.Normal }),
      "}",
    );
    assert.deepEqual(result.cursor, { line: 2, column: 0 });
  }
});

test("stores all lowercase local marks and restores their exact edit lifecycle", () => {
  const names = "abcdefghijklmnopqrstuvwxyz";
  let marked = createVimBuffer({ text: "zero\n  one😀\ntwo", mode: VimMode.Normal });

  for (const name of names) {
    marked = press(marked, "m", name);
  }

  assert.equal(marked.marks.length, 26);
  const positioned = press(marked, "j", "l", "l", "l", "l", "m", "a", "j");
  const exact = press(positioned, "`", "a");
  const linewise = press(positioned, "'", "a");

  assert.deepEqual(exact.cursor, { line: 1, column: 4 });
  assert.deepEqual(linewise.cursor, { line: 1, column: 2 });

  const insertStart = press(exact, "I");
  const inserted = insertVimText(insertStart, "++");
  const normal = applyNormalVimKey(inserted, mappedKey("Escape"));
  const shifted = press(normal, "G", "`", "a");
  assert.deepEqual(shifted.cursor, { line: 1, column: 6 });

  const deletedTarget = press(shifted, "x");
  assert.equal(deletedTarget.marks.some((mark) => mark.name === "a"), false);
  const restored = press(deletedTarget, "u", "`", "a");
  assert.deepEqual(restored.cursor, { line: 1, column: 6 });
  const redone = applyNormalVimKey(restored, mappedKey("r", true));
  assert.equal(redone.marks.some((mark) => mark.name === "a"), false);

  const replacementStart = press(marked, "j", "l", "l", "m", "b", "i");
  const replaced = replaceVimInsertText(replacementStart, "replacement", 0);
  assert.equal(replaced.marks.some((mark) => mark.name === "b"), false);

  const newlineMarked = press(
    createVimBuffer({ text: "one\ntwo\nthree", mode: VimMode.Normal }),
    "j", "m", "c", "I",
  );
  const joined = replaceVimInsertText(newlineMarked, "onetwo\nthree", 3);
  assert.deepEqual(press(applyNormalVimKey(joined, mappedKey("Escape")), "`", "c").cursor, {
    line: 0,
    column: 3,
  });

  const repeated = press(createVimBuffer({ text: "aaa", mode: VimMode.Normal }), "m", "d", "l", "m", "e", "h", "x");
  assert.equal(repeated.marks.some((mark) => mark.name === "d"), false);
  assert.deepEqual(press(repeated, "`", "e").cursor, { line: 0, column: 0 });

  assert.deepEqual(press(marked, "`", "A").status, {
    kind: "invalid-input",
    source: "`A",
  });
  assert.deepEqual(press(createVimBuffer({ text: "x", mode: VimMode.Normal }), "'", "z").status, {
    kind: "invalid-input",
    source: "'z",
  });
});

test("executes word and WORD objects through the shared delete change and yank path", () => {
  const text = "αβ,!?  gamma delta";
  const deletedInner = press(createVimBuffer({ text, mode: VimMode.Normal }), "d", "i", "w");
  const deletedAround = press(createVimBuffer({ text, mode: VimMode.Normal }), "2", "d", "a", "w");
  const changedWORD = press(createVimBuffer({ text, mode: VimMode.Normal }), "c", "i", "W");
  const yanked = press(createVimBuffer({ text, mode: VimMode.Normal }), "2", "y", "i", "w");

  assert.equal(vimBufferText(deletedInner), ",!?  gamma delta");
  assert.equal(vimBufferText(deletedAround), "gamma delta");
  assert.equal(vimBufferText(changedWORD), "  gamma delta");
  assert.equal(changedWORD.mode.kind, "insert");
  assert.deepEqual(yanked.register, { kind: "character", text: "αβ,!?" });

  const surrogate = press(
    createVimBuffer({ text: "😀😀 word", mode: VimMode.Normal }),
    "d", "i", "W",
  );
  assert.equal(vimBufferText(surrogate), " word");

  const countedText = "one  two three";
  const countedDelete = press(
    createVimBuffer({ text: countedText, mode: VimMode.Normal }),
    "2", "d", "i", "w",
  );
  const countedChange = press(
    createVimBuffer({ text: countedText, mode: VimMode.Normal }),
    "2", "c", "i", "w",
  );
  const countedYank = press(
    createVimBuffer({ text: countedText, mode: VimMode.Normal }),
    "2", "y", "i", "w",
  );

  assert.equal(vimBufferText(countedDelete), " three");
  assert.equal(vimBufferText(countedChange), " three");
  assert.equal(vimBufferText(countedYank), countedText);
  assert.deepEqual(countedDelete.register, { kind: "character", text: "one  two" });
  assert.deepEqual(countedChange.register, countedDelete.register);
  assert.deepEqual(countedYank.register, countedDelete.register);
  assert.equal(countedDelete.mode.kind, "normal");
  assert.equal(countedChange.mode.kind, "insert");
  assert.equal(countedYank.mode.kind, "normal");
  assert.deepEqual(countedDelete.status, { kind: "none" });
  assert.deepEqual(countedChange.status, { kind: "none" });
  assert.deepEqual(countedYank.status, { kind: "none" });

  const countedWORDText = "one\n\ntwo three";
  const countedWORDDelete = press(
    createVimBuffer({ text: countedWORDText, mode: VimMode.Normal }),
    "2", "d", "i", "W",
  );
  const countedWORDChange = press(
    createVimBuffer({ text: countedWORDText, mode: VimMode.Normal }),
    "2", "c", "i", "W",
  );
  const countedWORDYank = press(
    createVimBuffer({ text: countedWORDText, mode: VimMode.Normal }),
    "2", "y", "i", "W",
  );

  assert.equal(vimBufferText(countedWORDDelete), " three");
  assert.equal(vimBufferText(countedWORDChange), " three");
  assert.equal(vimBufferText(countedWORDYank), countedWORDText);
  assert.deepEqual(countedWORDDelete.register, { kind: "character", text: "one\n\ntwo" });
  assert.deepEqual(countedWORDChange.register, countedWORDDelete.register);
  assert.deepEqual(countedWORDYank.register, countedWORDDelete.register);
  assert.equal(countedWORDChange.mode.kind, "insert");
  assert.deepEqual(countedWORDDelete.status, { kind: "none" });

  const blankStart = press(
    press(createVimBuffer({ text: "one  two", mode: VimMode.Normal }), "3", "l"),
    "d", "i", "w",
  );
  assert.equal(vimBufferText(blankStart), "onetwo");
  assert.deepEqual(blankStart.register, { kind: "character", text: "  " });

  const countedSurrogate = press(
    createVimBuffer({ text: "😀😀\n\nβeta tail", mode: VimMode.Normal }),
    "2", "y", "i", "W",
  );
  assert.deepEqual(countedSurrogate.register, {
    kind: "character",
    text: "😀😀\n\nβeta",
  });
  assert.deepEqual(countedSurrogate.cursor, { line: 0, column: 0 });
  assert.deepEqual(countedSurrogate.status, { kind: "none" });
});

test("selects sentence and paragraph objects with their fixed separators", () => {
  const sentenceText = "One.  Two!  Three";
  const inner = press(createVimBuffer({ text: sentenceText, mode: VimMode.Normal }), "d", "i", "s");
  const around = press(createVimBuffer({ text: sentenceText, mode: VimMode.Normal }), "d", "a", "s");

  assert.equal(vimBufferText(inner), "  Two!  Three");
  assert.equal(vimBufferText(around), "Two!  Three");

  const countedSentenceText = "One.  Two!  Three?  Four";
  const countedSentenceDelete = press(
    createVimBuffer({ text: countedSentenceText, mode: VimMode.Normal }),
    "2", "d", "i", "s",
  );
  const countedSentenceChange = press(
    createVimBuffer({ text: countedSentenceText, mode: VimMode.Normal }),
    "2", "c", "i", "s",
  );
  const countedSentenceYank = press(
    createVimBuffer({ text: countedSentenceText, mode: VimMode.Normal }),
    "2", "y", "i", "s",
  );

  assert.equal(vimBufferText(countedSentenceDelete), "  Three?  Four");
  assert.equal(vimBufferText(countedSentenceChange), "  Three?  Four");
  assert.equal(vimBufferText(countedSentenceYank), countedSentenceText);
  assert.deepEqual(countedSentenceDelete.register, {
    kind: "character",
    text: "One.  Two!",
  });
  assert.deepEqual(countedSentenceChange.register, countedSentenceDelete.register);
  assert.deepEqual(countedSentenceYank.register, countedSentenceDelete.register);
  assert.equal(countedSentenceDelete.mode.kind, "normal");
  assert.equal(countedSentenceChange.mode.kind, "insert");
  assert.equal(countedSentenceYank.mode.kind, "normal");
  assert.deepEqual(countedSentenceDelete.status, { kind: "none" });

  const paragraphText = "one\nline\n   \ntwo\n\nthree";
  const innerParagraph = press(
    createVimBuffer({ text: paragraphText, mode: VimMode.Normal }),
    "d", "i", "p",
  );
  const aroundParagraph = press(
    createVimBuffer({ text: paragraphText, mode: VimMode.Normal }),
    "d", "a", "p",
  );

  assert.equal(vimBufferText(innerParagraph), "   \ntwo\n\nthree");
  assert.equal(vimBufferText(aroundParagraph), "two\n\nthree");
  assert.deepEqual(aroundParagraph.register, { kind: "line", lines: ["one", "line", "   "] });

  const countedParagraphText = "one\nline\n\ntwo\nline\n\nthree";
  const countedParagraphDelete = press(
    createVimBuffer({ text: countedParagraphText, mode: VimMode.Normal }),
    "2", "d", "i", "p",
  );
  const countedParagraphChange = press(
    createVimBuffer({ text: countedParagraphText, mode: VimMode.Normal }),
    "2", "c", "i", "p",
  );
  const countedParagraphYank = press(
    createVimBuffer({ text: countedParagraphText, mode: VimMode.Normal }),
    "2", "y", "i", "p",
  );
  const countedParagraphRegister: VimRegister = {
    kind: "line",
    lines: ["one", "line", "", "two", "line"],
  };

  assert.equal(vimBufferText(countedParagraphDelete), "\nthree");
  assert.equal(vimBufferText(countedParagraphChange), "\nthree");
  assert.equal(vimBufferText(countedParagraphYank), countedParagraphText);
  assert.deepEqual(countedParagraphDelete.register, countedParagraphRegister);
  assert.deepEqual(countedParagraphChange.register, countedParagraphRegister);
  assert.deepEqual(countedParagraphYank.register, countedParagraphRegister);
  assert.equal(countedParagraphDelete.mode.kind, "normal");
  assert.equal(countedParagraphChange.mode.kind, "insert");
  assert.equal(countedParagraphYank.mode.kind, "normal");
  assert.deepEqual(countedParagraphYank.status, { kind: "none" });
});

test("handles quote objects, documented quote counts, and odd backslash escapes", () => {
  const text = "pre  \"a\\\"b\"  post";
  const cursor = press(createVimBuffer({ text, mode: VimMode.Normal }), "6", "l");
  const inner = press(cursor, "d", "i", "\"");
  const around = press(cursor, "2", "d", "a", "\"");
  const innerTwo = press(cursor, "2", "d", "i", "\"");
  const changed = press(cursor, "c", "a", "\"");
  const yanked = press(cursor, "y", "a", "\"");

  assert.equal(vimBufferText(inner), "pre  \"\"  post");
  assert.equal(vimBufferText(around), "pre  post");
  assert.equal(vimBufferText(innerTwo), "pre    post");
  assert.equal(vimBufferText(changed), "pre  post");
  assert.equal(vimBufferText(yanked), text);
  assert.deepEqual(around.register, { kind: "character", text: "\"a\\\"b\"  " });
  assert.deepEqual(changed.register, around.register);
  assert.deepEqual(yanked.register, around.register);
  assert.equal(around.mode.kind, "normal");
  assert.equal(changed.mode.kind, "insert");
  assert.equal(yanked.mode.kind, "normal");
  assert.deepEqual(changed.status, { kind: "none" });

  const singles = press(
    press(createVimBuffer({ text: "x 'y' `z`", mode: VimMode.Normal }), "3", "l"),
    "y", "a", "'",
  );
  const backticks = press(
    press(createVimBuffer({ text: "x 'y' `z`", mode: VimMode.Normal }), "7", "l"),
    "y", "i", "`",
  );
  assert.deepEqual(singles.register, { kind: "character", text: "'y' " });
  assert.deepEqual(backticks.register, { kind: "character", text: "z" });

  const escapedQuotes: ReadonlyArray<Readonly<{
    text: string;
    object: "'" | "`";
    inner: string;
    delimited: string;
  }>> = [
    {
      text: "pre 'a\\'b'  post",
      object: "'",
      inner: "a\\'b",
      delimited: "'a\\'b'",
    },
    {
      text: "pre `a\\`b`  post",
      object: "`",
      inner: "a\\`b",
      delimited: "`a\\`b`",
    },
  ];

  for (const fixture of escapedQuotes) {
    const inside = press(
      createVimBuffer({ text: fixture.text, mode: VimMode.Normal }),
      "6", "l",
    );
    const escapedInner = press(inside, "y", "i", fixture.object);
    const countedInner = press(inside, "2", "d", "i", fixture.object);
    const aroundOnce = press(inside, "y", "a", fixture.object);
    const aroundCounted = press(inside, "2", "y", "a", fixture.object);

    assert.deepEqual(escapedInner.register, {
      kind: "character",
      text: fixture.inner,
    });
    assert.deepEqual(countedInner.register, {
      kind: "character",
      text: fixture.delimited,
    });
    assert.equal(vimBufferText(countedInner), "pre   post");
    assert.deepEqual(aroundOnce.register, {
      kind: "character",
      text: fixture.delimited + "  ",
    });
    assert.deepEqual(aroundCounted.register, aroundOnce.register);
    assert.deepEqual(aroundCounted.status, { kind: "none" });
  }

  const empty = press(createVimBuffer({ text: "\"\"", mode: VimMode.Normal }), "d", "i", "\"");
  assert.deepEqual(empty.status, { kind: "invalid-input", source: "di\"" });
});

test("resolves nested escaped delimiter objects and every standard alias", () => {
  const nested = press(createVimBuffer({ text: "(a(b)c) tail", mode: VimMode.Normal }), "3", "l");
  const inner = press(nested, "d", "i", "b");
  const outer = press(nested, "2", "d", "a", ")");

  assert.equal(vimBufferText(inner), "(a()c) tail");
  assert.equal(vimBufferText(outer), " tail");

  const delimiterText = "(x) tail";
  const delimiterCursor = press(
    createVimBuffer({ text: delimiterText, mode: VimMode.Normal }),
    "l",
  );
  const delimiterDelete = press(delimiterCursor, "d", "a", "b");
  const delimiterChange = press(delimiterCursor, "c", "a", "b");
  const delimiterYank = press(delimiterCursor, "y", "a", "b");

  assert.equal(vimBufferText(delimiterDelete), " tail");
  assert.equal(vimBufferText(delimiterChange), " tail");
  assert.equal(vimBufferText(delimiterYank), delimiterText);
  assert.deepEqual(delimiterDelete.register, { kind: "character", text: "(x)" });
  assert.deepEqual(delimiterChange.register, delimiterDelete.register);
  assert.deepEqual(delimiterYank.register, delimiterDelete.register);
  assert.equal(delimiterDelete.mode.kind, "normal");
  assert.equal(delimiterChange.mode.kind, "insert");
  assert.equal(delimiterYank.mode.kind, "normal");
  assert.deepEqual(delimiterYank.status, { kind: "none" });

  const cases: ReadonlyArray<Readonly<{ text: string; object: string; expected: string }>> = [
    { text: "[x]", object: "[", expected: "[]" },
    { text: "[x]", object: "]", expected: "[]" },
    { text: "(x)", object: "(", expected: "()" },
    { text: "(x)", object: ")", expected: "()" },
    { text: "(x)", object: "b", expected: "()" },
    { text: "{x}", object: "{", expected: "{}" },
    { text: "{x}", object: "}", expected: "{}" },
    { text: "{x}", object: "B", expected: "{}" },
    { text: "<x>", object: "<", expected: "<>" },
    { text: "<x>", object: ">", expected: "<>" },
  ];

  for (const fixture of cases) {
    const result = press(createVimBuffer({ text: fixture.text, mode: VimMode.Normal }), "l", "d", "i", fixture.object);
    assert.equal(vimBufferText(result), fixture.expected);
  }

  assert.equal(
    vimBufferText(press(createVimBuffer({ text: "(x)tail", mode: VimMode.Normal }), "l", "d", "a", "b")),
    "tail",
  );
  assert.equal(
    vimBufferText(press(createVimBuffer({ text: "{x}tail", mode: VimMode.Normal }), "l", "d", "a", "B")),
    "tail",
  );

  const escaped = press(
    press(createVimBuffer({ text: "(a\\)b) tail", mode: VimMode.Normal }), "l"),
    "d", "i", "(",
  );
  assert.equal(vimBufferText(escaped), "() tail");
  assert.deepEqual(press(createVimBuffer({ text: "(unmatched", mode: VimMode.Normal }), "d", "i", "(").status, {
    kind: "invalid-input",
    source: "di(",
  });
  assert.deepEqual(
    press(createVimBuffer({ text: "([)]", mode: VimMode.Normal }), "d", "i", "(").status,
    { kind: "invalid-input", source: "di(" },
  );
});

test("uses the fixed tolerant case-insensitive tag object profile", () => {
  const text = "<A data-x='>'><b>hi</b><br/><!--x--></a> tail";
  const insideOuter = press(createVimBuffer({ text, mode: VimMode.Normal }), "2", "l");
  const inner = press(insideOuter, "d", "i", "t");
  const around = press(insideOuter, "d", "a", "t");
  const changed = press(insideOuter, "c", "a", "t");
  const yanked = press(insideOuter, "y", "a", "t");

  assert.equal(vimBufferText(inner), "<A data-x='>'></a> tail");
  assert.equal(vimBufferText(around), " tail");
  assert.equal(vimBufferText(changed), " tail");
  assert.equal(vimBufferText(yanked), text);
  assert.deepEqual(around.register, {
    kind: "character",
    text: "<A data-x='>'><b>hi</b><br/><!--x--></a>",
  });
  assert.deepEqual(changed.register, around.register);
  assert.deepEqual(yanked.register, around.register);
  assert.equal(around.mode.kind, "normal");
  assert.equal(changed.mode.kind, "insert");
  assert.equal(yanked.mode.kind, "normal");
  assert.deepEqual(yanked.status, { kind: "none" });

  const nested = press(
    press(createVimBuffer({ text: "<a><b>x</b></a>", mode: VimMode.Normal }), "7", "l"),
    "2", "y", "a", "t",
  );
  assert.deepEqual(nested.register, { kind: "character", text: "<a><b>x</b></a>" });

  const empty = press(createVimBuffer({ text: "<x></x>", mode: VimMode.Normal }), "d", "i", "t");
  assert.equal(vimBufferText(empty), "</x>");
  assert.deepEqual(empty.register, { kind: "character", text: "<x>" });

  const malformed = press(
    createVimBuffer({ text: "</stray><open <bad><x>ok</x>", mode: VimMode.Normal }),
    "d", "a", "t",
  );
  assert.deepEqual(malformed.status, { kind: "invalid-input", source: "dat" });
  assert.deepEqual(
    press(createVimBuffer({ text: "<a><b></a></b>", mode: VimMode.Normal }), "d", "a", "t").status,
    { kind: "invalid-input", source: "dat" },
  );

  const incompletePrefixes = [
    "<!-- unfinished ",
    "<!unfinished ",
    "<?unfinished ",
    "<broken value=' ",
  ];

  for (const prefix of incompletePrefixes) {
    const recoverableText = prefix + "<a><x>ok</x></a>";
    const cursorColumn = recoverableText.lastIndexOf("ok");
    const recovered = press(
      press(
        createVimBuffer({ text: recoverableText, mode: VimMode.Normal }),
        ...Array.from("l".repeat(cursorColumn)),
      ),
      "2", "y", "a", "t",
    );

    assert.equal(vimBufferText(recovered), recoverableText);
    assert.deepEqual(recovered.register, {
      kind: "character",
      text: "<a><x>ok</x></a>",
    });
    assert.deepEqual(recovered.status, { kind: "none" });
  }

  const malformedAfterText = "<x>ok</x><broken value=' <tail";
  const malformedAfter = press(
    press(
      createVimBuffer({ text: malformedAfterText, mode: VimMode.Normal }),
      "l", "l", "l",
    ),
    "y", "a", "t",
  );
  assert.deepEqual(malformedAfter.register, {
    kind: "character",
    text: "<x>ok</x>",
  });
  assert.deepEqual(malformedAfter.status, { kind: "none" });
});

test("keeps structural visual movement linewise and defers characterwise object adoption", () => {
  const selected = press(
    createVimBuffer({ text: "One.  Two\n\nThree", mode: VimMode.Normal }),
    "V", ")",
  );

  assert.deepEqual(selected.selection, {
    kind: "line",
    anchorLine: 0,
    activeLine: 0,
  });

  const objectOutsideOperator = press(
    createVimBuffer({ text: "word", mode: VimMode.Normal }),
    "i", "w",
  );
  assert.equal(objectOutsideOperator.mode.kind, "insert");
});
