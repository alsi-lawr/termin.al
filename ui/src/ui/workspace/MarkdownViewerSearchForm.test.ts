import assert from "node:assert/strict";
import test from "node:test";
import { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

function isMarkdownViewerSearchFormModule(
  value: unknown,
): value is Readonly<{
  MarkdownViewerSearchForm: (props: unknown) => unknown;
}> {
  return (
    typeof value === "object" &&
    value !== null &&
    "MarkdownViewerSearchForm" in value &&
    typeof value.MarkdownViewerSearchForm === "function"
  );
}

test("keeps the search input native and the Find action mobile-only", async () => {
  const vite = await createServer({
    appType: "custom",
    server: { middlewareMode: true, hmr: false },
  });

  try {
    const loadedModule: unknown = await vite.ssrLoadModule(
      "/src/ui/workspace/MarkdownViewerSearchForm.tsx",
    );

    if (!isMarkdownViewerSearchFormModule(loadedModule)) {
      assert.fail("Expected MarkdownViewerSearchForm to be available.");
    }

    const rendered = loadedModule.MarkdownViewerSearchForm({
      inputRef: { current: null },
      query: "terminal",
      onQueryChange: () => undefined,
      onSubmit: () => undefined,
      onCancel: () => undefined,
    });

    if (!isValidElement(rendered)) {
      assert.fail("Expected the Markdown search form to render.");
    }

    const markup = renderToStaticMarkup(rendered);

    assert.equal(markup.startsWith("<form"), true);
    assert.equal(markup.includes('type="search"'), true);
    assert.equal(markup.includes('aria-label="Search Markdown"'), true);
    assert.equal(markup.includes('type="submit"'), true);
    assert.equal(markup.includes("Find"), true);
    assert.equal(markup.includes("md:hidden"), true);
  } finally {
    await vite.close();
  }
});
