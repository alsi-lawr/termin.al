import assert from "node:assert/strict";
import test from "node:test";
import {
  applyRawPagerOperation,
  createRawPagerState,
  rawPagerOperationFromKey,
  rawPagerPageText,
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
  assert.equal(rawPagerPageText("", state), "");

  for (const operation of operations) {
    const updated = updatedState(state, operation);
    assert.deepEqual(rawPagerStatus(updated), { kind: "empty" });
    assert.equal(rawPagerPageText("", updated), "");
  }
});

test("reports all short document lines in its visible range", () => {
  const text = "one\ntwo";
  const state = createRawPagerState(text);

  assert.deepEqual(rawPagerStatus(state), {
    kind: "range",
    firstLine: 1,
    lastLine: 2,
    totalLines: 2,
  });
  assert.equal(rawPagerPageText(text, state), text);
});

test("moves by line and page while clamping multi-page bounds", () => {
  const text = "one\ntwo\nthree\nfour\nfive";
  const start = createRawPagerState(text, 3);
  const lineDown = updatedState(start, { kind: "line-down" });
  const atEnd = updatedState(start, { kind: "page-forward" });
  const clampedEnd = updatedState(atEnd, { kind: "page-forward" });
  const back = updatedState(atEnd, { kind: "page-back" });
  const clampedStart = updatedState(back, { kind: "line-up" });

  assert.deepEqual(rawPagerStatus(start), {
    kind: "range",
    firstLine: 1,
    lastLine: 3,
    totalLines: 5,
  });
  assert.deepEqual(rawPagerStatus(lineDown), {
    kind: "range",
    firstLine: 2,
    lastLine: 4,
    totalLines: 5,
  });
  assert.deepEqual(rawPagerStatus(atEnd), {
    kind: "range",
    firstLine: 3,
    lastLine: 5,
    totalLines: 5,
  });
  assert.deepEqual(rawPagerStatus(clampedEnd), rawPagerStatus(atEnd));
  assert.deepEqual(rawPagerStatus(back), rawPagerStatus(start));
  assert.deepEqual(rawPagerStatus(clampedStart), rawPagerStatus(back));
  assert.equal(rawPagerPageText(text, atEnd), "three\nfour\nfive");
});

test("moves directly to start and end without mutating prior state", () => {
  const start = createRawPagerState("one\ntwo\nthree\nfour\nfive", 2);
  const end = updatedState(start, { kind: "end" });
  const returned = updatedState(end, { kind: "start" });

  assert.deepEqual(rawPagerStatus(start), {
    kind: "range",
    firstLine: 1,
    lastLine: 2,
    totalLines: 5,
  });
  assert.deepEqual(rawPagerStatus(end), {
    kind: "range",
    firstLine: 4,
    lastLine: 5,
    totalLines: 5,
  });
  assert.deepEqual(rawPagerStatus(returned), rawPagerStatus(start));
  assert.equal(rawPagerPageText("one\ntwo\nthree\nfour\nfive", end), "four\nfive");
});

test("preserves raw line endings in visible page text", () => {
  const text = "one\r\ntwo\n\n";
  const state = createRawPagerState(text);

  assert.equal(rawPagerPageText(text, state), text);
});

test("returns an explicit quit transition", () => {
  const state = createRawPagerState("one");

  assert.deepEqual(applyRawPagerOperation(state, { kind: "quit" }), {
    kind: "quit",
  });
});

test("maps practical pager keys to typed operations", () => {
  const mappings: ReadonlyArray<readonly [string, RawPagerOperation]> = [
    ["ArrowUp", { kind: "line-up" }],
    ["k", { kind: "line-up" }],
    ["ArrowDown", { kind: "line-down" }],
    ["j", { kind: "line-down" }],
    ["PageDown", { kind: "page-forward" }],
    [" ", { kind: "page-forward" }],
    ["PageUp", { kind: "page-back" }],
    ["b", { kind: "page-back" }],
    ["g", { kind: "start" }],
    ["G", { kind: "end" }],
    ["Escape", { kind: "quit" }],
    ["q", { kind: "quit" }],
  ];

  for (const [key, operation] of mappings) {
    assert.deepEqual(rawPagerOperationFromKey({
      key,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
    }), { kind: "operation", operation });
  }
});

test("ignores modified and unrelated keys so pane prefixes remain authoritative", () => {
  assert.deepEqual(rawPagerOperationFromKey({
    key: "b",
    altKey: false,
    ctrlKey: true,
    metaKey: false,
  }), { kind: "ignored" });
  assert.deepEqual(rawPagerOperationFromKey({
    key: "q",
    altKey: false,
    ctrlKey: false,
    metaKey: true,
  }), { kind: "ignored" });
  assert.deepEqual(rawPagerOperationFromKey({
    key: "ArrowDown",
    altKey: true,
    ctrlKey: false,
    metaKey: false,
  }), { kind: "ignored" });
  assert.deepEqual(rawPagerOperationFromKey({
    key: "x",
    altKey: false,
    ctrlKey: false,
    metaKey: false,
  }), { kind: "ignored" });
});
