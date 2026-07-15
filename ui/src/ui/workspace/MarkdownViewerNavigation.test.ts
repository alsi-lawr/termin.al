import assert from "node:assert/strict";
import test from "node:test";
import { markdownViewerOperationFromKey } from "./MarkdownViewerNavigation.ts";

test("maps Vim navigation and search keys for Markdown viewers", () => {
  assert.deepEqual(
    markdownViewerOperationFromKey({ key: "j", ctrlKey: false, metaKey: false }),
    { kind: "handled", operation: { kind: "line-down" } },
  );
  assert.deepEqual(
    markdownViewerOperationFromKey({ key: "G", ctrlKey: false, metaKey: false }),
    { kind: "handled", operation: { kind: "bottom" } },
  );
  assert.deepEqual(
    markdownViewerOperationFromKey({ key: "/", ctrlKey: false, metaKey: false }),
    { kind: "handled", operation: { kind: "search" } },
  );
  assert.deepEqual(
    markdownViewerOperationFromKey({ key: "n", ctrlKey: false, metaKey: false }),
    { kind: "handled", operation: { kind: "search-next" } },
  );
  assert.deepEqual(
    markdownViewerOperationFromKey({ key: "u", ctrlKey: true, metaKey: false }),
    { kind: "handled", operation: { kind: "page-up" } },
  );
  assert.deepEqual(
    markdownViewerOperationFromKey({ key: "q", ctrlKey: false, metaKey: false }),
    { kind: "ignored" },
  );
});
