import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
} from "react";
import {
  viewerTitle,
  type ViewerContent,
} from "../../content/ViewerContent.ts";
import {
  MarkdownRenderer,
  markdownBlockCount,
  markdownSearchMatches,
} from "../../content/MarkdownRenderer.ts";
import {
  applyRawPagerOperation,
  createRawPagerState,
  rawPagerPageLines,
  rawPagerStatus,
  type RawPagerOperation,
} from "../../domain/viewer/RawPager.ts";
import type { InputCapturePaneKeyInput } from "../terminal/InputCapture";
import type { InputCapturePaneKeyResult } from "../terminal/InputCapture";
import { MobilePaneControls, type MobilePaneControl } from "./MobilePaneControls";
import {
  createMarkdownViewerPosition,
  markdownViewerOperationFromKey,
  markdownViewerPositionStatus,
  moveMarkdownViewerPosition,
  setMarkdownViewerPosition,
  type MarkdownViewerMotion,
  type MarkdownViewerOperation,
} from "./MarkdownViewerNavigation.ts";
import { restoreMarkdownViewerFocus } from "./MarkdownViewerFocus.ts";
import {
  beginMarkdownViewerSearch,
  createMarkdownViewerSearch,
  cycleMarkdownViewerSearch,
  markdownViewerSearchStatus,
  submitMarkdownViewerSearch as transitionMarkdownViewerSearch,
  updateMarkdownViewerSearch,
  type MarkdownViewerSearch,
} from "./MarkdownViewerSearch.ts";
import type { MobileCtrlInputResolution } from "./MobileCtrlModifier.ts";
import {
  beginCollectionSelectorFilter,
  collectionSelectorBrowseOperationFromKey,
  createCollectionSelectorState,
  leaveCollectionSelectorFilter,
  moveCollectionSelectorSelection,
  type CollectionSelectorOperation,
  type CollectionSelectorState,
} from "./CollectionSelector.ts";
import { CollectionViewerSelector } from "./CollectionViewerSelector.tsx";
import {
  collectionSelectorItemsForViewer,
  selectedCollectionViewerDocument,
  type CollectionViewerContent,
  type CollectionViewerDocument,
} from "./CollectionViewerSelectorModel.ts";
import { handleViewerPaneKeyInput } from "./ViewerPaneKeyHandler.ts";

type ViewerPaneProps = Readonly<{
  viewer: ViewerContent;
  isActive: boolean;
  focusVersion: number;
  onActivate: () => void;
  onPaneKeyInput: (
    input: InputCapturePaneKeyInput,
  ) => InputCapturePaneKeyResult;
  mobileCtrlPressed: boolean;
  onToggleMobileCtrl: () => void;
  onConsumeMobileCtrl: () => void;
  resolveMobileCtrlInput: (
    input: InputCapturePaneKeyInput,
  ) => MobileCtrlInputResolution;
  onClose?: () => void;
}>;

function ViewerNavigationStatusLine({
  mode,
  documentIdentity,
  position,
  match,
}: Readonly<{
  mode: "NORMAL" | "SEARCH";
  documentIdentity: string;
  position: string;
  match: string;
}>): ReactElement {
  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-x-3 border-t border-surface-border bg-surface-raised px-4 py-1 text-xs text-text-muted"
      role="status"
      aria-live="polite"
      aria-label="Viewer navigation status"
    >
      <span className="font-semibold text-ui-accent">{mode}</span>
      <span className="min-w-0 truncate text-text-bright">{documentIdentity}</span>
      <span>{position}</span>
      <span>{match}</span>
    </div>
  );
}

function collectionViewerContent(
  viewer: ViewerContent,
): CollectionViewerContent | undefined {
  switch (viewer.kind) {
    case "project-gallery":
    case "publication-list":
      return viewer;
    case "placeholder":
    case "document":
    case "directory":
      return undefined;
  }
}

export function ViewerPane({
  viewer,
  isActive,
  focusVersion,
  onActivate,
  onPaneKeyInput,
  mobileCtrlPressed,
  onToggleMobileCtrl,
  onConsumeMobileCtrl,
  resolveMobileCtrlInput,
  onClose,
}: ViewerPaneProps): ReactElement {
  const viewerRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const collectionFilterInputRef = useRef<HTMLInputElement | null>(null);
  const collectionViewer = collectionViewerContent(viewer);
  const collectionItems = collectionViewer === undefined
    ? []
    : collectionSelectorItemsForViewer(collectionViewer);
  const [openedDocument, setOpenedDocument] =
    useState<CollectionViewerDocument>();
  const [collectionSelector, setCollectionSelector] =
    useState<CollectionSelectorState>(() =>
      createCollectionSelectorState(collectionItems)
    );
  const activeViewer: ViewerContent =
    openedDocument === undefined
      ? viewer
      : {
          kind: "document",
          title: openedDocument.title,
          presentation: "inline",
          document: openedDocument.document,
        };
  const title = viewerTitle(activeViewer);
  const isRawPager =
    activeViewer.kind === "document" &&
    activeViewer.presentation === "raw-pager";
  const markdownDocument =
    activeViewer.kind === "document" && activeViewer.presentation === "inline"
      ? activeViewer.document
      : undefined;
  const rawText =
    activeViewer.kind === "document" &&
    activeViewer.presentation === "raw-pager"
      ? activeViewer.document.text
      : "";
  const markdownBlocks = markdownDocument === undefined
    ? 0
    : markdownBlockCount(markdownDocument);
  const [rawPagerState, setRawPagerState] = useState(() =>
    createRawPagerState(rawText),
  );
  const [markdownPosition, setMarkdownPosition] = useState(() =>
    createMarkdownViewerPosition(markdownBlocks),
  );
  const [markdownSearch, setMarkdownSearch] = useState<MarkdownViewerSearch>(
    createMarkdownViewerSearch,
  );
  const searchMatches =
    markdownDocument === undefined || markdownSearch.kind !== "active"
      ? []
      : markdownSearchMatches(markdownDocument, markdownSearch.query);
  const markdownPositionStatus = markdownViewerPositionStatus(markdownPosition);
  const activeBlockIndex = markdownPositionStatus.kind === "block"
    ? markdownPositionStatus.currentBlock - 1
    : undefined;

  useEffect(() => {
    if (isActive) {
      viewerRef.current?.focus({ preventScroll: true });
    }
  }, [focusVersion, isActive]);

  useEffect(() => {
    const nextCollectionViewer = collectionViewerContent(viewer);
    const nextCollectionItems = nextCollectionViewer === undefined
      ? []
      : collectionSelectorItemsForViewer(nextCollectionViewer);

    setOpenedDocument(undefined);
    setCollectionSelector(createCollectionSelectorState(nextCollectionItems));
  }, [viewer]);

  useEffect(() => {
    setRawPagerState(createRawPagerState(rawText));
    setMarkdownPosition(createMarkdownViewerPosition(markdownBlocks));
    setMarkdownSearch(createMarkdownViewerSearch());
  }, [markdownBlocks, markdownDocument?.text, rawText]);

  useEffect(() => {
    if (markdownSearch.kind === "editing") {
      searchInputRef.current?.focus();
    }
  }, [markdownSearch]);

  useEffect(() => {
    if (
      !isActive ||
      openedDocument !== undefined ||
      collectionViewer === undefined ||
      collectionSelector.mode.kind !== "filtering"
    ) {
      return;
    }

    collectionFilterInputRef.current?.focus();
  }, [collectionSelector.mode.kind, collectionViewer, isActive, openedDocument]);

  useEffect(() => {
    if (activeBlockIndex === undefined) {
      return;
    }

    const match = contentRef.current?.querySelector<HTMLElement>(
      `[data-markdown-block-index="${activeBlockIndex}"]`,
    );
    match?.scrollIntoView({ block: "center" });
  }, [activeBlockIndex]);

  const closeActiveViewer =
    openedDocument === undefined
      ? onClose
      : (): void => {
          setOpenedDocument(undefined);
          viewerRef.current?.focus({ preventScroll: true });
        };

  const applyPagerOperation = (operation: RawPagerOperation): void => {
    if (operation.kind === "quit") {
      closeActiveViewer?.();
      return;
    }

    setRawPagerState((current) => {
      const transition = applyRawPagerOperation(current, operation);
      return transition.kind === "updated" ? transition.state : current;
    });
  };

  const applyMarkdownMotion = (motion: MarkdownViewerMotion): void => {
    const pageBlockCount = Math.max(
      1,
      Math.floor((contentRef.current?.clientHeight ?? 40) / 40),
    );

    setMarkdownPosition((current) =>
      moveMarkdownViewerPosition(current, motion, pageBlockCount)
    );
  };

  const applyMarkdownOperation = (operation: MarkdownViewerOperation): void => {
    switch (operation.kind) {
      case "line-up":
      case "line-down":
      case "page-up":
      case "page-down":
      case "top":
      case "bottom":
        applyMarkdownMotion(operation);
        return;
      case "search":
        setMarkdownSearch(beginMarkdownViewerSearch());
        return;
      case "search-next":
      case "search-previous":
        if (markdownSearch.kind !== "active" || searchMatches.length === 0) {
          return;
        }

        const direction = operation.kind === "search-next" ? 1 : -1;
        const transition = cycleMarkdownViewerSearch(
          markdownSearch,
          searchMatches,
          direction,
        );

        setMarkdownSearch(transition.search);

        const matchedBlockIndex = transition.matchedBlockIndex;

        if (matchedBlockIndex !== undefined) {
          setMarkdownPosition((position) =>
            setMarkdownViewerPosition(position, matchedBlockIndex)
          );
        }
    }
  };

  const submitMarkdownSearch = (): void => {
    if (markdownSearch.kind !== "editing") {
      return;
    }

    const query = markdownSearch.query.trim();
    const matches = markdownDocument === undefined
      ? []
      : markdownSearchMatches(markdownDocument, query);
    const transition = transitionMarkdownViewerSearch(markdownSearch, matches);

    setMarkdownSearch(transition.search);

    const matchedBlockIndex = transition.matchedBlockIndex;

    if (matchedBlockIndex !== undefined) {
      setMarkdownPosition((position) =>
        setMarkdownViewerPosition(position, matchedBlockIndex)
      );
    }

    restoreMarkdownViewerFocus(viewerRef.current);
  };

  const cancelMarkdownSearch = (): void => {
    setMarkdownSearch(createMarkdownViewerSearch());
    restoreMarkdownViewerFocus(viewerRef.current);
  };

  const restoreViewerFocus = (): void => {
    viewerRef.current?.focus({ preventScroll: true });
  };

  const openCollectionDocument = (
    document: CollectionViewerDocument,
  ): void => {
    setOpenedDocument(document);
    restoreViewerFocus();
  };

  const applyCollectionSelectorOperation = (
    operation: CollectionSelectorOperation,
  ): InputCapturePaneKeyResult => {
    if (collectionViewer === undefined || openedDocument !== undefined) {
      return { kind: "unhandled" };
    }

    switch (operation.kind) {
      case "move":
        setCollectionSelector((current) =>
          moveCollectionSelectorSelection(
            current,
            collectionItems,
            operation.motion,
          )
        );
        return { kind: "handled" };
      case "open": {
        const target = selectedCollectionViewerDocument(
          collectionViewer,
          collectionSelector,
        );

        if (target.kind === "none") {
          return { kind: "handled" };
        }

        openCollectionDocument(target.document);
        return { kind: "handled" };
      }
      case "begin-filter":
        setCollectionSelector((current) =>
          beginCollectionSelectorFilter(current)
        );
        return { kind: "handled" };
      case "leave-filter":
        setCollectionSelector((current) =>
          leaveCollectionSelectorFilter(current, collectionItems)
        );
        restoreViewerFocus();
        return { kind: "handled" };
      case "return":
        if (closeActiveViewer === undefined) {
          return { kind: "unhandled" };
        }

        closeActiveViewer();
        return { kind: "handled" };
    }
  };

  const handleSearchInputKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
  ): void => {
    event.stopPropagation();

    if (event.key !== "Escape") {
      return;
    }

    event.preventDefault();
    cancelMarkdownSearch();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (
      event.target instanceof HTMLButtonElement ||
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLAnchorElement
    ) {
      return;
    }

    const mobileCtrlInput = resolveMobileCtrlInput({
      key: event.key,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
    });
    const input = mobileCtrlInput.input;
    let defaultPrevented = false;

    handleViewerPaneKeyInput({
      input: isRawPager
        ? {
            kind: "raw-pager",
            key: input.key,
            altKey: event.altKey,
            ctrlKey: input.ctrlKey,
            metaKey: input.metaKey,
          }
        : {
            kind: "viewer",
            key: input.key,
            ctrlKey: input.ctrlKey,
            metaKey: input.metaKey,
          },
      onPaneKeyInput,
      onClose: closeActiveViewer,
      onViewerKeyInput:
        collectionViewer === undefined || openedDocument !== undefined
          ? undefined
          : (viewerInput) => {
              const result = collectionSelectorBrowseOperationFromKey({
                key: viewerInput.key,
                altKey: event.altKey,
                ctrlKey: viewerInput.ctrlKey,
                metaKey: viewerInput.metaKey,
              });

              return result.kind === "ignored"
                ? { kind: "unhandled" }
                : applyCollectionSelectorOperation(result.operation);
            },
      onPagerOperation: applyPagerOperation,
      preventDefault: () => {
        defaultPrevented = true;
        event.preventDefault();
      },
    });

    if (
      !defaultPrevented &&
      markdownDocument !== undefined &&
      markdownSearch.kind !== "editing"
    ) {
      const markdownKey = markdownViewerOperationFromKey(input);

      if (markdownKey.kind === "handled") {
        defaultPrevented = true;
        event.preventDefault();
        applyMarkdownOperation(markdownKey.operation);
      }
    }

    if (mobileCtrlInput.mobileCtrlApplied && !defaultPrevented) {
      event.preventDefault();
    }
  };

  const handleClick = (event: MouseEvent<HTMLElement>): void => {
    if (
      event.target instanceof HTMLButtonElement ||
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLAnchorElement
    ) {
      return;
    }

    onActivate();
    viewerRef.current?.focus({ preventScroll: true });
  };

  const triggerPrefix = (): void => {
    onPaneKeyInput({
      key: "b",
      ctrlKey: true,
      metaKey: false,
    });
  };

  const handleMobileControl = (
    control: MobilePaneControl,
    ctrlKey: boolean,
  ): void => {
    if (ctrlKey) {
      return;
    }

    if (collectionViewer !== undefined && openedDocument === undefined) {
      switch (control) {
        case "escape":
          if (collectionSelector.mode.kind === "filtering") {
            setCollectionSelector((current) =>
              leaveCollectionSelectorFilter(current, collectionItems)
            );
            restoreViewerFocus();
            return;
          }

          closeActiveViewer?.();
          return;
        case "up":
          setCollectionSelector((current) =>
            moveCollectionSelectorSelection(
              current,
              collectionItems,
              "previous",
            )
          );
          return;
        case "down":
          setCollectionSelector((current) =>
            moveCollectionSelectorSelection(current, collectionItems, "next")
          );
          return;
        case "tab":
        case "left":
        case "right":
          return;
      }
    }

    if (isRawPager) {
      switch (control) {
        case "escape":
          applyPagerOperation({ kind: "quit" });
          return;
        case "up":
          applyPagerOperation({ kind: "line-up" });
          return;
        case "down":
          applyPagerOperation({ kind: "line-down" });
          return;
        case "tab":
        case "left":
        case "right":
          return;
      }
    }

    if (markdownDocument !== undefined) {
      switch (control) {
        case "escape":
          closeActiveViewer?.();
          return;
        case "up":
          applyMarkdownOperation({ kind: "line-up" });
          return;
        case "down":
          applyMarkdownOperation({ kind: "line-down" });
          return;
        case "tab":
        case "left":
        case "right":
          return;
      }
    }

    if (control === "escape") {
      closeActiveViewer?.();
    }
  };

  const content = (() => {
    switch (activeViewer.kind) {
      case "placeholder":
        return (
          <p className="mt-2 whitespace-pre-wrap wrap-break-words text-text-bright">
            Viewer placeholder. Content rendering arrives with the Markdown work.
          </p>
        );
      case "document":
        if (activeViewer.presentation === "raw-pager") {
          return (
            <>
              <pre
                className="mt-2 whitespace-pre-wrap wrap-break-words text-text-bright"
                aria-label="Current raw pager page"
              >
                {rawPagerPageLines(activeViewer.document.text, rawPagerState)
                  .map((line) => (
                    <span
                      key={line.lineNumber}
                      className={line.isCurrent ? "bg-surface-highlight text-ui-accent" : undefined}
                      aria-current={line.isCurrent ? "true" : undefined}
                    >
                      {line.text}
                    </span>
                  ))}
              </pre>
              <p className="mt-3 text-xs text-text-muted">
                ↑/↓ or j/k move · PageUp/b and PageDown/Space page · g/G jump · Esc/q return
              </p>
            </>
          );
        }

        return (
          <>
            {markdownSearch.kind === "editing" ? (
              <form
                className="mt-3 flex items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  submitMarkdownSearch();
                }}
              >
                <label className="text-text-muted" htmlFor="markdown-search">
                  /
                </label>
                <input
                  ref={searchInputRef}
                  id="markdown-search"
                  type="search"
                  value={markdownSearch.query}
                  className="min-w-0 flex-1 rounded border border-surface-border bg-surface-deepest px-2 py-1 text-text-primary outline-none focus:border-ui-focus"
                  aria-label="Search Markdown"
                  onChange={(event) => {
                    setMarkdownSearch(updateMarkdownViewerSearch(event.target.value));
                  }}
                  onKeyDown={handleSearchInputKeyDown}
                />
                <button
                  type="submit"
                  className="rounded border border-surface-border px-2 py-1 text-text-bright hover:border-ui-accent hover:text-ui-accent"
                >
                  Find
                </button>
              </form>
            ) : null}
            <MarkdownRenderer
              document={activeViewer.document}
              activeBlockIndex={activeBlockIndex}
            />
            <p className="mt-3 text-xs text-text-muted">
              ↑/↓ or j/k move · PageUp/b and PageDown/Space page · g/G jump · / search · n/N results · Esc/q return
            </p>
          </>
        );
      case "directory":
        return (
          <>
            <p className="mt-2 text-text-muted">{activeViewer.path}</p>
            <ul className="mt-2 space-y-1 text-text-bright">
              {activeViewer.entries.map((entry) => (
                <li key={entry.name}>
                  {entry.kind === "directory" ? `${entry.name}/` : entry.name}
                  {entry.kind === "locked-file" ? " [locked]" : ""}
                </li>
              ))}
            </ul>
          </>
        );
      case "project-gallery":
      case "publication-list":
        return (
          <CollectionViewerSelector
            viewer={activeViewer}
            state={collectionSelector}
            filterInputRef={collectionFilterInputRef}
            onStateChange={setCollectionSelector}
            onOpen={openCollectionDocument}
            onRestoreViewerFocus={restoreViewerFocus}
          />
        );
    }
  })();

  return (
    <section
      ref={viewerRef}
      className="flex h-full min-h-0 flex-col bg-surface-deepest font-mono text-sm text-text-primary outline-none"
      tabIndex={0}
      aria-label={title + " viewer"}
      onFocus={onActivate}
      onKeyDown={handleKeyDown}
      onClick={handleClick}
    >
      <div ref={contentRef} className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-ui-accent">{title}</h2>
          {closeActiveViewer === undefined ? null : (
            <button
              type="button"
              className="rounded border border-surface-border px-2 py-1 text-text-bright hover:border-ui-accent hover:text-ui-accent"
              onClick={closeActiveViewer}
            >
              {openedDocument === undefined ? "Return" : "Back"}
            </button>
          )}
        </div>
        {content}
      </div>
      {activeViewer.kind !== "document" ? null : (() => {
        if (activeViewer.presentation === "raw-pager") {
          const status = rawPagerStatus(rawPagerState);
          const position = status.kind === "empty"
            ? "No lines"
            : `Line ${status.currentLine}/${status.totalLines}`;

          return (
            <ViewerNavigationStatusLine
              mode="NORMAL"
              documentIdentity={title}
              position={position}
              match="No search"
            />
          );
        }

        const position = markdownPositionStatus.kind === "empty"
          ? "No blocks"
          : `Block ${markdownPositionStatus.currentBlock}/${markdownPositionStatus.totalBlocks}`;
        const searchStatus = markdownViewerSearchStatus(
          markdownSearch,
          searchMatches.length,
        );

        return (
          <ViewerNavigationStatusLine
            mode={searchStatus.mode}
            documentIdentity={title}
            position={position}
            match={searchStatus.match}
          />
        );
      })()}
      <MobilePaneControls
        ctrlPressed={mobileCtrlPressed}
        onCtrlToggle={onToggleMobileCtrl}
        onCtrlConsumed={onConsumeMobileCtrl}
        onControl={handleMobileControl}
        onPrefix={triggerPrefix}
      />
    </section>
  );
}
