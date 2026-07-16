export type CollectionSelectorItem = Readonly<{
  id: string;
  searchText: string;
}>;

export type CollectionSelectorSelection =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "selected"; id: string }>;

export type CollectionSelectorMode =
  | Readonly<{ kind: "browsing" }>
  | Readonly<{ kind: "filtering"; query: string }>;

export type CollectionSelectorState = Readonly<{
  selection: CollectionSelectorSelection;
  mode: CollectionSelectorMode;
}>;

export type CollectionSelectorMotion =
  | "previous"
  | "next"
  | "first"
  | "last";

export type CollectionSelectorOperation =
  | Readonly<{ kind: "move"; motion: CollectionSelectorMotion }>
  | Readonly<{ kind: "open" }>
  | Readonly<{ kind: "begin-filter" }>
  | Readonly<{ kind: "leave-filter" }>
  | Readonly<{ kind: "return" }>;

export type CollectionSelectorKeyResult =
  | Readonly<{
      kind: "handled";
      operation: CollectionSelectorOperation;
    }>
  | Readonly<{ kind: "ignored" }>;

type CollectionSelectorKeyInput = Readonly<{
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}>;

export type SelectedCollectionSelectorItem =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "selected"; item: CollectionSelectorItem }>;

function selectionForItems(
  items: ReadonlyArray<CollectionSelectorItem>,
  selection: CollectionSelectorSelection,
): CollectionSelectorSelection {
  if (
    selection.kind === "selected" &&
    items.some((item) => item.id === selection.id)
  ) {
    return selection;
  }

  const first = items[0];
  return first === undefined
    ? { kind: "none" }
    : { kind: "selected", id: first.id };
}

export function visibleCollectionSelectorItems(
  items: ReadonlyArray<CollectionSelectorItem>,
  state: CollectionSelectorState,
): ReadonlyArray<CollectionSelectorItem> {
  if (state.mode.kind === "browsing" || state.mode.query.length === 0) {
    return items;
  }

  const query = state.mode.query.toLowerCase();
  return items.filter((item) => item.searchText.toLowerCase().includes(query));
}

export function createCollectionSelectorState(
  items: ReadonlyArray<CollectionSelectorItem>,
): CollectionSelectorState {
  return {
    selection: selectionForItems(items, { kind: "none" }),
    mode: { kind: "browsing" },
  };
}

export function selectCollectionSelectorItem(
  state: CollectionSelectorState,
  items: ReadonlyArray<CollectionSelectorItem>,
  id: string,
): CollectionSelectorState {
  const visibleItems = visibleCollectionSelectorItems(items, state);

  if (!visibleItems.some((item) => item.id === id)) {
    return state;
  }

  return { ...state, selection: { kind: "selected", id } };
}

export function moveCollectionSelectorSelection(
  state: CollectionSelectorState,
  items: ReadonlyArray<CollectionSelectorItem>,
  motion: CollectionSelectorMotion,
): CollectionSelectorState {
  const visibleItems = visibleCollectionSelectorItems(items, state);

  if (visibleItems.length === 0) {
    return { ...state, selection: { kind: "none" } };
  }

  const selectedId = state.selection.kind === "selected"
    ? state.selection.id
    : undefined;
  const selectedIndex = selectedId === undefined
    ? -1
    : visibleItems.findIndex((item) => item.id === selectedId);
  const currentIndex = selectedIndex === -1 ? 0 : selectedIndex;
  const nextIndex = (() => {
    switch (motion) {
      case "previous":
        return Math.max(0, currentIndex - 1);
      case "next":
        return Math.min(visibleItems.length - 1, currentIndex + 1);
      case "first":
        return 0;
      case "last":
        return visibleItems.length - 1;
    }
  })();
  const selected = visibleItems[nextIndex];

  return selected === undefined
    ? { ...state, selection: { kind: "none" } }
    : { ...state, selection: { kind: "selected", id: selected.id } };
}

export function beginCollectionSelectorFilter(
  state: CollectionSelectorState,
): CollectionSelectorState {
  return { ...state, mode: { kind: "filtering", query: "" } };
}

export function updateCollectionSelectorFilter(
  state: CollectionSelectorState,
  items: ReadonlyArray<CollectionSelectorItem>,
  query: string,
): CollectionSelectorState {
  const filteringState: CollectionSelectorState = {
    ...state,
    mode: { kind: "filtering", query },
  };
  const visibleItems = visibleCollectionSelectorItems(items, filteringState);

  return {
    ...filteringState,
    selection: selectionForItems(visibleItems, state.selection),
  };
}

export function leaveCollectionSelectorFilter(
  state: CollectionSelectorState,
  items: ReadonlyArray<CollectionSelectorItem>,
): CollectionSelectorState {
  return {
    mode: { kind: "browsing" },
    selection: selectionForItems(items, state.selection),
  };
}

export function selectedCollectionSelectorItem(
  items: ReadonlyArray<CollectionSelectorItem>,
  state: CollectionSelectorState,
): SelectedCollectionSelectorItem {
  const visibleItems = visibleCollectionSelectorItems(items, state);
  const selection = selectionForItems(visibleItems, state.selection);

  if (selection.kind === "none") {
    return { kind: "none" };
  }

  const selected = visibleItems.find((item) => item.id === selection.id);

  return selected === undefined
    ? { kind: "none" }
    : { kind: "selected", item: selected };
}

function isModified(input: CollectionSelectorKeyInput): boolean {
  return input.altKey || input.ctrlKey || input.metaKey;
}

type CollectionSelectorKeyMode =
  | Readonly<{ kind: "browsing" }>
  | Readonly<{ kind: "filtering" }>;

function movementResult(
  key: string,
  mode: CollectionSelectorKeyMode,
): CollectionSelectorKeyResult {
  switch (key) {
    case "ArrowUp":
      return {
        kind: "handled",
        operation: { kind: "move", motion: "previous" },
      };
    case "ArrowDown":
      return {
        kind: "handled",
        operation: { kind: "move", motion: "next" },
      };
    case "Home":
      return {
        kind: "handled",
        operation: { kind: "move", motion: "first" },
      };
    case "End":
      return {
        kind: "handled",
        operation: { kind: "move", motion: "last" },
      };
    case "k":
      return mode.kind === "browsing"
        ? {
            kind: "handled",
            operation: { kind: "move", motion: "previous" },
          }
        : { kind: "ignored" };
    case "j":
      return mode.kind === "browsing"
        ? {
            kind: "handled",
            operation: { kind: "move", motion: "next" },
          }
        : { kind: "ignored" };
    case "g":
      return mode.kind === "browsing"
        ? {
            kind: "handled",
            operation: { kind: "move", motion: "first" },
          }
        : { kind: "ignored" };
    case "G":
      return mode.kind === "browsing"
        ? {
            kind: "handled",
            operation: { kind: "move", motion: "last" },
          }
        : { kind: "ignored" };
    default:
      return { kind: "ignored" };
  }
}

export function collectionSelectorBrowseOperationFromKey(
  input: CollectionSelectorKeyInput,
): CollectionSelectorKeyResult {
  if (isModified(input)) {
    return { kind: "ignored" };
  }

  const movement = movementResult(input.key, { kind: "browsing" });

  if (movement.kind === "handled") {
    return movement;
  }

  switch (input.key) {
    case "Enter":
      return { kind: "handled", operation: { kind: "open" } };
    case "/":
      return { kind: "handled", operation: { kind: "begin-filter" } };
    case "Escape":
    case "q":
      return { kind: "handled", operation: { kind: "return" } };
    default:
      return { kind: "ignored" };
  }
}

export function collectionSelectorFilterOperationFromKey(
  input: CollectionSelectorKeyInput,
): CollectionSelectorKeyResult {
  if (isModified(input)) {
    return { kind: "ignored" };
  }

  const movement = movementResult(input.key, { kind: "filtering" });

  if (movement.kind === "handled") {
    return movement;
  }

  switch (input.key) {
    case "Enter":
      return { kind: "handled", operation: { kind: "open" } };
    case "Escape":
      return { kind: "handled", operation: { kind: "leave-filter" } };
    default:
      return { kind: "ignored" };
  }
}
