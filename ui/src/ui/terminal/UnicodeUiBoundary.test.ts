import assert from "node:assert/strict";
import test from "node:test";
import {
  moveNativeInputSelectionLeft,
  moveNativeInputSelectionRight,
  normalizeNativeInputSelection,
  segmentVisibleInputRow,
} from "./UnicodeUiBoundary.ts";

test("segments the complete astral code point beneath the visible cursor", () => {
  const segments = segmentVisibleInputRow("a😀b", 1);

  assert.deepEqual(segments, {
    beforeCursor: "a",
    cursor: "😀",
    afterCursor: "b",
  });
});

test("normalizes an interior native selection offset backward", () => {
  assert.equal(normalizeNativeInputSelection("a😀b", 2), 1);
});

test("moves native selections across astral code points", () => {
  const value = "a😀b";

  assert.equal(moveNativeInputSelectionLeft(value, 3), 1);
  assert.equal(moveNativeInputSelectionLeft(value, 2), 0);
  assert.equal(moveNativeInputSelectionRight(value, 1), 3);
  assert.equal(moveNativeInputSelectionRight(value, 2), 3);
});

test("handles BMP and end-of-line input boundaries", () => {
  assert.deepEqual(segmentVisibleInputRow("ab", 1), {
    beforeCursor: "a",
    cursor: "b",
    afterCursor: "",
  });
  assert.deepEqual(segmentVisibleInputRow("ab", 2), {
    beforeCursor: "ab",
    cursor: "",
    afterCursor: "",
  });
  assert.equal(normalizeNativeInputSelection("ab", 2), 2);
  assert.equal(moveNativeInputSelectionLeft("ab", 2), 1);
  assert.equal(moveNativeInputSelectionRight("ab", 2), 2);
});
