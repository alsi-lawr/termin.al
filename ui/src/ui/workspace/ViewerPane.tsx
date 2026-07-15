import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
} from "react";
import type { InputCapturePaneKeyInput } from "../terminal/InputCapture";
import type { InputCapturePaneKeyResult } from "../terminal/InputCapture";
import { MobilePaneControls } from "./MobilePaneControls";

type ViewerPaneProps = Readonly<{
  title: string;
  isActive: boolean;
  focusVersion: number;
  onActivate: () => void;
  onPaneKeyInput: (
    input: InputCapturePaneKeyInput,
  ) => InputCapturePaneKeyResult;
}>;

export function ViewerPane({
  title,
  isActive,
  focusVersion,
  onActivate,
  onPaneKeyInput,
}: ViewerPaneProps): ReactElement {
  const viewerRef = useRef<HTMLElement | null>(null);

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
        <h2 className="text-lg font-semibold text-green-400">{title}</h2>
        <p className="mt-2 whitespace-pre-wrap wrap-break-words text-neutral-300">
          Viewer placeholder. Content rendering arrives with the Markdown work.
        </p>
      </div>
      <MobilePaneControls onControl={() => {}} onPrefix={triggerPrefix} />
    </section>
  );
}
