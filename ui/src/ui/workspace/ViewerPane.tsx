import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type RefObject,
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
  rawPagerLogicalLines,
  rawPagerPageLines,
  rawPagerStatus,
  resizeRawPagerCapacity,
  type RawPagerOperation,
  type RawPagerLogicalLine,
  type RawPagerState,
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
import type { VimSessionBinding } from "./VimSessionState.ts";

type ViewerPaneProps = Readonly<{
  viewer: ViewerContent;
  isActive: boolean;
  focusVersion: number;
  onActivate: () => void;
  onPaneKeyInput: (
    input: InputCapturePaneKeyInput,
  ) => InputCapturePaneKeyResult;
  mobileCtrlPressed: boolean;
  vimSession: VimSessionBinding;
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
  vimSession: VimSessionBinding;
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
  vimSession,
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
      syntax={{ kind: "plain" }}
      isActive={isActive}
      focusVersion={focusVersion}
      onBufferChange={applyBuffer}
      onActivate={onActivate}
      onPaneKeyInput={onPaneKeyInput}
      mobileCtrlPressed={mobileCtrlPressed}
      vimSession={vimSession}
      onToggleMobileCtrl={onToggleMobileCtrl}
      onConsumeMobileCtrl={onConsumeMobileCtrl}
      resolveMobileCtrlInput={resolveMobileCtrlInput}
    />
  );
}

function LessPagerMeasurement({
  measurementRef,
  lines,
}: Readonly<{
  measurementRef: RefObject<HTMLPreElement | null>;
  lines: ReadonlyArray<RawPagerLogicalLine>;
}>): ReactElement {
  return (
    <div className="invisible h-0 overflow-hidden" aria-hidden="true">
      <pre
        ref={measurementRef}
        className="whitespace-pre-wrap wrap-break-words text-text-bright"
      >
        {lines.map((line) => (
          <span
            key={line.lineNumber}
            className="block"
            data-raw-pager-measure-line=""
          >
            {line.text}
          </span>
        ))}
      </pre>
    </div>
  );
}

function resizeLessPagerToContent(
  contentElement: HTMLDivElement,
  measurementElement: HTMLPreElement,
  state: RawPagerState,
): RawPagerState {
  const status = rawPagerStatus(state);

  if (status.kind === "empty") {
    return state;
  }

  const lineElements = measurementElement.children;

  if (lineElements.length !== status.totalLines) {
    return state;
  }

  const availableHeight = contentElement.clientHeight;

  if (!Number.isFinite(availableHeight) || availableHeight <= 0) {
    return state;
  }

  let usedHeight = 0;
  let capacity = 0;
  let nextLineIndex = status.firstLine - 1;

  while (nextLineIndex < lineElements.length) {
    const lineElement = lineElements.item(nextLineIndex);

    if (!(lineElement instanceof HTMLElement)) {
      return state;
    }

    const lineHeight = lineElement.getBoundingClientRect().height;

    if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
      return state;
    }

    if (
      capacity > 0 &&
      usedHeight + lineHeight > availableHeight
    ) {
      break;
    }

    usedHeight += lineHeight;
    capacity += 1;
    nextLineIndex += 1;

    if (usedHeight >= availableHeight) {
      break;
    }
  }

  const reachedDocumentEnd = nextLineIndex === lineElements.length;

  if (reachedDocumentEnd && usedHeight < availableHeight) {
    for (let index = status.firstLine - 2; index >= 0; index -= 1) {
      const lineElement = lineElements.item(index);

      if (!(lineElement instanceof HTMLElement)) {
        return state;
      }

      const lineHeight = lineElement.getBoundingClientRect().height;

      if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
        return state;
      }

      if (usedHeight + lineHeight > availableHeight) {
        break;
      }

      usedHeight += lineHeight;
      capacity += 1;

      if (usedHeight >= availableHeight) {
        break;
      }
    }
  }

  return capacity === 0 ? state : resizeRawPagerCapacity(state, capacity);
}

function githubMarkdownRoot(
  contentElement: HTMLDivElement | null,
): HTMLElement | undefined {
  return contentElement?.querySelector<HTMLElement>("[data-github-markdown]") ??
    undefined;
}

function githubMarkdownBlocks(root: HTMLElement): ReadonlyArray<HTMLElement> {
  return Array.from(root.children).filter(
    (element): element is HTMLElement => element instanceof HTMLElement,
  );
}

function searchableTextNodes(root: HTMLElement): ReadonlyArray<Text> {
  const walker = root.ownerDocument.createTreeWalker(root, 4);
  const nodes: Array<Text> = [];
  let current = walker.nextNode();

  while (current !== null) {
    if (
      current instanceof Text &&
      current.parentElement?.closest("script, style, [aria-hidden=\"true\"]") === null
    ) {
      nodes.push(current);
    }

    current = walker.nextNode();
  }

  return nodes;
}

function textMatchOffsets(text: string, query: string): ReadonlyArray<number> {
  const normalizedText = text.toLowerCase();
  const normalizedQuery = query.toLowerCase();
  const offsets: Array<number> = [];
  let offset = 0;

  while (offset <= normalizedText.length - normalizedQuery.length) {
    const match = normalizedText.indexOf(normalizedQuery, offset);

    if (match < 0) {
      break;
    }

    offsets.push(match);
    offset = match + normalizedQuery.length;
  }

  return offsets;
}

function renderedMarkdownSearchMatches(
  root: HTMLElement,
  query: string,
): ReadonlyArray<number> {
  const normalizedQuery = query.trim();

  if (normalizedQuery === "") {
    return [];
  }

  const matches: Array<number> = [];

  for (const [blockIndex, block] of githubMarkdownBlocks(root).entries()) {
    for (const node of searchableTextNodes(block)) {
      for (const _ of textMatchOffsets(node.data, normalizedQuery)) {
        matches.push(blockIndex);
      }
    }
  }

  return matches;
}

function clearRenderedMarkdownSearchHighlights(root: HTMLElement): void {
  const highlights = Array.from(
    root.querySelectorAll<HTMLElement>("mark[data-markdown-search-match]"),
  );

  for (const highlight of highlights) {
    highlight.replaceWith(
      root.ownerDocument.createTextNode(highlight.textContent ?? ""),
    );
  }

  root.normalize();
}

function highlightRenderedMarkdownSearch(
  root: HTMLElement,
  query: string,
  currentMatchIndex: number,
): HTMLElement | undefined {
  clearRenderedMarkdownSearchHighlights(root);

  const normalizedQuery = query.trim();

  if (normalizedQuery === "") {
    return undefined;
  }

  let matchIndex = 0;
  let currentMatch: HTMLElement | undefined;

  for (const node of searchableTextNodes(root)) {
    const offsets = textMatchOffsets(node.data, normalizedQuery);

    if (offsets.length === 0) {
      continue;
    }

    const fragment = root.ownerDocument.createDocumentFragment();
    let textOffset = 0;

    for (const offset of offsets) {
      fragment.append(node.data.slice(textOffset, offset));

      const highlight = root.ownerDocument.createElement("mark");
      highlight.dataset.markdownSearchMatch = String(matchIndex);
      highlight.textContent = node.data.slice(
        offset,
        offset + normalizedQuery.length,
      );

      if (matchIndex === currentMatchIndex) {
        highlight.dataset.markdownCurrentSearch = "true";
        currentMatch = highlight;
      }

      fragment.append(highlight);
      textOffset = offset + normalizedQuery.length;
      matchIndex += 1;
    }

    fragment.append(node.data.slice(textOffset));
    node.replaceWith(fragment);
  }

  return currentMatch;
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
  vimSession,
  onToggleMobileCtrl,
  onConsumeMobileCtrl,
  resolveMobileCtrlInput,
  onClose,
}: ViewerPaneProps & Readonly<{ viewer: Exclude<ViewerContent, { kind: "collection" }> }>): ReactElement {
  const viewerRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const rawPagerMeasurementRef = useRef<HTMLPreElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const markdownGPrefixRef = useRef(false);
  const activeViewer = viewer;
  const title = viewerTitle(activeViewer);
  const isRawPager =
    activeViewer.kind === "document" &&
    activeViewer.presentation === "raw-pager";
  const markdownDocument =
    activeViewer.kind === "document" && activeViewer.presentation === "inline"
      ? activeViewer.document
      : undefined;
  const githubPreviewHtml = markdownDocument?.preview.kind === "github-html"
    ? markdownDocument.preview.html
    : "";
  const rawText =
    activeViewer.kind === "document" &&
    activeViewer.presentation === "raw-pager"
      ? activeViewer.document.text
      : "";
  const rawLogicalLines = rawPagerLogicalLines(rawText);
  const sourceMarkdownBlocks = markdownDocument === undefined
    ? 0
    : markdownBlockCount(markdownDocument);
  const [renderedMarkdownBlocks, setRenderedMarkdownBlocks] = useState<
    number | undefined
  >();
  const markdownBlocks = githubPreviewHtml === ""
    ? sourceMarkdownBlocks
    : renderedMarkdownBlocks ?? sourceMarkdownBlocks;
  const [rawPagerState, setRawPagerState] = useState(() =>
    createRawPagerState(rawText),
  );
  const rawPagerStateRef = useRef(rawPagerState);
  const rawPagerStateStatus = rawPagerStatus(rawPagerState);
  const rawPagerLineOffset = rawPagerStateStatus.kind === "range"
    ? rawPagerStateStatus.firstLine - 1
    : 0;
  const [markdownPosition, setMarkdownPosition] = useState(() =>
    createMarkdownViewerPosition(markdownBlocks),
  );
  const [markdownSearch, setMarkdownSearch] = useState<MarkdownViewerSearch>(
    createMarkdownViewerSearch,
  );
  const searchMatches =
    markdownDocument === undefined || markdownSearch.kind !== "active"
      ? []
      : (() => {
          const root = githubMarkdownRoot(contentRef.current);
          return root === undefined
            ? markdownSearchMatches(markdownDocument, markdownSearch.query)
            : renderedMarkdownSearchMatches(root, markdownSearch.query);
        })();
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
    if (githubPreviewHtml === "") {
      setRenderedMarkdownBlocks(undefined);
      return;
    }

    const root = githubMarkdownRoot(contentRef.current);
    setRenderedMarkdownBlocks(
      root === undefined ? sourceMarkdownBlocks : githubMarkdownBlocks(root).length,
    );
  }, [githubPreviewHtml, sourceMarkdownBlocks]);

  useEffect(() => {
    const initialRawPagerState = createRawPagerState(rawText);
    rawPagerStateRef.current = initialRawPagerState;
    setRawPagerState(initialRawPagerState);
    setMarkdownPosition(createMarkdownViewerPosition(markdownBlocks));
    setMarkdownSearch(createMarkdownViewerSearch());
    markdownGPrefixRef.current = false;
    if (contentRef.current !== null) {
      contentRef.current.scrollTop = 0;
    }
  }, [
    githubPreviewHtml,
    markdownBlocks,
    markdownDocument?.source.path,
    markdownDocument?.text,
    rawText,
  ]);

  useEffect(() => {
    if (!isRawPager) {
      return;
    }

    const contentElement = contentRef.current;
    const measurementElement = rawPagerMeasurementRef.current;

    if (contentElement === null || measurementElement === null) {
      return;
    }

    const measureCapacity = (): void => {
      const current = rawPagerStateRef.current;
      const resized = resizeLessPagerToContent(
        contentElement,
        measurementElement,
        current,
      );

      if (resized === current) {
        return;
      }

      rawPagerStateRef.current = resized;
      setRawPagerState(resized);
    };

    measureCapacity();

    const observer = new ResizeObserver(measureCapacity);
    observer.observe(contentElement);

    return () => {
      observer.disconnect();
    };
  }, [isRawPager, rawText]);

  useEffect(() => {
    if (!isRawPager) {
      return;
    }

    const contentElement = contentRef.current;
    const measurementElement = rawPagerMeasurementRef.current;

    if (contentElement === null || measurementElement === null) {
      return;
    }

    const current = rawPagerStateRef.current;
    const resized = resizeLessPagerToContent(
      contentElement,
      measurementElement,
      current,
    );

    if (resized !== current) {
      rawPagerStateRef.current = resized;
      setRawPagerState(resized);
    }
  }, [isRawPager, rawPagerLineOffset]);

  useEffect(() => {
    if (markdownSearch.kind === "editing") {
      searchInputRef.current?.focus();
    }
  }, [markdownSearch]);

  useEffect(() => {
    if (activeBlockIndex === undefined) {
      return;
    }

    const contentElement = contentRef.current;

    if (contentElement === null) {
      return;
    }

    const githubMarkdown = githubMarkdownRoot(contentElement);
    const githubBlocks = githubMarkdown === undefined
      ? []
      : githubMarkdownBlocks(githubMarkdown);

    for (const block of githubBlocks) {
      block.removeAttribute("data-markdown-current");
      block.removeAttribute("aria-current");
    }

    const match = githubBlocks[activeBlockIndex] ??
      contentElement.querySelector<HTMLElement>(
        `[data-markdown-block-index="${activeBlockIndex}"]`,
      );

    if (match !== null && match !== undefined && githubBlocks.includes(match)) {
      match.setAttribute("data-markdown-current", "true");
      match.setAttribute("aria-current", "true");
    }

    if (activeBlockIndex === 0) {
      contentElement.scrollTop = 0;
      return;
    }

    match?.scrollIntoView({ block: "nearest" });
  }, [activeBlockIndex, markdownDocument]);

  useEffect(() => {
    const root = githubMarkdownRoot(contentRef.current);

    if (root === undefined) {
      return;
    }

    if (markdownSearch.kind !== "active") {
      clearRenderedMarkdownSearchHighlights(root);
      return;
    }

    const currentMatch = highlightRenderedMarkdownSearch(
      root,
      markdownSearch.query,
      markdownSearch.matchIndex,
    );
    currentMatch?.scrollIntoView({ block: "center", inline: "nearest" });
  }, [githubPreviewHtml, markdownSearch]);

  const closeActiveViewer = onClose;

  const applyPagerOperation = (operation: RawPagerOperation): void => {
    if (operation.kind === "quit") {
      closeActiveViewer?.();
      return;
    }

    setRawPagerState((current) => {
      const transition = applyRawPagerOperation(current, operation);
      const next = transition.kind === "updated" ? transition.state : current;
      rawPagerStateRef.current = next;
      return next;
    });
  };

  const applyMarkdownMotion = (motion: MarkdownViewerMotion): void => {
    const contentElement = contentRef.current;

    if (motion.kind === "top" && contentElement !== null) {
      contentElement.scrollTop = 0;
    } else if (motion.kind === "bottom" && contentElement !== null) {
      contentElement.scrollTop = contentElement.scrollHeight;
    }

    const pageBlockCount = Math.max(
      1,
      Math.floor((contentElement?.clientHeight ?? 40) / 40),
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
    const root = githubMarkdownRoot(contentRef.current);
    const matches = markdownDocument === undefined
      ? []
      : root === undefined
      ? markdownSearchMatches(markdownDocument, query)
      : renderedMarkdownSearchMatches(root, query);
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
      if (!input.ctrlKey && !input.metaKey && input.key === "g") {
        defaultPrevented = true;
        event.preventDefault();

        if (markdownGPrefixRef.current) {
          markdownGPrefixRef.current = false;
          applyMarkdownOperation({ kind: "top" });
        } else {
          markdownGPrefixRef.current = true;
        }

        return;
      }

      markdownGPrefixRef.current = false;
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

    markdownGPrefixRef.current = false;
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
    const pageLines = rawPagerPageLines(
      activeViewer.document.text,
      rawPagerState,
    );

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
          <LessPagerMeasurement
            measurementRef={rawPagerMeasurementRef}
            lines={rawLogicalLines}
          />
          <pre
            className="min-h-full whitespace-pre-wrap wrap-break-words text-text-bright"
            aria-label="Current less page"
          >
            {pageLines.map((line) => (
              <span
                key={line.lineNumber}
                className="block"
                data-raw-pager-line-number={line.lineNumber}
                data-raw-pager-visible-line=""
              >
                {line.text}
              </span>
            ))}
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
        vimSession={vimSession}
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
              ↑/↓ or j/k move · PageUp/b and PageDown/Space page · gg/G jump · / search · n/N results · Esc/q return
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
