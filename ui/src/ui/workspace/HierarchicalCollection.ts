import type {
  ViewerCollectionLeaf,
  ViewerCollectionNode,
} from "../../content/ViewerContent.ts";

export type CollectionSelection =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "selected"; id: string }>;

export type CollectionMode =
  | Readonly<{ kind: "browsing"; query: string }>
  | Readonly<{ kind: "filtering"; query: string }>;

export type HierarchicalCollectionState = Readonly<{
  selection: CollectionSelection;
  expandedBranchIds: ReadonlySet<string>;
  mode: CollectionMode;
}>;

export type CollectionRow = Readonly<{
  node: ViewerCollectionNode;
  depth: number;
  parentId: string | undefined;
}>;

export type CollectionMotion = "previous" | "next" | "first" | "last";

export type CollectionOperation =
  | Readonly<{ kind: "move"; motion: CollectionMotion }>
  | Readonly<{ kind: "move-left" }>
  | Readonly<{ kind: "move-right" }>
  | Readonly<{ kind: "activate" }>
  | Readonly<{ kind: "begin-filter" }>
  | Readonly<{ kind: "set-query"; query: string }>
  | Readonly<{ kind: "leave-filter-input" }>
  | Readonly<{ kind: "clear-filter" }>
  | Readonly<{ kind: "select"; id: string }>;

export type CollectionKeyResult =
  | Readonly<{ kind: "operation"; operation: CollectionOperation }>
  | Readonly<{ kind: "cancel" }>
  | Readonly<{ kind: "ignored" }>;

type CollectionKeyInput = Readonly<{
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}>;

function topLevelExpandedIds(
  roots: ReadonlyArray<ViewerCollectionNode>,
): ReadonlySet<string> {
  return new Set(
    roots.flatMap((node) => node.kind === "branch" ? [node.id] : []),
  );
}

function searchText(leaf: ViewerCollectionLeaf): string {
  return [
    leaf.title,
    leaf.summary,
    ...leaf.tags,
    leaf.metadata,
    leaf.path,
  ].join("\n").toLocaleLowerCase();
}

function matchingRows(
  nodes: ReadonlyArray<ViewerCollectionNode>,
  query: string,
  depth: number,
  parentId: string | undefined,
): ReadonlyArray<CollectionRow> {
  const rows: CollectionRow[] = [];

  for (const node of nodes) {
    if (node.kind === "leaf") {
      if (searchText(node).includes(query)) {
        rows.push({ node, depth, parentId });
      }
      continue;
    }

    const children = matchingRows(node.children, query, depth + 1, node.id);

    if (children.length > 0) {
      rows.push({ node, depth, parentId }, ...children);
    }
  }

  return rows;
}

function expandedRows(
  nodes: ReadonlyArray<ViewerCollectionNode>,
  expandedBranchIds: ReadonlySet<string>,
  depth: number,
  parentId: string | undefined,
): ReadonlyArray<CollectionRow> {
  const rows: CollectionRow[] = [];

  for (const node of nodes) {
    rows.push({ node, depth, parentId });

    if (node.kind === "branch" && expandedBranchIds.has(node.id)) {
      rows.push(
        ...expandedRows(node.children, expandedBranchIds, depth + 1, node.id),
      );
    }
  }

  return rows;
}

export function collectionRows(
  roots: ReadonlyArray<ViewerCollectionNode>,
  state: HierarchicalCollectionState,
): ReadonlyArray<CollectionRow> {
  const normalizedQuery = state.mode.query.trim().toLocaleLowerCase();

  return normalizedQuery.length === 0
    ? expandedRows(roots, state.expandedBranchIds, 0, undefined)
    : matchingRows(roots, normalizedQuery, 0, undefined);
}

function selectionForRows(
  rows: ReadonlyArray<CollectionRow>,
  selection: CollectionSelection,
): CollectionSelection {
  if (
    selection.kind === "selected" &&
    rows.some((row) => row.node.id === selection.id)
  ) {
    return selection;
  }

  const first = rows[0];
  return first === undefined
    ? { kind: "none" }
    : { kind: "selected", id: first.node.id };
}

export function createHierarchicalCollectionState(
  roots: ReadonlyArray<ViewerCollectionNode>,
): HierarchicalCollectionState {
  const state: HierarchicalCollectionState = {
    selection: { kind: "none" },
    expandedBranchIds: topLevelExpandedIds(roots),
    mode: { kind: "browsing", query: "" },
  };

  return {
    ...state,
    selection: selectionForRows(collectionRows(roots, state), state.selection),
  };
}

function selectedRow(
  roots: ReadonlyArray<ViewerCollectionNode>,
  state: HierarchicalCollectionState,
): CollectionRow | undefined {
  if (state.selection.kind === "none") {
    return undefined;
  }

  const selectedId = state.selection.id;

  return collectionRows(roots, state).find(
    (row) => row.node.id === selectedId,
  );
}

function withVisibleSelection(
  roots: ReadonlyArray<ViewerCollectionNode>,
  state: HierarchicalCollectionState,
): HierarchicalCollectionState {
  return {
    ...state,
    selection: selectionForRows(collectionRows(roots, state), state.selection),
  };
}

function selectId(
  state: HierarchicalCollectionState,
  id: string,
): HierarchicalCollectionState {
  return { ...state, selection: { kind: "selected", id } };
}

function moveSelection(
  roots: ReadonlyArray<ViewerCollectionNode>,
  state: HierarchicalCollectionState,
  motion: CollectionMotion,
): HierarchicalCollectionState {
  const rows = collectionRows(roots, state);

  if (rows.length === 0) {
    return { ...state, selection: { kind: "none" } };
  }

  const selectedId = state.selection.kind === "selected"
    ? state.selection.id
    : undefined;
  const currentIndex = Math.max(
    0,
    rows.findIndex((row) => row.node.id === selectedId),
  );
  const nextIndex = (() => {
    switch (motion) {
      case "previous":
        return Math.max(0, currentIndex - 1);
      case "next":
        return Math.min(rows.length - 1, currentIndex + 1);
      case "first":
        return 0;
      case "last":
        return rows.length - 1;
    }
  })();
  const row = rows[nextIndex];

  return row === undefined ? state : selectId(state, row.node.id);
}

function updateExpandedBranch(
  roots: ReadonlyArray<ViewerCollectionNode>,
  state: HierarchicalCollectionState,
  branchId: string,
  expanded: boolean,
): HierarchicalCollectionState {
  const expandedBranchIds = new Set(state.expandedBranchIds);

  if (expanded) {
    expandedBranchIds.add(branchId);
  } else {
    expandedBranchIds.delete(branchId);
  }

  return withVisibleSelection(roots, { ...state, expandedBranchIds });
}

function moveRight(
  roots: ReadonlyArray<ViewerCollectionNode>,
  state: HierarchicalCollectionState,
): HierarchicalCollectionState {
  const row = selectedRow(roots, state);

  if (row?.node.kind !== "branch") {
    return state;
  }

  if (!state.expandedBranchIds.has(row.node.id)) {
    return updateExpandedBranch(roots, state, row.node.id, true);
  }

  const rows = collectionRows(roots, state);
  const selectedIndex = rows.findIndex((candidate) => candidate.node.id === row.node.id);
  const child = rows[selectedIndex + 1];

  return child === undefined || child.parentId !== row.node.id
    ? state
    : selectId(state, child.node.id);
}

function moveLeft(
  roots: ReadonlyArray<ViewerCollectionNode>,
  state: HierarchicalCollectionState,
): HierarchicalCollectionState {
  const row = selectedRow(roots, state);

  if (row === undefined) {
    return state;
  }

  if (row.node.kind === "branch" && state.expandedBranchIds.has(row.node.id)) {
    return updateExpandedBranch(roots, state, row.node.id, false);
  }

  return row.parentId === undefined ? state : selectId(state, row.parentId);
}

export function applyCollectionOperation(
  roots: ReadonlyArray<ViewerCollectionNode>,
  state: HierarchicalCollectionState,
  operation: CollectionOperation,
): HierarchicalCollectionState {
  switch (operation.kind) {
    case "move":
      return moveSelection(roots, state, operation.motion);
    case "move-left":
      return moveLeft(roots, state);
    case "move-right":
      return moveRight(roots, state);
    case "activate": {
      const row = selectedRow(roots, state);

      return row?.node.kind === "branch"
        ? updateExpandedBranch(
            roots,
            state,
            row.node.id,
            !state.expandedBranchIds.has(row.node.id),
          )
        : state;
    }
    case "begin-filter":
      return { ...state, mode: { kind: "filtering", query: state.mode.query } };
    case "set-query":
      return withVisibleSelection(roots, {
        ...state,
        mode: { kind: "filtering", query: operation.query },
      });
    case "leave-filter-input":
      return { ...state, mode: { kind: "browsing", query: state.mode.query } };
    case "clear-filter":
      return withVisibleSelection(roots, {
        ...state,
        mode: { kind: "browsing", query: "" },
      });
    case "select":
      return collectionRows(roots, state).some((row) => row.node.id === operation.id)
        ? selectId(state, operation.id)
        : state;
  }
}

export function selectedCollectionLeaf(
  roots: ReadonlyArray<ViewerCollectionNode>,
  state: HierarchicalCollectionState,
): ViewerCollectionLeaf | undefined {
  const row = selectedRow(roots, state);
  return row?.node.kind === "leaf" ? row.node : undefined;
}

function movementKey(key: string, browsing: boolean): CollectionOperation | undefined {
  switch (key) {
    case "ArrowUp":
      return { kind: "move", motion: "previous" };
    case "ArrowDown":
      return { kind: "move", motion: "next" };
    case "Home":
      return { kind: "move", motion: "first" };
    case "End":
      return { kind: "move", motion: "last" };
    case "ArrowLeft":
      return { kind: "move-left" };
    case "ArrowRight":
      return { kind: "move-right" };
    case "k":
      return browsing ? { kind: "move", motion: "previous" } : undefined;
    case "j":
      return browsing ? { kind: "move", motion: "next" } : undefined;
    case "g":
      return browsing ? { kind: "move", motion: "first" } : undefined;
    case "G":
      return browsing ? { kind: "move", motion: "last" } : undefined;
    case "h":
      return browsing ? { kind: "move-left" } : undefined;
    case "l":
      return browsing ? { kind: "move-right" } : undefined;
    default:
      return undefined;
  }
}

export function collectionOperationFromKey(
  input: CollectionKeyInput,
  mode: CollectionMode,
): CollectionKeyResult {
  if (input.ctrlKey && !input.altKey && !input.metaKey && input.key.toLowerCase() === "c") {
    return { kind: "cancel" };
  }

  if (input.altKey || input.ctrlKey || input.metaKey) {
    return { kind: "ignored" };
  }

  const movement = movementKey(input.key, mode.kind === "browsing");

  if (movement !== undefined) {
    return { kind: "operation", operation: movement };
  }

  if (mode.kind === "filtering") {
    switch (input.key) {
      case "Enter":
        return { kind: "operation", operation: { kind: "activate" } };
      case "Escape":
        return { kind: "operation", operation: { kind: "leave-filter-input" } };
      default:
        return { kind: "ignored" };
    }
  }

  switch (input.key) {
    case "Enter":
      return { kind: "operation", operation: { kind: "activate" } };
    case "/":
      return { kind: "operation", operation: { kind: "begin-filter" } };
    case "Escape":
    case "q":
      return { kind: "cancel" };
    default:
      return { kind: "ignored" };
  }
}
