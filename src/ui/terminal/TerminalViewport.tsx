import { useLayoutEffect, useRef, useState, type ReactElement } from "react";
import type { ShellHistoryEntry } from "../../domain/terminal/Shell.ts";
import { InputRow } from "./InputRow";
import { TerminalHistoryRow } from "./TerminalHistoryRow";

type TerminalViewportProps = Readonly<{
  rows: ReadonlyArray<ShellHistoryEntry>;
  prompt: string;
  currentInput: string;
  cursorColumn: number;
}>;

export function TerminalViewport({
  rows,
  prompt,
  currentInput,
  cursorColumn,
}: TerminalViewportProps): ReactElement {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const inputMeasureRef = useRef<HTMLDivElement | null>(null);
  const historyMeasureRefs = useRef<
    Map<ShellHistoryEntry["id"], HTMLDivElement>
  >(new Map());

  const [startIndex, setStartIndex] = useState(0);

  const activeLine = `${prompt} ${currentInput}`;
  const safeCursorColumn = Math.max(
    0,
    Math.min(cursorColumn, currentInput.length),
  );
  const cursorIndex = `${prompt} `.length + safeCursorColumn;

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const inputMeasure = inputMeasureRef.current;

    if (!viewport || !inputMeasure) {
      return;
    }

    const recalculate = () => {
      const viewportHeight = viewport.clientHeight;
      const inputHeight = inputMeasure.getBoundingClientRect().height;

      if (viewportHeight <= 0 || inputHeight <= 0) {
        return;
      }

      let remaining = viewportHeight - inputHeight - 4;
      let nextStartIndex = rows.length;

      for (let i = rows.length - 1; i >= 0; i -= 1) {
        const row = rows[i];

        if (!row) {
          continue;
        }

        const element = historyMeasureRefs.current.get(row.id);

        if (!element) {
          continue;
        }

        const height = element.getBoundingClientRect().height;

        if (height > remaining) {
          break;
        }

        remaining -= height;
        nextStartIndex = i;
      }

      setStartIndex(nextStartIndex);
    };

    recalculate();

    const observer = new ResizeObserver(recalculate);

    observer.observe(viewport);
    observer.observe(inputMeasure);

    for (const element of historyMeasureRefs.current.values()) {
      observer.observe(element);
    }

    return () => observer.disconnect();
  }, [rows, activeLine]);

  const visibleRows = rows.slice(startIndex);

  return (
    <div
      ref={viewportRef}
      className="relative h-full min-h-0 overflow-hidden rounded-md bg-neutral-950 p-4 font-mono text-sm text-neutral-100"
      role="log"
      aria-live="polite"
      aria-label="Terminal output"
    >
      <div className="h-full whitespace-pre-wrap wrap-break-words">
        {visibleRows.map((row) => (
          <TerminalHistoryRow key={row.id} entry={row} />
        ))}

        <InputRow activeLine={activeLine} cursorIndex={cursorIndex} />
      </div>

      <div className="pointer-events-none absolute inset-0 invisible -z-10 p-4">
        <div className="whitespace-pre-wrap wrap-break-words">
          {rows.map((row) => (
            <div
              key={row.id}
              ref={(element) => {
                if (element) {
                  historyMeasureRefs.current.set(row.id, element);
                } else {
                  historyMeasureRefs.current.delete(row.id);
                }
              }}
            >
              <TerminalHistoryRow entry={row} />
            </div>
          ))}

          <div ref={inputMeasureRef}>
            <InputRow
              activeLine={activeLine || `${prompt} `}
              cursorIndex={cursorIndex}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
