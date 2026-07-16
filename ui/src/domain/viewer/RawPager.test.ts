import assert from "node:assert/strict";
import test from "node:test";
import {
  applyRawPagerOperation,
  createRawPagerState,
  rawPagerOperationFromKey,
  rawPagerPageLines,
  rawPagerStatus,
  type RawPagerOperation,
  type RawPagerState,
} from "./RawPager.ts";

function updatedState(
  state: RawPagerState,
  operation: RawPagerOperation,
): RawPagerState {
  const transition = applyRawPagerOperation(state, operation);

  if (transition.kind !== "updated") {
    assert.fail("Expected a raw pager state update.");
  }

  return transition.state;
}

test("clamps every movement and reports an empty document", () => {
  const state = createRawPagerState("");
  const operations: ReadonlyArray<RawPagerOperation> = [
    { kind: "line-up" },
    { kind: "line-down" },
    { kind: "page-back" },
    { kind: "page-forward" },
    { kind: "start" },
    { kind: "end" },
  ];

  assert.deepEqual(rawPagerStatus(state), { kind: "empty" });
  assert.deepEqual(rawPagerPageLines("", state), []);

  for (const operation of operations) {
    const updated = updatedState(state, operation);
    assert.deepEqual(rawPagerStatus(updated), { kind: "empty" });
    assert.deepEqual(rawPagerPageLines("", updated), []);
  }
});

test("reports a visible logical cursor in short documents", () => {
  const text = "one\ntwo";
  const state = createRawPagerState(text);

  assert.deepEqual(rawPagerStatus(state), {
    kind: "range",
    firstLine: 1,
    lastLine: 2,
    currentLine: 1,
    totalLines: 2,
  });
  assert.deepEqual(rawPagerPageLines(text, state), [
    { lineNumber: 1, text: "one\n", isCurrent: true },
    { lineNumber: 2, text: "two", isCurrent: false },
  ]);
});

test("moves the logical cursor by line and page while clamping bounds", () => {
  const text = "one\ntwo\nthree\nfour\nfive";
  const start = createRawPagerState(text, 3);
  const lineDown = updatedState(start, { kind: "line-down" });
  const pageForward = updatedState(start, { kind: "page-forward" });
  const clampedEnd = updatedState(pageForward, { kind: "page-forward" });
  const pageBack = updatedState(clampedEnd, { kind: "page-back" });
  const clampedStart = updatedState(pageBack, { kind: "page-back" });

  assert.equal(rawPagerStatus(start).kind, "range");
  assert.deepEqual(rawPagerStatus(lineDown), {
    kind: "range",
    firstLine: 1,
    lastLine: 3,
    currentLine: 2,
    totalLines: 5,
  });
  assert.deepEqual(rawPagerStatus(pageForward), {
    kind: "range",
    firstLine: 3,
    lastLine: 5,
    currentLine: 4,
    totalLines: 5,
  });
  assert.deepEqual(rawPagerStatus(clampedEnd), {
    kind: "range",
    firstLine: 3,
    lastLine: 5,
    currentLine: 5,
    totalLines: 5,
  });
  assert.deepEqual(rawPagerStatus(clampedStart), rawPagerStatus(start));
});

test("moves directly to document start and end without mutating prior state", () => {
  const text = "one\ntwo\nthree\nfour\nfive";
  const start = createRawPagerState(text, 2);
  const end = updatedState(start, { kind: "end" });
  const returned = updatedState(end, { kind: "start" });

  assert.deepEqual(rawPagerStatus(start), {
    kind: "range",
    firstLine: 1,
    lastLine: 2,
    currentLine: 1,
    totalLines: 5,
  });
  assert.deepEqual(rawPagerStatus(end), {
    kind: "range",
    firstLine: 4,
    lastLine: 5,
    currentLine: 5,
    totalLines: 5,
  });
  assert.deepEqual(rawPagerStatus(returned), rawPagerStatus(start));
});

test("preserves raw line endings in visible page lines", () => {
  const text = "one\r\ntwo\n\n";
  const state = createRawPagerState(text);

  assert.equal(
    rawPagerPageLines(text, state).map((line) => line.text).join(""),
    text,
  );
});

test("returns an explicit quit transition", () => {
  const state = createRawPagerState("one");

  assert.deepEqual(applyRawPagerOperation(state, { kind: "quit" }), {
    kind: "quit",
  });
});

test("maps practical pager keys including Ctrl+f page-forward", () => {
  const mappings: ReadonlyArray<readonly [string, boolean, RawPagerOperation]> = [
    ["ArrowUp", false, { kind: "line-up" }],
    ["k", false, { kind: "line-up" }],
    ["ArrowDown", false, { kind: "line-down" }],
    ["j", false, { kind: "line-down" }],
    ["PageDown", false, { kind: "page-forward" }],
    [" ", false, { kind: "page-forward" }],
    ["f", true, { kind: "page-forward" }],
    ["PageUp", false, { kind: "page-back" }],
    ["b", false, { kind: "page-back" }],
    ["g", false, { kind: "start" }],
    ["G", false, { kind: "end" }],
    ["Escape", false, { kind: "quit" }],
    ["q", false, { kind: "quit" }],
  ];

  for (const [key, ctrlKey, operation] of mappings) {
    assert.deepEqual(rawPagerOperationFromKey({
      key,
      altKey: false,
      ctrlKey,
      metaKey: false,
    }), { kind: "operation", operation });
  }
});

test("ignores modified and unrelated keys so pane prefixes remain authoritative", () => {
  const inputs = [
    { key: "b", altKey: false, ctrlKey: true, metaKey: false },
    { key: "q", altKey: false, ctrlKey: false, metaKey: true },
    { key: "ArrowDown", altKey: true, ctrlKey: false, metaKey: false },
    { key: "x", altKey: false, ctrlKey: false, metaKey: false },
  ];

  for (const input of inputs) {
    assert.deepEqual(rawPagerOperationFromKey(input), { kind: "ignored" });
  }
});
