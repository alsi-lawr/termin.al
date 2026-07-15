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
  applyRawPagerOperation,
  createRawPagerState,
  rawPagerPageText,
  rawPagerStatus,
  type RawPagerOperation,
} from "../../domain/viewer/RawPager.ts";
import type { InputCapturePaneKeyInput } from "../terminal/InputCapture";
import type { InputCapturePaneKeyResult } from "../terminal/InputCapture";
import { MobilePaneControls, type MobilePaneControl } from "./MobilePaneControls";
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
  const title = viewerTitle(viewer);
  const isRawPager =
    viewer.kind === "document" && viewer.presentation === "raw-pager";
  const rawText = isRawPager ? viewer.document.text : "";
  const [rawPagerState, setRawPagerState] = useState(() =>
    createRawPagerState(rawText),
  );

  useEffect(() => {
    if (isActive) {
      viewerRef.current?.focus({ preventScroll: true });
    }
  }, [focusVersion, isActive]);

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

    if (mobileCtrlInput.mobileCtrlApplied && !defaultPrevented) {
      event.preventDefault();
    }
  };

  const handleClick = (event: MouseEvent<HTMLElement>): void => {
    if (event.target instanceof HTMLButtonElement) {
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
          <pre className="mt-2 whitespace-pre-wrap wrap-break-words text-text-bright">
            {viewer.document.text}
          </pre>
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
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
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
