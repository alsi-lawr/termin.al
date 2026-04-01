import { useLayoutEffect, useRef, useState } from "react";
import { InputRow } from "./InputRow";
import {
  TerminalHistoryRow,
  type TerminalHistoryProps,
} from "./TerminalHistoryRow";

type TerminalViewportProps = {
  rows: TerminalHistoryProps[];
  prompt: string;
  currentInput: string;
  cursorColumn: number;
};

export function TerminalViewport({
  rows,
  prompt,
  currentInput,
  cursorColumn,
}: TerminalViewportProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const inputMeasureRef = useRef<HTMLDivElement | null>(null);
  const historyMeasureRefs = useRef<Map<number, HTMLDivElement>>(new Map());

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
        const element = historyMeasureRefs.current.get(i);

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
        {visibleRows.map((value, visibleIndex) => {
          const actualIndex = startIndex + visibleIndex;

          return (
            <TerminalHistoryRow key={`${actualIndex}-${value}`} {...value} />
          );
        })}

        <InputRow activeLine={activeLine} cursorIndex={cursorIndex} />
      </div>

      <div className="pointer-events-none absolute inset-0 invisible -z-10 p-4">
        <div className="whitespace-pre-wrap wrap-break-words">
          {rows.map((value, index) => (
            <div
              key={`${index}-${value}`}
              ref={(element) => {
                if (element) {
                  historyMeasureRefs.current.set(index, element);
                } else {
                  historyMeasureRefs.current.delete(index);
                }
              }}
            >
              <TerminalHistoryRow {...value} />
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
