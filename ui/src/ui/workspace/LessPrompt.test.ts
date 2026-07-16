import assert from "node:assert/strict";
import test from "node:test";
import {
  applyRawPagerOperation,
  createRawPagerState,
  rawPagerStatus,
  type RawPagerState,
} from "../../domain/viewer/RawPager.ts";
import { lessPrompt } from "./LessPrompt.ts";

function updatedState(
  state: RawPagerState,
  operation: Readonly<{ kind: "end" }>,
): RawPagerState {
  const transition = applyRawPagerOperation(state, operation);

  if (transition.kind !== "updated") {
    assert.fail("Expected a raw pager state update.");
  }

  return transition.state;
}

test("derives exact empty, percentage, middle, and end prompts", () => {
  assert.equal(lessPrompt("notes.txt", { kind: "empty" }), "notes.txt (END)");
  assert.equal(
    lessPrompt("notes.txt", {
      kind: "range",
      firstLine: 1,
      lastLine: 3,
      currentLine: 1,
      totalLines: 5,
    }),
    "notes.txt 60%",
  );
  assert.equal(
    lessPrompt("notes.txt", {
      kind: "range",
      firstLine: 3,
      lastLine: 5,
      currentLine: 3,
      totalLines: 10,
    }),
    "notes.txt 50%",
  );
  assert.equal(
    lessPrompt("notes.txt", {
      kind: "range",
      firstLine: 8,
      lastLine: 10,
      currentLine: 10,
      totalLines: 10,
    }),
    "notes.txt (END)",
  );
});

test("uses existing trailing-newline chunks for pre-end and end prompts", () => {
  const text = "a\nb\nc\nd\n";
  const start = createRawPagerState(text, 3);
  const end = updatedState(start, { kind: "end" });

  assert.equal(lessPrompt("trail.txt", rawPagerStatus(start)), "trail.txt 75%");
  assert.equal(lessPrompt("trail.txt", rawPagerStatus(end)), "trail.txt (END)");
});

test("treats an initially visible short document as end-of-file", () => {
  const state = createRawPagerState("one\ntwo");

  assert.equal(lessPrompt("short.txt", rawPagerStatus(state)), "short.txt (END)");
});
