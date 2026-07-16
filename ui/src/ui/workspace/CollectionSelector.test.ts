import assert from "node:assert/strict";
import test from "node:test";
import {
  beginCollectionSelectorFilter,
  collectionSelectorBrowseOperationFromKey,
  collectionSelectorFilterOperationFromKey,
  createCollectionSelectorState,
  leaveCollectionSelectorFilter,
  moveCollectionSelectorSelection,
  selectCollectionSelectorItem,
  selectedCollectionSelectorItem,
  updateCollectionSelectorFilter,
  visibleCollectionSelectorItems,
  type CollectionSelectorItem,
} from "./CollectionSelector.ts";

const items: ReadonlyArray<CollectionSelectorItem> = [
  { id: "alpha", searchText: "Alpha TypeScript terminal" },
  { id: "beta", searchText: "Beta FSharp compiler" },
  { id: "gamma", searchText: "Gamma React workspace" },
];

test("moves and clamps collection selection by stable item identity", () => {
  const initial = createCollectionSelectorState(items);
  const second = moveCollectionSelectorSelection(initial, items, "next");
  const last = moveCollectionSelectorSelection(second, items, "last");
  const clamped = moveCollectionSelectorSelection(last, items, "next");
  const reordered = [items[2], items[0], items[1]].filter(
    (item): item is CollectionSelectorItem => item !== undefined,
  );

  assert.deepEqual(initial.selection, { kind: "selected", id: "alpha" });
  assert.deepEqual(second.selection, { kind: "selected", id: "beta" });
  assert.deepEqual(last.selection, { kind: "selected", id: "gamma" });
  assert.deepEqual(clamped.selection, { kind: "selected", id: "gamma" });
  assert.deepEqual(selectedCollectionSelectorItem(reordered, clamped), {
    kind: "selected",
    item: items[2],
  });
});

test("filters with deterministic case-insensitive substring matching", () => {
  const initial = selectCollectionSelectorItem(
    createCollectionSelectorState(items),
    items,
    "gamma",
  );
  const filtering = beginCollectionSelectorFilter(initial);
  const matched = updateCollectionSelectorFilter(filtering, items, "fSHARP");
  const noMatches = updateCollectionSelectorFilter(matched, items, "missing");
  const cleared = leaveCollectionSelectorFilter(noMatches, items);

  assert.deepEqual(
    visibleCollectionSelectorItems(items, matched).map((item) => item.id),
    ["beta"],
  );
  assert.deepEqual(matched.selection, { kind: "selected", id: "beta" });
  assert.deepEqual(visibleCollectionSelectorItems(items, noMatches), []);
  assert.deepEqual(noMatches.selection, { kind: "none" });
  assert.deepEqual(cleared, {
    mode: { kind: "browsing" },
    selection: { kind: "selected", id: "alpha" },
  });
});

test("maps browsing keys to terminal selector operations", () => {
  const inputs = [
    ["j", { kind: "move", motion: "next" }],
    ["ArrowDown", { kind: "move", motion: "next" }],
    ["k", { kind: "move", motion: "previous" }],
    ["ArrowUp", { kind: "move", motion: "previous" }],
    ["g", { kind: "move", motion: "first" }],
    ["Home", { kind: "move", motion: "first" }],
    ["G", { kind: "move", motion: "last" }],
    ["End", { kind: "move", motion: "last" }],
    ["Enter", { kind: "open" }],
    ["/", { kind: "begin-filter" }],
    ["Escape", { kind: "return" }],
    ["q", { kind: "return" }],
  ] as const;

  for (const [key, operation] of inputs) {
    assert.deepEqual(
      collectionSelectorBrowseOperationFromKey({
        key,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      }),
      { kind: "handled", operation },
    );
  }

  assert.deepEqual(
    collectionSelectorBrowseOperationFromKey({
      key: "j",
      altKey: false,
      ctrlKey: true,
      metaKey: false,
    }),
    { kind: "ignored" },
  );
});

test("keeps filter text native while supporting movement, open, and first Escape", () => {
  assert.deepEqual(
    collectionSelectorFilterOperationFromKey({
      key: "j",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
    }),
    { kind: "ignored" },
  );
  assert.deepEqual(
    collectionSelectorFilterOperationFromKey({
      key: "ArrowDown",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
    }),
    { kind: "handled", operation: { kind: "move", motion: "next" } },
  );
  assert.deepEqual(
    collectionSelectorFilterOperationFromKey({
      key: "Enter",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
    }),
    { kind: "handled", operation: { kind: "open" } },
  );
  assert.deepEqual(
    collectionSelectorFilterOperationFromKey({
      key: "Escape",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
    }),
    { kind: "handled", operation: { kind: "leave-filter" } },
  );
});

test("uses the same immutable movement transition for mobile up and down", () => {
  const initial = createCollectionSelectorState(items);
  const movedDown = moveCollectionSelectorSelection(initial, items, "next");
  const movedUp = moveCollectionSelectorSelection(
    movedDown,
    items,
    "previous",
  );

  assert.deepEqual(movedDown.selection, { kind: "selected", id: "beta" });
  assert.deepEqual(movedUp, initial);
});
