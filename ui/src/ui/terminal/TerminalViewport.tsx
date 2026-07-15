import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type UIEvent,
} from "react";
import type {
  ShellCompletion,
  ShellHistoryEntry,
  ShellStatus,
} from "../../domain/terminal/Shell.ts";
import { TerminalHistoryRow } from "./TerminalHistoryRow";
import { TerminalPrompt } from "./TerminalPrompt";

type TerminalViewportProps = Readonly<{
  rows: ReadonlyArray<ShellHistoryEntry>;
  prompt: string;
  currentInput: string;
  cursorColumn: number;
  status: ShellStatus;
  completion: ShellCompletion;
  transientDiagnostic: string | undefined;
}>;

type ScrollMode =
  | Readonly<{ kind: "following" }>
  | Readonly<{ kind: "manual" }>;

const bottomThreshold = 8;

function isAtLatestOutput(element: HTMLDivElement): boolean {
  const remaining =
    element.scrollHeight - element.clientHeight - element.scrollTop;

  return remaining <= bottomThreshold;
}

function scrollToLatestOutput(element: HTMLDivElement): void {
  element.scrollTop = element.scrollHeight;
}

export function TerminalViewport({
  rows,
  prompt,
  currentInput,
  cursorColumn,
  status,
  completion,
  transientDiagnostic,
}: TerminalViewportProps): ReactElement {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const scrollbackId = useId();
  const [scrollMode, setScrollMode] = useState<ScrollMode>({
    kind: "following",
  });

  useLayoutEffect(() => {
    const viewport = viewportRef.current;

    if (!viewport || scrollMode.kind !== "following") {
      return;
    }

    scrollToLatestOutput(viewport);
  }, [
    completion,
    currentInput,
    cursorColumn,
    prompt,
    rows,
    scrollMode,
    status,
    transientDiagnostic,
  ]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;

    if (!viewport) {
      return;
    }

    const observer = new ResizeObserver(() => {
      if (scrollMode.kind === "following") {
        scrollToLatestOutput(viewport);
      }
    });

    observer.observe(viewport);

    return () => observer.disconnect();
  }, [scrollMode]);

  const handleScroll = (event: UIEvent<HTMLDivElement>): void => {
    const nextMode: ScrollMode = isAtLatestOutput(event.currentTarget)
      ? { kind: "following" }
      : { kind: "manual" };

    setScrollMode((current) =>
      current.kind === nextMode.kind ? current : nextMode,
    );
  };

  const followLatest = (): void => {
    const viewport = viewportRef.current;
    setScrollMode({ kind: "following" });

    if (viewport) {
      scrollToLatestOutput(viewport);
    }
  };

  return (
    <div className="relative h-full min-h-0 rounded-md bg-neutral-950 font-mono text-sm text-neutral-100">
      <div
        id={scrollbackId}
        ref={viewportRef}
        className="h-full min-h-0 overflow-y-auto overscroll-contain p-4"
        role="region"
        aria-label="Terminal scrollback"
        onScroll={handleScroll}
      >
        <div
          role="log"
          aria-label="Terminal output"
          aria-live="polite"
          aria-relevant="additions text"
          aria-atomic="false"
        >
          {rows.map((row) => (
            <TerminalHistoryRow key={row.id} entry={row} />
          ))}
        </div>

        {transientDiagnostic === undefined ? null : (
          <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="whitespace-pre-wrap wrap-break-words text-red-400"
          >
            {transientDiagnostic}
          </div>
        )}

        <TerminalPrompt
          prompt={prompt}
          currentInput={currentInput}
          cursorColumn={cursorColumn}
          status={status}
          completion={completion}
        />
      </div>

      {scrollMode.kind === "manual" ? (
        <button
          type="button"
          className="absolute bottom-4 right-4 rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1 text-neutral-100"
          aria-controls={scrollbackId}
          onClick={followLatest}
        >
          Latest output
        </button>
      ) : null}
    </div>
  );
}
