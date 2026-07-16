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
  type ViewerProjectCard,
  type ViewerPublicationEntry,
} from "../../content/ViewerContent.ts";
import type { MarkdownDocument } from "../../content/MarkdownDocument.ts";
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

type OpenedViewerDocument = Readonly<{
  title: string;
  document: MarkdownDocument;
}>;

type ProjectIcon = Readonly<{
  glyph: string;
  label: string;
}>;

function generatedProjectGlyph(name: string): string {
  const initials = name
    .split(/[^\p{L}\p{N}]+/u)
    .filter((part) => part.length > 0)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase() ?? "")
    .join("");

  return initials.length === 0 ? "◇" : initials;
}

function projectIcon(project: ViewerProjectCard): ProjectIcon {
  const tags = new Set(project.tags.map((tag) => tag.toLocaleLowerCase()));

  if (tags.has("fsharp")) {
    return { glyph: "λ", label: "F#" };
  }

  if (tags.has("typescript")) {
    return { glyph: "TS", label: "TypeScript" };
  }

  if (tags.has("react")) {
    return { glyph: "⚛", label: "React" };
  }

  if (tags.has("nix")) {
    return { glyph: "❄", label: "Nix" };
  }

  return {
    glyph: generatedProjectGlyph(project.name),
    label: `${project.name} generated`,
  };
}

function ProjectGallery({
  projects,
  onOpen,
}: Readonly<{
  projects: ReadonlyArray<ViewerProjectCard>;
  onOpen: (document: OpenedViewerDocument) => void;
}>): ReactElement {
  if (projects.length === 0) {
    return (
      <p className="mt-3 text-text-muted" role="status">
        No public projects are available.
      </p>
    );
  }

  return (
    <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {projects.map((project) => {
        const icon = projectIcon(project);

        return (
          <article
            key={project.id}
            className="flex min-w-0 flex-col rounded-md border border-surface-border bg-surface-raised p-3"
          >
            <div className="flex items-start gap-3">
              <span
                className="flex size-10 shrink-0 items-center justify-center rounded border border-ui-subtle bg-surface-deepest font-semibold text-ui-accent"
                aria-label={`${icon.label} project icon`}
              >
                {icon.glyph}
              </span>
              <div className="min-w-0">
                <h3 className="font-semibold text-text-bright">{project.name}</h3>
                <p className="wrap-break-words text-xs text-text-muted">
                  {project.repository}
                </p>
              </div>
            </div>
            <p className="mt-3 flex-1 text-text-primary">{project.summary}</p>
            {project.tags.length === 0 ? null : (
              <ul className="mt-3 flex flex-wrap gap-1" aria-label="Project tags">
                {project.tags.map((tag) => (
                  <li
                    key={tag}
                    className="rounded border border-ui-subtle px-1.5 py-0.5 text-xs text-text-muted"
                  >
                    #{tag}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded border border-ui-accent px-2 py-1 text-text-bright hover:bg-surface-highlight focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-focus"
                onClick={() => {
                  onOpen({ title: `${project.name} README`, document: project.document });
                }}
              >
                Open README
              </button>
              {project.repositoryUrl === undefined ? null : (
                <a
                  className="rounded border border-surface-border px-2 py-1 text-text-bright hover:border-ui-accent hover:text-ui-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-focus"
                  href={project.repositoryUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Repository ↗
                </a>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function PublicationList({
  publicationKind,
  entries,
  onOpen,
}: Readonly<{
  publicationKind: "blog" | "notes";
  entries: ReadonlyArray<ViewerPublicationEntry>;
  onOpen: (document: OpenedViewerDocument) => void;
}>): ReactElement {
  if (entries.length === 0) {
    return (
      <p className="mt-3 text-text-muted" role="status">
        {publicationKind === "blog"
          ? "No blog posts are published."
          : "No public notes are published."}
      </p>
    );
  }

  return (
    <ol className="mt-3 space-y-3">
      {entries.map((entry) => (
        <li key={entry.id}>
          <article className="rounded-md border border-surface-border bg-surface-raised p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-semibold text-text-bright">{entry.title}</h3>
              <time className="text-xs text-text-muted" dateTime={entry.publishedAt}>
                {entry.publishedAt.slice(0, 10)}
              </time>
            </div>
            <p className="mt-2 text-text-primary">{entry.summary}</p>
            {entry.tags.length === 0 ? null : (
              <ul
                className="mt-3 flex flex-wrap gap-1"
                aria-label={`${entry.title} tags`}
              >
                {entry.tags.map((tag) => (
                  <li
                    key={tag}
                    className="rounded border border-ui-subtle px-1.5 py-0.5 text-xs text-text-muted"
                  >
                    #{tag}
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              className="mt-3 rounded border border-ui-accent px-2 py-1 text-text-bright hover:bg-surface-highlight focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-focus"
              onClick={() => {
                onOpen({ title: entry.title, document: entry.document });
              }}
            >
              Open {publicationKind === "blog" ? "post" : "note"}
            </button>
          </article>
        </li>
      ))}
    </ol>
  );
}

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
  const [openedDocument, setOpenedDocument] =
    useState<OpenedViewerDocument>();
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
    setOpenedDocument(undefined);
  }, [viewer]);

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

  const closeActiveViewer =
    openedDocument === undefined
      ? onClose
      : (): void => {
          setOpenedDocument(undefined);
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
      onClose: closeActiveViewer,
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
                {rawPagerPageText(activeViewer.document.text, rawPagerState)}
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
        return (
          <ProjectGallery
            projects={activeViewer.projects}
            onOpen={setOpenedDocument}
          />
        );
      case "publication-list":
        return (
          <PublicationList
            publicationKind={activeViewer.publicationKind}
            entries={activeViewer.entries}
            onOpen={setOpenedDocument}
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
