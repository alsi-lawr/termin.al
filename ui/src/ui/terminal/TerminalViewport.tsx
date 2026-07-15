import { useLayoutEffect, useRef, type ReactElement } from "react";
import type { VirtualDirectoryPath } from "../../domain/filesystem/VirtualFilesystem.ts";
import type {
  ShellAutosuggestion,
  ShellCompletion,
  ShellHistoryEntry,
  ShellStatus,
} from "../../domain/terminal/Shell.ts";
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

function scrollToLatestOutput(element: HTMLDivElement): void {
  element.scrollTop = element.scrollHeight;
}

export function TerminalViewportContent({
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
  return (
    <div className="flex min-h-full flex-col">
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

      <div className="mt-auto">
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
    </div>
  );
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

  useLayoutEffect(() => {
    const viewport = viewportRef.current;

    if (viewport) {
      scrollToLatestOutput(viewport);
    }
  }, [
    autosuggestion,
    completion,
    currentDirectory,
    currentInput,
    cursorColumn,
    promptLabel,
    rows,
    status,
    transientDiagnostic,
  ]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;

    if (!viewport) {
      return;
    }

    const observer = new ResizeObserver(() => {
      scrollToLatestOutput(viewport);
    });

    observer.observe(viewport);

    return () => observer.disconnect();
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-deepest font-mono text-sm text-text-primary">
      <div
        ref={viewportRef}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain p-4"
        role="region"
        aria-label="Terminal scrollback"
      >
        <TerminalViewportContent
          rows={rows}
          currentDirectory={currentDirectory}
          promptLabel={promptLabel}
          currentInput={currentInput}
          cursorColumn={cursorColumn}
          status={status}
          completion={completion}
          autosuggestion={autosuggestion}
          transientDiagnostic={transientDiagnostic}
        />
      </div>
    </div>
  );
}
