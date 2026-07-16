import assert from "node:assert/strict";
import test from "node:test";
import { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import {
  beginCollectionSelectorFilter,
  createCollectionSelectorState,
  updateCollectionSelectorFilter,
} from "./CollectionSelector.ts";
import {
  collectionSelectorItemsForViewer,
  type CollectionViewerContent,
} from "./CollectionViewerSelectorModel.ts";

function isCollectionViewerSelectorModule(
  value: unknown,
): value is Readonly<{
  CollectionViewerSelector: (props: unknown) => unknown;
}> {
  return (
    typeof value === "object" &&
    value !== null &&
    "CollectionViewerSelector" in value &&
    typeof value.CollectionViewerSelector === "function"
  );
}

const projectsViewer = {
  kind: "project-gallery",
  title: "Projects",
  projects: [
    {
      id: "termin-al",
      name: "termin.al",
      summary: "A keyboard-first portfolio terminal.",
      repository: "alsi-lawr/termin.al",
      repositoryUrl: "https://github.com/alsi-lawr/termin.al",
      tags: ["typescript", "react"],
      document: { text: "# termin.al", source: { path: "/projects/termin.al" } },
    },
    {
      id: "neotheme",
      name: "neotheme.nvim",
      summary: "A terminal colour theme.",
      repository: "alsi-lawr/neotheme.nvim",
      tags: ["lua"],
      document: { text: "# neotheme", source: { path: "/projects/neotheme" } },
    },
  ],
} as const satisfies CollectionViewerContent;

test("renders compact accessible selector rows and a mobile-only open action", async () => {
  const vite = await createServer({
    appType: "custom",
    server: { middlewareMode: true },
  });

  try {
    const loadedModule: unknown = await vite.ssrLoadModule(
      "/src/ui/workspace/CollectionViewerSelector.tsx",
    );

    if (!isCollectionViewerSelectorModule(loadedModule)) {
      assert.fail("Expected CollectionViewerSelector to be available.");
    }

    const items = collectionSelectorItemsForViewer(projectsViewer);
    const rendered = loadedModule.CollectionViewerSelector({
      viewer: projectsViewer,
      state: createCollectionSelectorState(items),
      filterInputRef: { current: null },
      onStateChange: () => undefined,
      onOpen: () => undefined,
      onRestoreViewerFocus: () => undefined,
    });

    if (!isValidElement(rendered)) {
      assert.fail("Expected the project selector to render.");
    }

    const markup = renderToStaticMarkup(rendered);

    assert.equal(markup.includes('role="listbox"'), true);
    assert.equal(markup.includes('role="option"'), true);
    assert.equal(markup.includes('aria-selected="true"'), true);
    assert.equal(markup.includes("&gt;"), true);
    assert.equal(markup.includes("A keyboard-first portfolio terminal."), true);
    assert.equal(markup.includes("#typescript"), true);
    assert.equal(markup.includes("Repository ↗"), true);
    assert.equal(markup.includes("Open README"), true);
    assert.equal(markup.includes("md:hidden"), true);
    assert.equal(markup.includes("grid-cols"), false);
  } finally {
    await vite.close();
  }
});

test("renders filtering and empty-result states without losing selector context", async () => {
  const vite = await createServer({
    appType: "custom",
    server: { middlewareMode: true },
  });

  try {
    const loadedModule: unknown = await vite.ssrLoadModule(
      "/src/ui/workspace/CollectionViewerSelector.tsx",
    );

    if (!isCollectionViewerSelectorModule(loadedModule)) {
      assert.fail("Expected CollectionViewerSelector to be available.");
    }

    const items = collectionSelectorItemsForViewer(projectsViewer);
    const filtering = beginCollectionSelectorFilter(
      createCollectionSelectorState(items),
    );
    const noMatches = updateCollectionSelectorFilter(
      filtering,
      items,
      "missing",
    );
    const rendered = loadedModule.CollectionViewerSelector({
      viewer: projectsViewer,
      state: noMatches,
      filterInputRef: { current: null },
      onStateChange: () => undefined,
      onOpen: () => undefined,
      onRestoreViewerFocus: () => undefined,
    });

    if (!isValidElement(rendered)) {
      assert.fail("Expected the filtered project selector to render.");
    }

    const markup = renderToStaticMarkup(rendered);

    assert.equal(markup.includes('aria-label="Filter Projects"'), true);
    assert.equal(markup.includes("No matches for “missing”."), true);
    assert.equal(markup.includes("0/2"), true);
    assert.equal(markup.includes("Esc clear filter"), true);
  } finally {
    await vite.close();
  }
});
