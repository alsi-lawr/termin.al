import {
  nextUnicodeCursorOffset,
  normalizeUnicodeCursorOffset,
  previousUnicodeCursorOffset,
  type UnicodeCursorOffset,
} from "../../domain/terminal/UnicodeCursor.ts";

export type VisibleInputRowSegments = Readonly<{
  beforeCursor: string;
  cursor: string;
  afterCursor: string;
}>;

export function segmentVisibleInputRow(
  line: string,
  cursor: number,
): VisibleInputRowSegments {
  const cursorStart = normalizeUnicodeCursorOffset(line, cursor);
  const cursorEnd = nextUnicodeCursorOffset(line, cursorStart);

  return {
    beforeCursor: line.slice(0, cursorStart),
    cursor: line.slice(cursorStart, cursorEnd),
    afterCursor: line.slice(cursorEnd),
  };
}

export function normalizeNativeInputSelection(
  value: string,
  selectionEnd: number,
): UnicodeCursorOffset {
  return normalizeUnicodeCursorOffset(value, selectionEnd);
}

export function moveNativeInputSelectionLeft(
  value: string,
  selectionEnd: number,
): UnicodeCursorOffset {
  return previousUnicodeCursorOffset(value, selectionEnd);
}

export function moveNativeInputSelectionRight(
  value: string,
  selectionEnd: number,
): UnicodeCursorOffset {
  return nextUnicodeCursorOffset(value, selectionEnd);
}
