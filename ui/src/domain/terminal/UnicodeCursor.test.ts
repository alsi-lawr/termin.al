import assert from "node:assert/strict";
import test from "node:test";
import {
  nextUnicodeCursorOffset,
  normalizeUnicodeCursorOffset,
  previousUnicodeCursorOffset,
} from "./UnicodeCursor.ts";

test("normalizes UTF-16 offsets to Unicode code-point boundaries", () => {
  const value = "a😀b";

  assert.equal(normalizeUnicodeCursorOffset(value, -1), 0);
  assert.equal(normalizeUnicodeCursorOffset(value, 0), 0);
  assert.equal(normalizeUnicodeCursorOffset(value, 1), 1);
  assert.equal(normalizeUnicodeCursorOffset(value, 2), 1);
  assert.equal(normalizeUnicodeCursorOffset(value, 3), 3);
  assert.equal(normalizeUnicodeCursorOffset(value, 4), 4);
  assert.equal(normalizeUnicodeCursorOffset(value, 9), 4);
});

test("moves across BMP, astral, and malformed surrogate input", () => {
  const value = "a😀b";

  assert.equal(previousUnicodeCursorOffset(value, 0), 0);
  assert.equal(previousUnicodeCursorOffset(value, 1), 0);
  assert.equal(previousUnicodeCursorOffset(value, 3), 1);
  assert.equal(previousUnicodeCursorOffset(value, 4), 3);
  assert.equal(nextUnicodeCursorOffset(value, 0), 1);
  assert.equal(nextUnicodeCursorOffset(value, 1), 3);
  assert.equal(nextUnicodeCursorOffset(value, 3), 4);
  assert.equal(nextUnicodeCursorOffset(value, 4), 4);

  const malformed = "\ud83da\ude00";

  assert.equal(normalizeUnicodeCursorOffset(malformed, 1), 1);
  assert.equal(normalizeUnicodeCursorOffset(malformed, 2), 2);
  assert.equal(nextUnicodeCursorOffset(malformed, 0), 1);
  assert.equal(nextUnicodeCursorOffset(malformed, 1), 2);
  assert.equal(previousUnicodeCursorOffset(malformed, 3), 2);
});
