import assert from "node:assert/strict";
import test from "node:test";
import {
  createMarkdownViewerPosition,
  markdownViewerOperationFromKey,
  markdownViewerPositionStatus,
  moveMarkdownViewerPosition,
  setMarkdownViewerPosition,
  type MarkdownViewerMotion,
  type MarkdownViewerPosition,
} from "./MarkdownViewerNavigation.ts";

function move(
  position: MarkdownViewerPosition,
  motion: MarkdownViewerMotion,
  pageBlockCount = 3,
): MarkdownViewerPosition {
  return moveMarkdownViewerPosition(position, motion, pageBlockCount);
}

test("maps Vim navigation, reusable search, and Ctrl+f page-forward", () => {
  const mappings = [
    [{ key: "j", ctrlKey: false, metaKey: false }, { kind: "line-down" }],
    [{ key: "G", ctrlKey: false, metaKey: false }, { kind: "bottom" }],
    [{ key: "/", ctrlKey: false, metaKey: false }, { kind: "search" }],
    [{ key: "n", ctrlKey: false, metaKey: false }, { kind: "search-next" }],
    [{ key: "N", ctrlKey: false, metaKey: false }, { kind: "search-previous" }],
    [{ key: "u", ctrlKey: true, metaKey: false }, { kind: "page-up" }],
    [{ key: "f", ctrlKey: true, metaKey: false }, { kind: "page-down" }],
  ] as const;

  for (const [input, operation] of mappings) {
    assert.deepEqual(markdownViewerOperationFromKey(input), {
      kind: "handled",
      operation,
    });
  }

  assert.deepEqual(
    markdownViewerOperationFromKey({ key: "b", ctrlKey: true, metaKey: false }),
    { kind: "ignored" },
  );
  assert.deepEqual(
    markdownViewerOperationFromKey({ key: "g", ctrlKey: false, metaKey: false }),
    { kind: "ignored" },
  );
});

test("moves one visible logical position for line, page, and document motions", () => {
  const start = createMarkdownViewerPosition(8);
  const lineDown = move(start, { kind: "line-down" });
  const pageDown = move(lineDown, { kind: "page-down" });
  const bottom = move(pageDown, { kind: "bottom" });
  const pageUp = move(bottom, { kind: "page-up" });
  const top = move(pageUp, { kind: "top" });

  assert.deepEqual(markdownViewerPositionStatus(start), {
    kind: "block",
    currentBlock: 1,
    totalBlocks: 8,
  });
  assert.deepEqual(markdownViewerPositionStatus(lineDown), {
    kind: "block",
    currentBlock: 2,
    totalBlocks: 8,
  });
  assert.deepEqual(markdownViewerPositionStatus(pageDown), {
    kind: "block",
    currentBlock: 5,
    totalBlocks: 8,
  });
  assert.deepEqual(markdownViewerPositionStatus(bottom), {
    kind: "block",
    currentBlock: 8,
    totalBlocks: 8,
  });
  assert.deepEqual(markdownViewerPositionStatus(pageUp), {
    kind: "block",
    currentBlock: 5,
    totalBlocks: 8,
  });
  assert.deepEqual(markdownViewerPositionStatus(top), {
    kind: "block",
    currentBlock: 1,
    totalBlocks: 8,
  });
});

test("moves the logical position to search matches and clamps document bounds", () => {
  const start = createMarkdownViewerPosition(5);
  const matched = setMarkdownViewerPosition(start, 3);
  const afterEnd = setMarkdownViewerPosition(matched, 20);
  const beforeStart = setMarkdownViewerPosition(afterEnd, -4);

  assert.deepEqual(markdownViewerPositionStatus(matched), {
    kind: "block",
    currentBlock: 4,
    totalBlocks: 5,
  });
  assert.deepEqual(markdownViewerPositionStatus(afterEnd), {
    kind: "block",
    currentBlock: 5,
    totalBlocks: 5,
  });
  assert.deepEqual(markdownViewerPositionStatus(beforeStart), {
    kind: "block",
    currentBlock: 1,
    totalBlocks: 5,
  });
  assert.deepEqual(markdownViewerPositionStatus(createMarkdownViewerPosition(0)), {
    kind: "empty",
  });
});
