import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import type {
  ViewerCollectionBranch,
  ViewerCollectionLeaf,
  ViewerContent,
} from "../../content/ViewerContent.ts";
import { countableViewerContentIds } from "../../content/ViewerContent.ts";
import type { ContentId } from "../../api/ContentContracts.ts";
import type {
  InputCapturePaneKeyInput,
  InputCapturePaneKeyResult,
} from "../terminal/InputCapture.tsx";
import {
  applyCollectionOperation,
  collectionOperationFromKey,
  collectionRows,
  createHierarchicalCollectionState,
  selectedCollectionLeaf,
  type CollectionOperation,
  type HierarchicalCollectionState,
} from "./HierarchicalCollection.ts";

type CollectionContent = Extract<ViewerContent, { kind: "collection" }>;

type CollectionPanePresentation =
  | Readonly<{ kind: "inline-terminal"; transcript: ReactElement }>
  | Readonly<{ kind: "split-pane" }>;

type HierarchicalCollectionPaneProps = Readonly<{
  collection: CollectionContent;
  presentation: CollectionPanePresentation;
  isActive: boolean;
  focusVersion: number;
  onActivate: () => void;
  onPaneKeyInput: (
    input: InputCapturePaneKeyInput,
  ) => InputCapturePaneKeyResult;
  onCancel: () => void;
  onAcceptedContentOpen: (contentId: ContentId) => void;
  renderDocument: (
    leaf: ViewerCollectionLeaf,
    onReturn: () => void,
  ) => ReactElement;
}>;

function rowMarker(
  node: ViewerCollectionLeaf | ViewerCollectionBranch,
  state: HierarchicalCollectionState,
): string {
  if (node.kind === "leaf") {
    return "·";
  }

  return state.mode.query.trim().length > 0 ||
      state.expandedBranchIds.has(node.id)
    ? "▾"
    : "▸";
}

function SelectorControls({
  state,
  selectedLeaf,
  selectedIsBranch,
  applyOperation,
  onOpen,
  onCancel,
}: Readonly<{
  state: HierarchicalCollectionState;
  selectedLeaf: ViewerCollectionLeaf | undefined;
  selectedIsBranch: boolean;
  applyOperation: (operation: CollectionOperation) => void;
  onOpen: () => void;
  onCancel: () => void;
}>): ReactElement {
  const filterLabel = state.mode.query.length === 0 ? "Filter" : "Clear";

  return (
    <div
      className="grid shrink-0 grid-cols-4 gap-1 border-t border-surface-border bg-surface-raised p-2 text-xs md:hidden"
      aria-label="Collection touch controls"
    >
      <button
        type="button"
        className="rounded border border-surface-border px-2 py-1 text-text-bright"
        onClick={() => applyOperation({ kind: "move", motion: "previous" })}
      >
        Up
      </button>
      <button
        type="button"
        className="rounded border border-surface-border px-2 py-1 text-text-bright"
        onClick={() => applyOperation({ kind: "move", motion: "next" })}
      >
        Down
      </button>
      <button
        type="button"
        className="rounded border border-surface-border px-2 py-1 text-text-bright"
        onClick={() => applyOperation({ kind: "move-left" })}
      >
        Left
      </button>
      <button
        type="button"
        className="rounded border border-surface-border px-2 py-1 text-text-bright"
        onClick={() => applyOperation({ kind: "move-right" })}
      >
        Right
      </button>
      <button
        type="button"
        className="rounded border border-surface-border px-2 py-1 text-text-bright"
        onClick={() => applyOperation(
          state.mode.query.length === 0
            ? { kind: "begin-filter" }
            : { kind: "clear-filter" },
        )}
      >
        {filterLabel}
      </button>
      <button
        type="button"
        className="rounded border border-surface-border px-2 py-1 text-text-bright disabled:text-text-muted"
        disabled={!selectedIsBranch}
        onClick={() => applyOperation({ kind: "activate" })}
      >
        Toggle
      </button>
      <button
        type="button"
        className="rounded border border-ui-accent px-2 py-1 text-text-bright disabled:border-surface-border disabled:text-text-muted"
        disabled={selectedLeaf === undefined}
        onClick={onOpen}
      >
        Open
      </button>
      <button
        type="button"
        className="rounded border border-surface-border px-2 py-1 text-text-bright"
        onClick={onCancel}
      >
        Shell
      </button>
    </div>
  );
}

export function HierarchicalCollectionPane({
  collection,
  presentation,
  isActive,
  focusVersion,
  onActivate,
  onPaneKeyInput,
  onCancel,
  onAcceptedContentOpen,
  renderDocument,
}: HierarchicalCollectionPaneProps): ReactElement {
  const selectorRef = useRef<HTMLElement | null>(null);
  const filterRef = useRef<HTMLInputElement | null>(null);
  const [state, setState] = useState<HierarchicalCollectionState>(() =>
    createHierarchicalCollectionState(collection.roots)
  );
  const [openedLeaf, setOpenedLeaf] = useState<ViewerCollectionLeaf>();
  const rows = collectionRows(collection.roots, state);
  const selectedId = state.selection.kind === "selected"
    ? state.selection.id
    : undefined;
  const selectedRow = rows.find((row) => row.node.id === selectedId);
  const selectedLeaf = selectedCollectionLeaf(collection.roots, state);

  useEffect(() => {
    if (!isActive || openedLeaf !== undefined) {
      return;
    }

    if (state.mode.kind === "filtering") {
      filterRef.current?.focus({ preventScroll: true });
      return;
    }

    selectorRef.current?.focus({ preventScroll: true });
  }, [focusVersion, isActive, openedLeaf, state.mode.kind]);

  const applyOperation = (operation: CollectionOperation): void => {
    if (operation.kind === "activate") {
      const leaf = selectedCollectionLeaf(collection.roots, state);

      if (leaf !== undefined) {
        for (const contentId of countableViewerContentIds(leaf.statsIdentity)) {
          onAcceptedContentOpen(contentId);
        }
        setOpenedLeaf(leaf);
        return;
      }
    }

    setState((current) =>
      applyCollectionOperation(collection.roots, current, operation)
    );
  };

  const openSelectedLeaf = (): void => {
    if (selectedLeaf !== undefined) {
      for (const contentId of countableViewerContentIds(selectedLeaf.statsIdentity)) {
        onAcceptedContentOpen(contentId);
      }
      setOpenedLeaf(selectedLeaf);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    const paneResult = onPaneKeyInput({
      key: event.key,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
    });

    if (paneResult.kind === "handled") {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const result = collectionOperationFromKey(
      {
        key: event.key,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
      },
      state.mode,
    );

    if (result.kind === "ignored") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (result.kind === "cancel") {
      onCancel();
      return;
    }

    applyOperation(result.operation);
  };

  if (openedLeaf !== undefined) {
    return renderDocument(openedLeaf, () => {
      setOpenedLeaf(undefined);
      selectorRef.current?.focus({ preventScroll: true });
    });
  }

  const selector = (
    <section
      ref={selectorRef}
      tabIndex={0}
      className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-surface-deepest font-mono text-sm text-text-primary outline-none"
      aria-label={`${collection.title} hierarchical selector`}
      onFocus={onActivate}
      onKeyDown={handleKeyDown}
    >
      {state.mode.kind === "filtering" ? (
        <label className="flex shrink-0 items-center gap-2 border-b border-surface-border px-4 py-2 text-text-muted">
          <span>/</span>
          <input
            ref={filterRef}
            type="text"
            value={state.mode.query}
            className="min-w-0 flex-1 border-b border-surface-border bg-transparent px-1 py-0.5 text-text-primary outline-none focus:border-ui-focus"
            aria-label={`Filter ${collection.title}`}
            onChange={(event) => applyOperation({
              kind: "set-query",
              query: event.target.value,
            })}
          />
        </label>
      ) : null}
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-2">
        {collection.roots.length === 0 ? (
          <p
            className="whitespace-pre-wrap wrap-break-words text-text-muted"
            role="status"
          >
            {collection.emptyMessage}
          </p>
        ) : rows.length === 0 ? (
          <p className="whitespace-pre-wrap wrap-break-words text-text-muted" role="status">
            No matches for “{state.mode.query}”. Press Filter/Clear or Escape, then / to edit.
          </p>
        ) : (
          <ul role="listbox" aria-label={`${collection.title} rows`}>
            {rows.map((row) => {
              const selected = row.node.id === selectedId;
              const indentation = "  ".repeat(row.depth);

              return (
                <li
                  key={row.node.id}
                  role="option"
                  aria-selected={selected}
                  className={selected
                    ? "flex min-w-0 cursor-pointer items-baseline gap-2 bg-surface-selected px-1 py-1 text-text-bright"
                    : "flex min-w-0 cursor-pointer items-baseline gap-2 px-1 py-1 text-text-primary"}
                  onClick={() => applyOperation({
                    kind: "select",
                    id: row.node.id,
                  })}
                >
                  <span
                    className="shrink-0 whitespace-pre text-ui-accent"
                    aria-hidden="true"
                  >
                    {selected ? ">" : " "} {indentation}{rowMarker(row.node, state)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{row.node.title}</span>
                  <span className="w-1/2 shrink truncate text-right text-xs text-text-muted">
                    {row.node.kind === "branch"
                      ? row.node.path
                      : `${row.node.path} · ${row.node.metadata}`}
                  </span>
                  {row.node.kind !== "leaf" || row.node.repositoryUrl === undefined ? null : (
                    <a
                      className="shrink-0 text-text-muted underline underline-offset-2 hover:text-ui-accent focus-visible:outline-2 focus-visible:outline-ui-focus"
                      href={row.node.repositoryUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Open ${row.node.title} repository`}
                      onClick={(event) => event.stopPropagation()}
                    >
                      ↗
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <p className="shrink-0 border-t border-surface-border px-4 py-1 text-xs text-text-muted" role="status">
        {state.mode.kind === "filtering"
          ? `${rows.length} matches · type to filter · arrows move · Enter toggle/open · Esc keep filter`
          : `${rows.length} rows · j/k move · h/l collapse/expand · Enter toggle/open · / filter · Esc/q return`}
      </p>
      <SelectorControls
        state={state}
        selectedLeaf={selectedLeaf}
        selectedIsBranch={selectedRow?.node.kind === "branch"}
        applyOperation={applyOperation}
        onOpen={openSelectedLeaf}
        onCancel={onCancel}
      />
    </section>
  );

  if (presentation.kind === "split-pane") {
    return <div className="h-full min-h-0 min-w-0">{selector}</div>;
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-surface-deepest text-text-primary">
      <div className="min-h-0 flex-1">{presentation.transcript}</div>
      <div className="h-1/2 min-h-48 shrink-0 border-t border-surface-border">
        {selector}
      </div>
    </div>
  );
}
