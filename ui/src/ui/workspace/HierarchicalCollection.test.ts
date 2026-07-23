import assert from "node:assert/strict";
import test from "node:test";
import type {
  ViewerCollectionLeaf,
  ViewerCollectionNode,
} from "../../content/ViewerContent.ts";
import {
  applyCollectionOperation,
  collectionOperationFromKey,
  collectionRows,
  createHierarchicalCollectionState,
  selectedCollectionLeaf,
} from "./HierarchicalCollection.ts";

function leaf(id: string, title: string, path: string): ViewerCollectionLeaf {
  return {
    kind: "leaf",
    id,
    title,
    path,
    summary: `Summary for ${title}`,
    tags: ["typed"],
    metadata: "2026-07-16",
    documentTitle: title,
    document: {
      text: `# ${title}`,
      source: { path },
      preview: { kind: "markdown" },
    },
    repositoryUrl: undefined,
    statsIdentity: { kind: "uncounted" },
  };
}

const roots = [
  {
    kind: "branch",
    id: "branch:engineering",
    title: "engineering",
    path: "engineering",
    children: [
      {
        kind: "branch",
        id: "branch:engineering/languages",
        title: "languages",
        path: "engineering/languages",
        children: [
          {
            kind: "branch",
            id: "branch:engineering/languages/typed",
            title: "typed",
            path: "engineering/languages/typed",
            children: [leaf("leaf:ts", "Shared Name", "engineering/languages/typed/shared.md")],
          },
        ],
      },
    ],
  },
  {
    kind: "branch",
    id: "branch:writing",
    title: "writing",
    path: "writing",
    children: [leaf("leaf:writing", "Shared Name", "writing/shared.md")],
  },
] satisfies ReadonlyArray<ViewerCollectionNode>;

function selectedId(state: ReturnType<typeof createHierarchicalCollectionState>): string | undefined {
  return state.selection.kind === "selected" ? state.selection.id : undefined;
}

test("projects arbitrary-depth rows and navigates parent, child, and expansion state", () => {
  const initial = createHierarchicalCollectionState(roots);
  assert.deepEqual(
    collectionRows(roots, initial).map((row) => [row.node.id, row.depth]),
    [
      ["branch:engineering", 0],
      ["branch:engineering/languages", 1],
      ["branch:writing", 0],
      ["leaf:writing", 1],
    ],
  );

  const child = applyCollectionOperation(roots, initial, { kind: "move-right" });
  const expanded = applyCollectionOperation(roots, child, { kind: "move-right" });
  const grandchild = applyCollectionOperation(roots, expanded, { kind: "move-right" });
  const expandedGrandchild = applyCollectionOperation(roots, grandchild, { kind: "move-right" });
  const deepestBranch = applyCollectionOperation(roots, expandedGrandchild, { kind: "move-right" });
  const deepestExpanded = applyCollectionOperation(roots, deepestBranch, { kind: "activate" });
  const leafSelected = applyCollectionOperation(roots, deepestExpanded, { kind: "move-right" });

  assert.equal(selectedCollectionLeaf(roots, leafSelected)?.id, "leaf:ts");
  assert.equal(
    selectedId(applyCollectionOperation(roots, leafSelected, { kind: "move-left" })),
    "branch:engineering/languages/typed",
  );
  assert.equal(
    selectedId(applyCollectionOperation(roots, initial, { kind: "move", motion: "last" })),
    "leaf:writing",
  );
});

test("filters recursively with ancestor context, duplicate names, full paths, and restoration", () => {
  const initial = createHierarchicalCollectionState(roots);
  const filtering = applyCollectionOperation(roots, initial, { kind: "begin-filter" });
  const duplicateNames = applyCollectionOperation(roots, filtering, {
    kind: "set-query",
    query: "shared name",
  });

  assert.deepEqual(
    collectionRows(roots, duplicateNames).map((row) => row.node.id),
    [
      "branch:engineering",
      "branch:engineering/languages",
      "branch:engineering/languages/typed",
      "leaf:ts",
      "branch:writing",
      "leaf:writing",
    ],
  );

  const pathMatch = applyCollectionOperation(roots, duplicateNames, {
    kind: "set-query",
    query: "engineering/languages/typed",
  });
  assert.deepEqual(
    collectionRows(roots, pathMatch).map((row) => row.node.id),
    [
      "branch:engineering",
      "branch:engineering/languages",
      "branch:engineering/languages/typed",
      "leaf:ts",
    ],
  );
  const pathLeaf = applyCollectionOperation(roots, pathMatch, {
    kind: "move",
    motion: "last",
  });
  assert.equal(selectedCollectionLeaf(roots, pathLeaf)?.id, "leaf:ts");

  const noMatches = applyCollectionOperation(roots, pathMatch, {
    kind: "set-query",
    query: "missing",
  });
  assert.deepEqual(collectionRows(roots, noMatches), []);
  assert.equal(selectedId(noMatches), undefined);

  const leftInput = applyCollectionOperation(roots, noMatches, { kind: "leave-filter-input" });
  assert.equal(leftInput.mode.kind, "browsing");
  assert.equal(leftInput.mode.query, "missing");
  assert.deepEqual(collectionRows(roots, leftInput), []);

  const cleared = applyCollectionOperation(roots, leftInput, { kind: "clear-filter" });
  assert.equal(cleared.mode.query, "");
  assert.deepEqual(
    collectionRows(roots, cleared).map((row) => row.node.id),
    collectionRows(roots, initial).map((row) => row.node.id),
  );
});

test("handles empty collections and all keyboard lifecycle operations", () => {
  const empty = createHierarchicalCollectionState([]);
  assert.deepEqual(empty.selection, { kind: "none" });
  assert.deepEqual(collectionRows([], empty), []);

  const inputs = [
    ["ArrowUp", "operation"],
    ["ArrowDown", "operation"],
    ["Home", "operation"],
    ["End", "operation"],
    ["ArrowLeft", "operation"],
    ["ArrowRight", "operation"],
    ["j", "operation"],
    ["k", "operation"],
    ["g", "operation"],
    ["G", "operation"],
    ["h", "operation"],
    ["l", "operation"],
    ["Enter", "operation"],
    ["/", "operation"],
    ["Escape", "cancel"],
    ["q", "cancel"],
  ] as const;

  for (const [key, expected] of inputs) {
    const result = collectionOperationFromKey(
      { key, altKey: false, ctrlKey: false, metaKey: false },
      { kind: "browsing", query: "" },
    );
    assert.equal(result.kind, expected, key);
  }

  assert.equal(
    collectionOperationFromKey(
      { key: "c", altKey: false, ctrlKey: true, metaKey: false },
      { kind: "filtering", query: "typed" },
    ).kind,
    "cancel",
  );
  assert.deepEqual(
    collectionOperationFromKey(
      { key: "Escape", altKey: false, ctrlKey: false, metaKey: false },
      { kind: "filtering", query: "typed" },
    ),
    { kind: "operation", operation: { kind: "leave-filter-input" } },
  );
});
