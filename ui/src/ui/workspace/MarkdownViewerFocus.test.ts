import assert from "node:assert/strict";
import test from "node:test";
import { restoreMarkdownViewerFocus } from "./MarkdownViewerFocus.ts";

test("restores viewer focus without moving the document", () => {
  const receivedOptions: Array<FocusOptions> = [];

  restoreMarkdownViewerFocus({
    focus: (options) => {
      receivedOptions.push(options);
    },
  });

  assert.deepEqual(receivedOptions, [{ preventScroll: true }]);
});

test("accepts a missing viewer during teardown", () => {
  restoreMarkdownViewerFocus(null);
});
