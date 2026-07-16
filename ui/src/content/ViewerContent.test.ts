import assert from "node:assert/strict";
import test from "node:test";
import { ContentId } from "../api/ContentContracts.ts";
import {
  countableViewerContentIds,
  createDocumentViewerContent,
} from "./ViewerContent.ts";

function contentId(value: string): ContentId {
  const validation = ContentId.tryCreate(value, "viewer test content");

  if (validation.kind === "invalid") {
    assert.fail(validation.message);
  }

  return validation.value;
}

test("carries required countable and uncounted viewer statistics identity", () => {
  const aboutId = contentId("about");
  const countable = createDocumentViewerContent({
    title: "About",
    presentation: "inline",
    document: { text: "# About", source: { path: "~/about.md" } },
    statsIdentity: { kind: "countable", contentId: aboutId },
  });
  const uncounted = createDocumentViewerContent({
    title: "Synthetic",
    presentation: "raw-pager",
    document: { text: "synthetic", source: { path: "synthetic" } },
    statsIdentity: { kind: "uncounted" },
  });

  if (countable.kind !== "document" || uncounted.kind !== "document") {
    assert.fail("Expected document viewers.");
  }

  assert.deepEqual(countableViewerContentIds(countable.statsIdentity), [aboutId]);
  assert.deepEqual(countableViewerContentIds(uncounted.statsIdentity), []);
});
