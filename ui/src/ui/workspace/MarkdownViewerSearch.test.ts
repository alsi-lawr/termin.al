import assert from "node:assert/strict";
import test from "node:test";
import {
  beginMarkdownViewerSearch,
  createMarkdownViewerSearch,
  cycleMarkdownViewerSearch,
  markdownViewerSearchStatus,
  submitMarkdownViewerSearch,
  updateMarkdownViewerSearch,
} from "./MarkdownViewerSearch.ts";

test("submits search and cycles n/N through logical block matches", () => {
  const editing = updateMarkdownViewerSearch(" term ");
  const submitted = submitMarkdownViewerSearch(editing, [1, 4, 7]);
  const next = cycleMarkdownViewerSearch(submitted.search, [1, 4, 7], 1);
  const previous = cycleMarkdownViewerSearch(next.search, [1, 4, 7], -1);
  const wrapped = cycleMarkdownViewerSearch(previous.search, [1, 4, 7], -1);

  assert.deepEqual(submitted, {
    search: { kind: "active", query: "term", matchIndex: 0 },
    matchedBlockIndex: 1,
  });
  assert.equal(next.matchedBlockIndex, 4);
  assert.equal(previous.matchedBlockIndex, 1);
  assert.equal(wrapped.matchedBlockIndex, 7);
  assert.deepEqual(markdownViewerSearchStatus(wrapped.search, 3), {
    mode: "SEARCH",
    match: "/term 3/3",
  });
});

test("supports repeated slash search and explicit cancellation", () => {
  const active = submitMarkdownViewerSearch(
    updateMarkdownViewerSearch("first"),
    [2],
  ).search;
  const repeated = beginMarkdownViewerSearch();
  const cancelled = createMarkdownViewerSearch();

  assert.equal(active.kind, "active");
  assert.deepEqual(repeated, { kind: "editing", query: "" });
  assert.deepEqual(cancelled, { kind: "idle" });
  assert.deepEqual(markdownViewerSearchStatus(cancelled, 0), {
    mode: "NORMAL",
    match: "No search",
  });
});

test("reports no matches and treats an empty submission as normal mode", () => {
  const noMatches = submitMarkdownViewerSearch(
    updateMarkdownViewerSearch("missing"),
    [],
  );
  const empty = submitMarkdownViewerSearch(
    updateMarkdownViewerSearch("  "),
    [],
  );

  assert.deepEqual(markdownViewerSearchStatus(noMatches.search, 0), {
    mode: "SEARCH",
    match: "No matches for missing",
  });
  assert.deepEqual(empty.search, { kind: "idle" });
});
