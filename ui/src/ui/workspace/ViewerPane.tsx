import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
} from "react";
import {
  viewerTitle,
  type ViewerContent,
} from "../../content/ViewerContent.ts";
import type { InputCapturePaneKeyInput } from "../terminal/InputCapture";
import type { InputCapturePaneKeyResult } from "../terminal/InputCapture";
import { MobilePaneControls, type MobilePaneControl } from "./MobilePaneControls";

type ViewerPaneProps = Readonly<{
  viewer: ViewerContent;
  isActive: boolean;
  focusVersion: number;
  onActivate: () => void;
  onPaneKeyInput: (
    input: InputCapturePaneKeyInput,
  ) => InputCapturePaneKeyResult;
  onClose?: () => void;
}>;

export function ViewerPane({
  viewer,
  isActive,
  focusVersion,
  onActivate,
  onPaneKeyInput,
  onClose,
}: ViewerPaneProps): ReactElement {
  const viewerRef = useRef<HTMLElement | null>(null);
  const title = viewerTitle(viewer);

  useEffect(() => {
    if (isActive) {
      viewerRef.current?.focus({ preventScroll: true });
    }
  }, [focusVersion, isActive]);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    const result = onPaneKeyInput({
      key: event.key,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
    });

    if (result.kind === "handled") {
      event.preventDefault();
      return;
    }

    if (
      onClose !== undefined &&
      !event.ctrlKey &&
      !event.metaKey &&
      (event.key === "Escape" || event.key === "q")
    ) {
      event.preventDefault();
      onClose();
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

  const handleMobileControl = (control: MobilePaneControl): void => {
    if (control === "escape") {
      onClose?.();
    }
  };

  const content = (() => {
    switch (viewer.kind) {
      case "placeholder":
        return (
          <p className="mt-2 whitespace-pre-wrap wrap-break-words text-neutral-300">
            Viewer placeholder. Content rendering arrives with the Markdown work.
          </p>
        );
      case "document":
        return (
          <pre className="mt-2 whitespace-pre-wrap wrap-break-words text-neutral-300">
            {viewer.document.text}
          </pre>
        );
      case "directory":
        return (
          <>
            <p className="mt-2 text-neutral-500">{viewer.path}</p>
            <ul className="mt-2 space-y-1 text-neutral-300">
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
      className="flex h-full min-h-0 flex-col rounded-md bg-neutral-950 font-mono text-sm text-neutral-100 outline-none"
      tabIndex={0}
      aria-label={title + " viewer"}
      onFocus={onActivate}
      onKeyDown={handleKeyDown}
      onClick={handleClick}
    >
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-green-400">{title}</h2>
          {onClose === undefined ? null : (
            <button
              type="button"
              className="rounded border border-neutral-700 px-2 py-1 text-neutral-300 hover:border-green-500 hover:text-green-400"
              onClick={onClose}
            >
              Return
            </button>
          )}
        </div>
        {viewer.kind === "document" && viewer.presentation === "raw-pager" ? (
          <p className="mt-2 text-neutral-500">Raw pager</p>
        ) : null}
        {content}
      </div>
      <MobilePaneControls onControl={handleMobileControl} onPrefix={triggerPrefix} />
    </section>
  );
}
