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
  markdownSearchMatches,
} from "../../content/MarkdownRenderer.ts";
import {
  applyRawPagerOperation,
  createRawPagerState,
  rawPagerPageText,
  rawPagerStatus,
  type RawPagerOperation,
} from "../../domain/viewer/RawPager.ts";
import type { InputCapturePaneKeyInput } from "../terminal/InputCapture";
import type { InputCapturePaneKeyResult } from "../terminal/InputCapture";
import { MobilePaneControls, type MobilePaneControl } from "./MobilePaneControls";
import {
  markdownViewerOperationFromKey,
  type MarkdownViewerOperation,
} from "./MarkdownViewerNavigation.ts";
import type { MobileCtrlInputResolution } from "./MobileCtrlModifier.ts";
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

type MarkdownSearch =
  | Readonly<{ kind: "idle" }>
  | Readonly<{
      kind: "editing";
      query: string;
    }>
  | Readonly<{
      kind: "active";
      query: string;
      matchIndex: number;
    }>;

const idleMarkdownSearch: MarkdownSearch = { kind: "idle" };

function markdownSearchStatus(
  query: string,
  matchCount: number,
  matchIndex: number,
): string {
  return matchCount === 0
    ? `No matches for ${query}`
    : `/${query} ${matchIndex + 1}/${matchCount}`;
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
  const title = viewerTitle(viewer);
  const isRawPager =
    viewer.kind === "document" && viewer.presentation === "raw-pager";
  const markdownDocument =
    viewer.kind === "document" && viewer.presentation === "inline"
      ? viewer.document
      : undefined;
  const rawText = isRawPager ? viewer.document.text : "";
  const [rawPagerState, setRawPagerState] = useState(() =>
    createRawPagerState(rawText),
  );
  const [markdownSearch, setMarkdownSearch] = useState<MarkdownSearch>(
    idleMarkdownSearch,
  );
  const searchMatches =
    markdownDocument === undefined || markdownSearch.kind !== "active"
      ? []
      : markdownSearchMatches(markdownDocument, markdownSearch.query);
  const activeBlockIndex =
    markdownSearch.kind === "active"
      ? searchMatches[markdownSearch.matchIndex]
      : undefined;

  useEffect(() => {
    if (isActive) {
      viewerRef.current?.focus({ preventScroll: true });
    }
  }, [focusVersion, isActive]);

  useEffect(() => {
    setRawPagerState(createRawPagerState(rawText));
    setMarkdownSearch(idleMarkdownSearch);
  }, [rawText, markdownDocument?.text]);

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

  const applyPagerOperation = (operation: RawPagerOperation): void => {
    if (operation.kind === "quit") {
      onClose?.();
      return;
    }

    setRawPagerState((current) => {
      const transition = applyRawPagerOperation(current, operation);
      return transition.kind === "updated" ? transition.state : current;
    });
  };

  const applyMarkdownOperation = (operation: MarkdownViewerOperation): void => {
    const content = contentRef.current;

    switch (operation.kind) {
      case "line-up":
        content?.scrollBy({ top: -40 });
        return;
      case "line-down":
        content?.scrollBy({ top: 40 });
        return;
      case "page-up":
        content?.scrollBy({ top: -(content?.clientHeight ?? 0) * 0.8 });
        return;
      case "page-down":
        content?.scrollBy({ top: (content?.clientHeight ?? 0) * 0.8 });
        return;
      case "top":
        content?.scrollTo({ top: 0 });
        return;
      case "bottom":
        content?.scrollTo({ top: content?.scrollHeight ?? 0 });
        return;
      case "search":
        setMarkdownSearch({ kind: "editing", query: "" });
        return;
      case "search-next":
      case "search-previous":
        if (markdownSearch.kind !== "active" || searchMatches.length === 0) {
          return;
        }

        setMarkdownSearch((current) => {
          if (current.kind !== "active") {
            return current;
          }

          const direction = operation.kind === "search-next" ? 1 : -1;
          const nextIndex =
            (current.matchIndex + direction + searchMatches.length) %
            searchMatches.length;
          return { ...current, matchIndex: nextIndex };
        });
    }
  };

  const submitMarkdownSearch = (): void => {
    if (markdownSearch.kind !== "editing") {
      return;
    }

    const query = markdownSearch.query.trim();
    setMarkdownSearch(
      query === ""
        ? idleMarkdownSearch
        : { kind: "active", query, matchIndex: 0 },
    );
  };

  const cancelMarkdownSearch = (): void => {
    setMarkdownSearch(idleMarkdownSearch);
    viewerRef.current?.focus({ preventScroll: true });
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
      onClose,
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
          onClose?.();
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
      onClose?.();
    }
  };

  const content = (() => {
    switch (viewer.kind) {
      case "placeholder":
        return (
          <p className="mt-2 whitespace-pre-wrap wrap-break-words text-text-bright">
            Viewer placeholder. Content rendering arrives with the Markdown work.
          </p>
        );
      case "document":
        if (viewer.presentation === "raw-pager") {
          const status = rawPagerStatus(rawPagerState);
          const statusText = status.kind === "empty"
            ? "No lines"
            : `Lines ${status.firstLine}-${status.lastLine} of ${status.totalLines}`;

          return (
            <>
              <p
                className="mt-2 text-text-muted"
                role="status"
                aria-live="polite"
              >
                Raw pager · {statusText}
              </p>
              <pre
                className="mt-2 whitespace-pre-wrap wrap-break-words text-text-bright"
                aria-label="Current raw pager page"
              >
                {rawPagerPageText(viewer.document.text, rawPagerState)}
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
                    setMarkdownSearch({
                      kind: "editing",
                      query: event.target.value,
                    });
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
            {markdownSearch.kind === "active" ? (
              <p className="mt-3 text-text-muted" role="status" aria-live="polite">
                {markdownSearchStatus(
                  markdownSearch.query,
                  searchMatches.length,
                  markdownSearch.matchIndex,
                )}
              </p>
            ) : null}
            <MarkdownRenderer
              document={viewer.document}
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
            <p className="mt-2 text-text-muted">{viewer.path}</p>
            <ul className="mt-2 space-y-1 text-text-bright">
              {viewer.entries.map((entry) => (
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
      className="flex h-full min-h-0 flex-col rounded-md bg-surface-deepest font-mono text-sm text-text-primary outline-none"
      tabIndex={0}
      aria-label={title + " viewer"}
      onFocus={onActivate}
      onKeyDown={handleKeyDown}
      onClick={handleClick}
    >
      <div ref={contentRef} className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-ui-accent">{title}</h2>
          {onClose === undefined ? null : (
            <button
              type="button"
              className="rounded border border-surface-border px-2 py-1 text-text-bright hover:border-ui-accent hover:text-ui-accent"
              onClick={onClose}
            >
              Return
            </button>
          )}
        </div>
        {content}
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
