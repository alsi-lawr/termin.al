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
import type { ContentId } from "../../api/ContentContracts.ts";
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
import { MarkdownViewerSearchForm } from "./MarkdownViewerSearchForm.tsx";
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
import { lessPrompt } from "./LessPrompt.ts";
import { HierarchicalCollectionPane } from "./HierarchicalCollectionPane.tsx";
import { handleViewerPaneKeyInput } from "./ViewerPaneKeyHandler.ts";
import {
  createVimBuffer,
  VimCapability,
  VimMode,
  type VimBuffer,
} from "../../domain/vim/VimBuffer.ts";
import { VimEditorPane } from "./VimEditorPane.tsx";

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
  onAcceptedContentOpen: (contentId: ContentId) => void;
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

type ViManpagerProps = Readonly<{
  title: string;
  text: string;
  documentIdentity: string;
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

function ViManpager({
  title,
  text,
  documentIdentity,
  isActive,
  focusVersion,
  onActivate,
  onPaneKeyInput,
  mobileCtrlPressed,
  onToggleMobileCtrl,
  onConsumeMobileCtrl,
  resolveMobileCtrlInput,
  onClose,
}: ViManpagerProps): ReactElement {
  const [buffer, setBuffer] = useState(() =>
    createVimBuffer({
      text,
      mode: VimMode.Normal,
      capability: VimCapability.ReadOnly,
    }),
  );

  useEffect(() => {
    setBuffer(createVimBuffer({
      text,
      mode: VimMode.Normal,
      capability: VimCapability.ReadOnly,
    }));
  }, [documentIdentity, text]);

  const applyBuffer = (next: VimBuffer): void => {
    if (
      next.commandEffect.kind === "quit" ||
      next.commandEffect.kind === "force-quit"
    ) {
      onClose?.();
      return;
    }

    setBuffer(next);
  };

  return (
    <VimEditorPane
      title={title}
      buffer={buffer}
      isActive={isActive}
      focusVersion={focusVersion}
      onBufferChange={applyBuffer}
      onActivate={onActivate}
      onPaneKeyInput={onPaneKeyInput}
      mobileCtrlPressed={mobileCtrlPressed}
      onToggleMobileCtrl={onToggleMobileCtrl}
      onConsumeMobileCtrl={onConsumeMobileCtrl}
      resolveMobileCtrlInput={resolveMobileCtrlInput}
    />
  );
}

export function ViewerPane(props: ViewerPaneProps): ReactElement {
  if (props.viewer.kind !== "collection") {
    return <StandardViewerPane {...props} viewer={props.viewer} />;
  }

  return (
    <HierarchicalCollectionPane
      collection={props.viewer}
      presentation={{ kind: "split-pane" }}
      isActive={props.isActive}
      focusVersion={props.focusVersion}
      onActivate={props.onActivate}
      onPaneKeyInput={props.onPaneKeyInput}
      onCancel={props.onClose ?? (() => undefined)}
      onAcceptedContentOpen={props.onAcceptedContentOpen}
      renderDocument={(leaf, onReturn) => (
        <StandardViewerPane
          {...props}
          viewer={{
            kind: "document",
            title: leaf.documentTitle,
            presentation: "inline",
            document: leaf.document,
            statsIdentity: leaf.statsIdentity,
          }}
          onClose={onReturn}
        />
      )}
    />
  );
}

function StandardViewerPane({
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
}: ViewerPaneProps & Readonly<{ viewer: Exclude<ViewerContent, { kind: "collection" }> }>): ReactElement {
  const viewerRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const activeViewer = viewer;
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
    if (activeBlockIndex === undefined) {
      return;
    }

    const match = contentRef.current?.querySelector<HTMLElement>(
      `[data-markdown-block-index="${activeBlockIndex}"]`,
    );
    match?.scrollIntoView({ block: "center" });
  }, [activeBlockIndex]);

  const closeActiveViewer = onClose;

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
      onViewerKeyInput: undefined,
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

  if (
    activeViewer.kind === "document" &&
    activeViewer.presentation === "raw-pager"
  ) {
    const status = rawPagerStatus(rawPagerState);
    const pageText = rawPagerPageLines(
      activeViewer.document.text,
      rawPagerState,
    )
      .map((line) => line.text)
      .join("");

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
        <div ref={contentRef} className="min-h-0 flex-1 overflow-y-auto">
          <pre
            className="min-h-full whitespace-pre-wrap wrap-break-words text-text-bright"
            aria-label="Current less page"
          >
            {pageText}
          </pre>
        </div>
        <div
          className="shrink-0 bg-text-primary px-1 text-surface-deepest"
          role="status"
          aria-live="polite"
          aria-label="Less prompt"
        >
          {lessPrompt(title, status)}
        </div>
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

  if (
    activeViewer.kind === "document" &&
    activeViewer.presentation === "vi-manpager"
  ) {
    const documentIdentity = `${activeViewer.title}\u0000${activeViewer.document.source.path}`;

    return (
      <ViManpager
        title={title}
        text={activeViewer.document.text}
        documentIdentity={documentIdentity}
        isActive={isActive}
        focusVersion={focusVersion}
        onActivate={onActivate}
        onPaneKeyInput={onPaneKeyInput}
        mobileCtrlPressed={mobileCtrlPressed}
        onToggleMobileCtrl={onToggleMobileCtrl}
        onConsumeMobileCtrl={onConsumeMobileCtrl}
        resolveMobileCtrlInput={resolveMobileCtrlInput}
        onClose={closeActiveViewer}
      />
    );
  }

  const content = (() => {
    switch (activeViewer.kind) {
      case "placeholder":
        return (
          <p className="mt-2 whitespace-pre-wrap wrap-break-words text-text-bright">
            Viewer placeholder. Content rendering arrives with the Markdown work.
          </p>
        );
      case "document":
        return (
          <>
            {markdownSearch.kind === "editing" ? (
              <MarkdownViewerSearchForm
                inputRef={searchInputRef}
                query={markdownSearch.query}
                onQueryChange={(query) => {
                  setMarkdownSearch(updateMarkdownViewerSearch(query));
                }}
                onSubmit={submitMarkdownSearch}
                onCancel={cancelMarkdownSearch}
              />
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
              className="rounded border border-surface-border px-2 py-1 text-text-bright hover:border-ui-accent hover:text-ui-accent md:hidden"
              onClick={closeActiveViewer}
            >
              Return
            </button>
          )}
        </div>
        {content}
      </div>
      {activeViewer.kind !== "document" ? null : (() => {
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
