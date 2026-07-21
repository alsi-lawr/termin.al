import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownViewerSearchForm } from "./MarkdownViewerSearchForm.tsx";

test("keeps the search input native and the Find action mobile-only", () => {
  const markup = renderToStaticMarkup(
    MarkdownViewerSearchForm({
      inputRef: { current: null },
      query: "terminal",
      onQueryChange: () => undefined,
      onSubmit: () => undefined,
      onCancel: () => undefined,
    }),
  );

  assert.equal(markup.startsWith("<form"), true);
  assert.equal(markup.includes('type="search"'), true);
  assert.equal(markup.includes('aria-label="Search Markdown"'), true);
  assert.equal(markup.includes('type="submit"'), true);
  assert.equal(markup.includes("Find"), true);
  assert.equal(markup.includes("md:hidden"), true);
});
