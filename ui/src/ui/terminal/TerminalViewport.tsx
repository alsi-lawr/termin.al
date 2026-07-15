import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type UIEvent,
} from "react";
import type {
  ShellAutosuggestion,
  ShellCompletion,
  ShellHistoryEntry,
  ShellStatus,
} from "../../domain/terminal/Shell.ts";
import type { VirtualDirectoryPath } from "../../domain/filesystem/VirtualFilesystem.ts";
import { TerminalHistoryRow } from "./TerminalHistoryRow";
import { TerminalPrompt } from "./TerminalPrompt";

type TerminalViewportProps = Readonly<{
  rows: ReadonlyArray<ShellHistoryEntry>;
  currentDirectory: VirtualDirectoryPath;
  promptLabel: string | undefined;
  currentInput: string;
  cursorColumn: number;
  status: ShellStatus;
  completion: ShellCompletion;
  autosuggestion: ShellAutosuggestion;
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
  currentDirectory,
  promptLabel,
  currentInput,
  cursorColumn,
  status,
  completion,
  autosuggestion,
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
    currentDirectory,
    promptLabel,
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
    <div className="relative h-full min-h-0 rounded-md bg-surface-deepest font-mono text-sm text-text-primary">
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
            className="whitespace-pre-wrap wrap-break-words text-diagnostic-error"
          >
            {transientDiagnostic}
          </div>
        )}

        <TerminalPrompt
          currentDirectory={currentDirectory}
          promptLabel={promptLabel}
          currentInput={currentInput}
          cursorColumn={cursorColumn}
          status={status}
          completion={completion}
          autosuggestion={autosuggestion}
        />
      </div>

      {scrollMode.kind === "manual" ? (
        <button
          type="button"
          className="absolute bottom-4 right-4 rounded-md border border-surface-border bg-surface-deepest px-2 py-1 text-text-primary"
          aria-controls={scrollbackId}
          onClick={followLatest}
        >
          Latest output
        </button>
      ) : null}
    </div>
  );
}
