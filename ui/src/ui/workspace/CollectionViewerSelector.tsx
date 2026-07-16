import type {
  KeyboardEvent,
  ReactElement,
  RefObject,
} from "react";
import {
  collectionSelectorFilterOperationFromKey,
  leaveCollectionSelectorFilter,
  moveCollectionSelectorSelection,
  selectCollectionSelectorItem,
  updateCollectionSelectorFilter,
  visibleCollectionSelectorItems,
  type CollectionSelectorOperation,
  type CollectionSelectorState,
} from "./CollectionSelector.ts";
import {
  collectionSelectorItemsForViewer,
  collectionViewerEntries,
  selectedCollectionViewerDocument,
  selectedCollectionViewerEntry,
  type CollectionViewerContent,
  type CollectionViewerDocument,
  type SelectedCollectionViewerEntry,
} from "./CollectionViewerSelectorModel.ts";

type CollectionViewerSelectorProps = Readonly<{
  viewer: CollectionViewerContent;
  state: CollectionSelectorState;
  filterInputRef: RefObject<HTMLInputElement | null>;
  onStateChange: (state: CollectionSelectorState) => void;
  onOpen: (document: CollectionViewerDocument) => void;
  onRestoreViewerFocus: () => void;
}>;

function CollectionTags({
  title,
  tags,
}: Readonly<{
  title: string;
  tags: ReadonlyArray<string>;
}>): ReactElement | null {
  if (tags.length === 0) {
    return null;
  }

  return (
    <ul className="mt-2 flex flex-wrap gap-x-2 text-xs text-text-muted" aria-label={`${title} tags`}>
      {tags.map((tag) => (
        <li key={tag}>#{tag}</li>
      ))}
    </ul>
  );
}

function SelectedCollectionDetail({
  selected,
  onOpen,
}: Readonly<{
  selected: SelectedCollectionViewerEntry;
  onOpen: (document: CollectionViewerDocument) => void;
}>): ReactElement | null {
  if (selected.kind === "none") {
    return null;
  }

  const entry = selected.entry;
  const documentTitle = entry.kind === "project"
    ? `${entry.title} README`
    : entry.title;
  const openLabel = entry.kind === "project"
    ? "Open README"
    : `Open ${entry.publicationKind === "blog" ? "post" : "note"}`;

  return (
    <section className="mt-3 border-t border-surface-border pt-3" aria-label="Selected item details">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold text-text-bright">{entry.title}</h3>
        {entry.kind === "project" ? (
          <span className="text-xs text-text-muted">{entry.repository}</span>
        ) : (
          <time className="text-xs text-text-muted" dateTime={entry.publishedAt}>
            {entry.publishedAt.slice(0, 10)}
          </time>
        )}
      </div>
      <p className="mt-2 text-text-primary">{entry.summary}</p>
      <CollectionTags title={entry.title} tags={entry.tags} />
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded border border-ui-accent px-2 py-1 text-text-bright focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-focus md:hidden"
          onClick={() => {
            onOpen({ title: documentTitle, document: entry.document });
          }}
        >
          {openLabel}
        </button>
        {entry.kind !== "project" || entry.repositoryUrl === undefined ? null : (
          <a
            className="text-text-bright underline decoration-surface-border underline-offset-4 hover:text-ui-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-focus"
            href={entry.repositoryUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Repository ↗
          </a>
        )}
      </div>
    </section>
  );
}

function emptyCollectionMessage(viewer: CollectionViewerContent): string {
  switch (viewer.kind) {
    case "project-gallery":
      return "No public projects are available.";
    case "publication-list":
      return viewer.publicationKind === "blog"
        ? "No blog posts are published."
        : "No public notes are published.";
  }
}

export function CollectionViewerSelector({
  viewer,
  state,
  filterInputRef,
  onStateChange,
  onOpen,
  onRestoreViewerFocus,
}: CollectionViewerSelectorProps): ReactElement {
  const entries = collectionViewerEntries(viewer);
  const items = collectionSelectorItemsForViewer(viewer);
  const visibleItems = visibleCollectionSelectorItems(items, state);
  const selected = selectedCollectionViewerEntry(entries, items, state);

  const applyFilterOperation = (operation: CollectionSelectorOperation): void => {
    switch (operation.kind) {
      case "move":
        onStateChange(moveCollectionSelectorSelection(state, items, operation.motion));
        return;
      case "open": {
        const target = selectedCollectionViewerDocument(viewer, state);

        if (target.kind === "selected") {
          onOpen(target.document);
        }
        return;
      }
      case "leave-filter":
        onStateChange(leaveCollectionSelectorFilter(state, items));
        onRestoreViewerFocus();
        return;
      case "begin-filter":
      case "return":
        return;
    }
  };

  const handleFilterKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
  ): void => {
    event.stopPropagation();
    const result = collectionSelectorFilterOperationFromKey({
      key: event.key,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
    });

    if (result.kind === "ignored") {
      return;
    }

    event.preventDefault();
    applyFilterOperation(result.operation);
  };

  if (entries.length === 0) {
    return (
      <p className="mt-3 text-text-muted" role="status">
        {emptyCollectionMessage(viewer)}
      </p>
    );
  }

  return (
    <div className="mt-3">
      {state.mode.kind === "filtering" ? (
        <label className="flex items-center gap-2 text-text-muted">
          <span>filter:</span>
          <input
            ref={filterInputRef}
            type="search"
            value={state.mode.query}
            className="min-w-0 flex-1 border-b border-surface-border bg-transparent px-1 py-0.5 text-text-primary outline-none focus:border-ui-focus"
            aria-label={`Filter ${viewer.title}`}
            onChange={(event) => {
              onStateChange(
                updateCollectionSelectorFilter(state, items, event.target.value),
              );
            }}
            onKeyDown={handleFilterKeyDown}
          />
        </label>
      ) : null}
      {visibleItems.length === 0 ? (
        <p className="mt-3 text-text-muted" role="status">
          No matches for “{state.mode.kind === "filtering" ? state.mode.query : ""}”.
        </p>
      ) : (
        <ul className="mt-2 space-y-1" role="listbox" aria-label={`${viewer.title} selector`}>
          {visibleItems.map((item) => {
            const entry = entries.find((candidate) => candidate.id === item.id);

            if (entry === undefined) {
              return null;
            }

            const isSelected =
              selected.kind === "selected" && selected.entry.id === entry.id;

            return (
              <li
                key={entry.id}
                role="option"
                aria-selected={isSelected}
                className={isSelected
                  ? "flex cursor-pointer gap-2 bg-surface-selected px-2 py-1 text-text-bright"
                  : "flex cursor-pointer gap-2 px-2 py-1 text-text-primary"}
                onClick={() => {
                  onStateChange(selectCollectionSelectorItem(state, items, entry.id));
                }}
              >
                <span className="w-2 shrink-0 text-ui-accent" aria-hidden="true">
                  {isSelected ? ">" : ""}
                </span>
                <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                <span className="shrink-0 text-xs text-text-muted">
                  {entry.rowMetadata}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <SelectedCollectionDetail selected={selected} onOpen={onOpen} />
      <p className="mt-3 text-xs text-text-muted" role="status">
        {state.mode.kind === "filtering"
          ? `${visibleItems.length}/${items.length} · ↑/↓ move · Enter open · Esc clear filter`
          : `${visibleItems.length} items · j/k or ↑/↓ move · g/G ends · Enter open · / filter · Esc/q return`}
      </p>
    </div>
  );
}
