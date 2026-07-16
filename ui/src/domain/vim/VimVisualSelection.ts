import {
  nextUnicodeCursorOffset,
  normalizeUnicodeCursorOffset,
  previousUnicodeCursorOffset,
} from "../terminal/UnicodeCursor.ts";
import {
  vimPositionForTextOffset,
  vimTextOffsetForPosition,
  type VimMotionRange,
} from "./VimMotion.ts";

export type VimPosition = Readonly<{ line: number; column: number }>;

export type VimSelection =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "character"; anchor: VimPosition; active: VimPosition }>
  | Readonly<{ kind: "line"; anchorLine: number; activeLine: number }>
  | Readonly<{ kind: "block"; anchor: VimPosition; active: VimPosition }>;

export type VimVisualRange =
  | Readonly<{ kind: "character"; start: number; end: number }>
  | Readonly<{ kind: "line"; startLine: number; endLine: number }>
  | Readonly<{ kind: "block"; startLine: number; endLine: number;
      startColumn: number; endColumn: number }>;

export type VimBlockRegister = Readonly<{ kind: "block";
  fragments: ReadonlyArray<string>; width: number }>;

export type VimBlockChange = Readonly<{ startLine: number; startColumn: number;
  eligibleLines: ReadonlyArray<number>; insertedText: string }>;

export type VimBlockDeletion = Readonly<{ lines: ReadonlyArray<string>;
  register: VimBlockRegister; change: VimBlockChange }>;

export type VimBlockPut = Readonly<{
  lines: ReadonlyArray<string>; cursor: VimPosition }>;
export type VimBlockPutOptions = Readonly<{
  placement: "before" | "after"; count: number;
}>;

export type VimBlockChangeResult = Readonly<{ lines: ReadonlyArray<string>;
  cursor: VimPosition; change: VimBlockChange }>;

export type VimBlockChangeInput =
  | Readonly<{ kind: "insert"; text: string }>
  | Readonly<{ kind: "clear" }>;

export type VimVisualExtension =
  | Readonly<{ kind: "motion"; cursor: VimPosition }>
  | Readonly<{ kind: "text-object"; cursor: VimPosition;
      range: VimMotionRange }>;
export type VimVisualExtensionResult = Readonly<{ selection: Exclude<
  VimSelection, { kind: "none" }>; cursor: VimPosition }>;

function lineAt(lines: ReadonlyArray<string>, line: number): string {
  const value = lines[line];

  if (value === undefined) {
    throw new Error("Vim visual positions must reference existing lines.");
  }

  return value;
}

function positionEndColumn(
  lines: ReadonlyArray<string>, position: VimPosition,
): number {
  const line = lineAt(lines, position.line);
  return position.column === line.length
    ? position.column + 1
    : nextUnicodeCursorOffset(line, position.column);
}

export function vimVisualRange(
  lines: ReadonlyArray<string>,
  selection: VimSelection,
): VimVisualRange {
  switch (selection.kind) {
    case "none":
      throw new Error("Visual range derivation requires a visual selection.");
    case "line":
      return {
        kind: "line",
        startLine: Math.min(selection.anchorLine, selection.activeLine),
        endLine: Math.max(selection.anchorLine, selection.activeLine),
      };
    case "character": {
      const text = lines.join("\n");
      const anchor = vimTextOffsetForPosition(lines, selection.anchor);
      const active = vimTextOffsetForPosition(lines, selection.active);
      const inclusiveEnd = Math.max(anchor, active);

      return {
        kind: "character",
        start: Math.min(anchor, active),
        end: inclusiveEnd === text.length
          ? inclusiveEnd
          : nextUnicodeCursorOffset(text, inclusiveEnd),
      };
    }
    case "block":
      return {
        kind: "block",
        startLine: Math.min(selection.anchor.line, selection.active.line),
        endLine: Math.max(selection.anchor.line, selection.active.line),
        startColumn: Math.min(
          selection.anchor.column,
          selection.active.column,
        ),
        endColumn: Math.max(
          positionEndColumn(lines, selection.anchor),
          positionEndColumn(lines, selection.active),
        ),
      };
  }
}

function blockFragment(
  line: string,
  range: Extract<VimVisualRange, { kind: "block" }>,
): string {
  const width = range.endColumn - range.startColumn;

  if (range.startColumn > line.length) {
    return " ".repeat(width);
  }

  if (range.startColumn === line.length) {
    return "";
  }

  const start = normalizeUnicodeCursorOffset(line, range.startColumn);
  const end = normalizeUnicodeCursorOffset(
    line,
    Math.min(line.length, range.endColumn),
  );
  return line.slice(start, Math.max(start, end));
}

export function vimBlockRegister(
  lines: ReadonlyArray<string>,
  range: Extract<VimVisualRange, { kind: "block" }>,
): VimBlockRegister {
  return {
    kind: "block",
    fragments: lines
      .slice(range.startLine, range.endLine + 1)
      .map((line) => blockFragment(line, range)),
    width: range.endColumn - range.startColumn,
  };
}

export function deleteVimBlock(
  lines: ReadonlyArray<string>,
  range: Extract<VimVisualRange, { kind: "block" }>,
): VimBlockDeletion {
  const eligibleLines: Array<number> = [];
  const fragments: Array<string> = [];
  const nextLines = lines.map((line, lineIndex) => {
    if (lineIndex < range.startLine || lineIndex > range.endLine) {
      return line;
    }

    fragments.push(blockFragment(line, range));

    if (line.length >= range.startColumn) {
      eligibleLines.push(lineIndex);
    }

    if (line.length <= range.startColumn) {
      return line;
    }

    const start = normalizeUnicodeCursorOffset(line, range.startColumn);
    const end = normalizeUnicodeCursorOffset(
      line,
      Math.min(line.length, range.endColumn),
    );
    return line.slice(0, start) + line.slice(Math.max(start, end));
  });

  return {
    lines: nextLines,
    register: {
      kind: "block",
      fragments,
      width: range.endColumn - range.startColumn,
    },
    change: {
      startLine: range.startLine,
      startColumn: range.startColumn,
      eligibleLines,
      insertedText: "",
    },
  };
}

export function putVimBlock(
  lines: ReadonlyArray<string>,
  cursor: VimPosition,
  register: VimBlockRegister,
  options: VimBlockPutOptions,
): VimBlockPut {
  const destination = lineAt(lines, cursor.line);
  const insertionColumn = options.placement === "after"
    ? destination.length === 0
      ? 0
      : nextUnicodeCursorOffset(destination, cursor.column)
    : cursor.column;
  const nextLines = [...lines];

  let destinationLine = cursor.line;

  for (const fragment of register.fragments) {
    while (nextLines.length <= destinationLine) {
      nextLines.push("");
    }

    const line = lineAt(nextLines, destinationLine).padEnd(insertionColumn, " ");
    const insertion = fragment
      .padEnd(register.width, " ")
      .repeat(options.count);
    nextLines[destinationLine] = line.slice(0, insertionColumn) + insertion +
      line.slice(insertionColumn);
    destinationLine += 1;
  }

  return {
    lines: nextLines,
    cursor: { line: cursor.line, column: insertionColumn },
  };
}

export function editVimBlockChange(
  lines: ReadonlyArray<string>,
  change: VimBlockChange,
  input: VimBlockChangeInput,
): VimBlockChangeResult {
  const nextLength = input.kind === "insert"
    ? change.insertedText.length
    : 0;
  const startColumn = change.startColumn + nextLength;
  const endColumn = change.startColumn + change.insertedText.length;
  const replacement = input.kind === "insert" ? input.text : "";
  const insertedText = input.kind === "insert"
    ? change.insertedText + input.text
    : change.insertedText.slice(0, nextLength);
  const eligible = new Set(change.eligibleLines);
  const nextLines = lines.map((line, lineIndex) => {
    if (!eligible.has(lineIndex)) {
      return line;
    }

    const padded = line.padEnd(startColumn, " ");
    return padded.slice(0, startColumn) + replacement + padded.slice(endColumn);
  });

  return {
    lines: nextLines,
    cursor: {
      line: change.startLine,
      column: change.startColumn + insertedText.length,
    },
    change: { ...change, insertedText },
  };
}

function textObjectBounds(
  lines: ReadonlyArray<string>,
  range: VimMotionRange,
): Readonly<{ start: VimPosition; end: VimPosition }> {
  if (range.kind === "line") {
    const endLine = lineAt(lines, range.endLine);
    return {
      start: { line: range.startLine, column: 0 },
      end: {
        line: range.endLine,
        column: endLine.length === 0
          ? 0
          : previousUnicodeCursorOffset(endLine, endLine.length),
      },
    };
  }

  const text = lines.join("\n");
  const endOffset = range.end === 0
    ? 0
    : previousUnicodeCursorOffset(text, range.end);
  return {
    start: vimPositionForTextOffset(lines, range.start, "character"),
    end: vimPositionForTextOffset(lines, endOffset, "character"),
  };
}

export function extendVimVisualSelection(
  lines: ReadonlyArray<string>,
  selection: Exclude<VimSelection, { kind: "none" }>,
  extension: VimVisualExtension,
): VimVisualExtensionResult {
  const bounds = extension.kind === "text-object"
    ? textObjectBounds(lines, extension.range)
    : undefined;
  const cursor = bounds?.end ?? extension.cursor;

  switch (selection.kind) {
    case "character":
      return {
        selection: {
          kind: "character",
          anchor: bounds?.start ?? selection.anchor,
          active: cursor,
        },
        cursor,
      };
    case "line":
      return {
        selection: {
          kind: "line",
          anchorLine: bounds?.start.line ?? selection.anchorLine,
          activeLine: cursor.line,
        },
        cursor,
      };
    case "block":
      return {
        selection: {
          kind: "block",
          anchor: bounds?.start ?? selection.anchor,
          active: cursor,
        },
        cursor,
      };
  }
}
