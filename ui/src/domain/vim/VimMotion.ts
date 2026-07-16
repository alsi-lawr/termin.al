import {
  nextUnicodeCursorOffset,
  normalizeUnicodeCursorOffset,
  previousUnicodeCursorOffset,
} from "../terminal/UnicodeCursor.ts";

export type VimMotion =
  | "left"
  | "right"
  | "line-next"
  | "line-previous"
  | "line-next-first-nonblank"
  | "line-previous-first-nonblank"
  | "line-start"
  | "line-first-nonblank"
  | "line-current"
  | "line-end"
  | "word-forward"
  | "WORD-forward"
  | "word-backward"
  | "WORD-backward"
  | "word-end"
  | "WORD-end"
  | "word-previous-end"
  | "WORD-previous-end"
  | "document-start"
  | "document-end"
  | "line-last-nonblank"
  | "sentence-backward"
  | "sentence-forward"
  | "paragraph-backward"
  | "paragraph-forward"
  | "section-start-backward"
  | "section-end-backward"
  | "section-start-forward"
  | "section-end-forward"
  | "match-pair"
  | "percentage";

export type VimTextObject =
  | "word"
  | "WORD"
  | "sentence"
  | "paragraph"
  | "double-quote"
  | "single-quote"
  | "backtick-quote"
  | "square-brackets"
  | "round-brackets"
  | "angle-brackets"
  | "curly-brackets"
  | "tag";

export type VimFindMotion = "f" | "F" | "t" | "T";

export type VimLastFind =
  | Readonly<{ kind: "none" }>
  | Readonly<{
      kind: "present";
      motion: VimFindMotion;
      target: string;
    }>;

export type VimGoalColumn =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "present"; column: number }>;

export type VimMotionRequest =
  | Readonly<{ kind: "motion"; motion: VimMotion }>
  | Readonly<{
      kind: "find";
      motion: VimFindMotion;
      target: string;
    }>
  | Readonly<{
      kind: "mark";
      target: Readonly<{ line: number; column: number }>;
      linewise: boolean;
    }>
  | Readonly<{
      kind: "text-object";
      object: VimTextObject;
      around: boolean;
    }>;

export type VimCharacterRange = Readonly<{
  kind: "character";
  start: number;
  end: number;
  inclusivity: "inclusive" | "exclusive";
}>;

export type VimLineRange = Readonly<{
  kind: "line";
  startLine: number;
  endLine: number;
}>;

export type VimMotionRange = VimCharacterRange | VimLineRange;

export type VimResolvedMotion = Readonly<{
  cursor: Readonly<{ line: number; column: number }>;
  range: VimMotionRange;
  goalColumn: VimGoalColumn;
}>;

export type VimMotionResolution =
  | Readonly<{ kind: "resolved"; motion: VimResolvedMotion }>
  | Readonly<{ kind: "invalid" }>;

export type ResolveVimMotionOptions = Readonly<{
  lines: ReadonlyArray<string>;
  cursor: Readonly<{ line: number; column: number }>;
  request: VimMotionRequest;
  count: number;
  goalColumn: VimGoalColumn;
}>;

const smallWordCharacterPattern = /[\p{L}\p{N}_]/u;
const openingPairs = new Map<string, string>([
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
]);
const closingPairs = new Map<string, string>([
  [")", "("],
  ["]", "["],
  ["}", "{"],
]);

function joinLines(lines: ReadonlyArray<string>): string {
  return lines.join("\n");
}

function lineAt(lines: ReadonlyArray<string>, line: number): string {
  const value = lines[line];

  if (value === undefined) {
    throw new Error("Vim cursor lines must reference existing text.");
  }

  return value;
}

export function vimLineStartOffset(lines: ReadonlyArray<string>, line: number): number {
  let offset = 0;

  for (let index = 0; index < line; index += 1) {
    offset += lineAt(lines, index).length + 1;
  }

  return offset;
}

export function vimTextOffsetForPosition(
  lines: ReadonlyArray<string>,
  position: Readonly<{ line: number; column: number }>,
): number {
  const line = lineAt(lines, position.line);
  const column = normalizeUnicodeCursorOffset(
    line,
    Math.max(0, Math.min(line.length, position.column)),
  );

  return vimLineStartOffset(lines, position.line) + column;
}

function lastCursorColumn(line: string): number {
  return line.length === 0
    ? 0
    : previousUnicodeCursorOffset(line, line.length);
}

function firstNonblankColumn(line: string): number {
  let column = 0;

  while (column < line.length) {
    const next = nextUnicodeCursorOffset(line, column);

    if (!/^\s$/u.test(line.slice(column, next))) {
      return column;
    }

    column = next;
  }

  return 0;
}

function lastNonblankColumn(line: string): number {
  let column = line.length;

  while (column > 0) {
    const previous = previousUnicodeCursorOffset(line, column);

    if (!/^\s$/u.test(line.slice(previous, column))) {
      return previous;
    }

    column = previous;
  }

  return 0;
}

export function vimPositionForTextOffset(
  lines: ReadonlyArray<string>,
  offset: number,
  boundary: "character" | "insertion",
): Readonly<{ line: number; column: number }> {
  const text = joinLines(lines);
  const safeOffset = normalizeUnicodeCursorOffset(
    text,
    Math.max(0, Math.min(text.length, offset)),
  );
  let remaining: number = safeOffset;

  for (let line = 0; line < lines.length; line += 1) {
    const value = lineAt(lines, line);

    if (remaining <= value.length) {
      const maximumColumn =
        boundary === "insertion" ? value.length : lastCursorColumn(value);

      return {
        line,
        column: Math.min(
          normalizeUnicodeCursorOffset(value, remaining),
          maximumColumn,
        ),
      };
    }

    remaining -= value.length + 1;
  }

  const line = lines.length - 1;
  const value = lineAt(lines, line);
  const column =
    boundary === "insertion" ? value.length : lastCursorColumn(value);

  return { line, column };
}

function characterAt(text: string, offset: number): string {
  const start = normalizeUnicodeCursorOffset(text, offset);
  return text.slice(start, nextUnicodeCursorOffset(text, start));
}

function wordClass(
  character: string,
  size: "small" | "big",
): "blank" | "word" | "punctuation" {
  if (/^\s$/u.test(character)) {
    return "blank";
  }

  if (size === "big" || smallWordCharacterPattern.test(character)) {
    return "word";
  }

  return "punctuation";
}

function emptyLineOffsets(lines: ReadonlyArray<string>): ReadonlySet<number> {
  const offsets = new Set<number>();
  let offset = 0;

  for (let line = 0; line < lines.length; line += 1) {
    const value = lineAt(lines, line);

    if (value.length === 0) {
      offsets.add(offset);
    }

    offset += value.length + 1;
  }

  return offsets;
}

function nextWordStart(
  text: string,
  emptyOffsets: ReadonlySet<number>,
  offset: number,
  size: "small" | "big",
): number {
  let position = normalizeUnicodeCursorOffset(text, offset);

  if (position >= text.length) {
    return position;
  }

  if (emptyOffsets.has(position)) {
    return nextUnicodeCursorOffset(text, position);
  }

  const initialClass = wordClass(characterAt(text, position), size);

  if (initialClass !== "blank") {
    while (
      position < text.length &&
      wordClass(characterAt(text, position), size) === initialClass
    ) {
      position = nextUnicodeCursorOffset(text, position);
    }
  }

  while (position < text.length) {
    if (emptyOffsets.has(position)) {
      return position;
    }

    if (wordClass(characterAt(text, position), size) !== "blank") {
      return position;
    }

    position = nextUnicodeCursorOffset(text, position);
  }

  return position;
}

function previousWordStart(
  text: string,
  emptyOffsets: ReadonlySet<number>,
  offset: number,
  size: "small" | "big",
): number {
  if (offset <= 0) {
    return 0;
  }

  let position = previousUnicodeCursorOffset(text, offset);

  while (
    position > 0 &&
    wordClass(characterAt(text, position), size) === "blank"
  ) {
    if (emptyOffsets.has(position)) {
      return position;
    }

    position = previousUnicodeCursorOffset(text, position);
  }

  const targetClass = wordClass(characterAt(text, position), size);

  while (position > 0) {
    const previous = previousUnicodeCursorOffset(text, position);

    if (wordClass(characterAt(text, previous), size) !== targetClass) {
      break;
    }

    position = previous;
  }

  return position;
}

function nextWordEnd(
  text: string,
  offset: number,
  size: "small" | "big",
): number {
  if (text.length === 0) {
    return 0;
  }

  let position = normalizeUnicodeCursorOffset(text, offset);

  while (
    position < text.length &&
    wordClass(characterAt(text, position), size) === "blank"
  ) {
    position = nextUnicodeCursorOffset(text, position);
  }

  if (position >= text.length) {
    return previousUnicodeCursorOffset(text, text.length);
  }

  const targetClass = wordClass(characterAt(text, position), size);

  while (position < text.length) {
    const next = nextUnicodeCursorOffset(text, position);

    if (
      next >= text.length ||
      wordClass(characterAt(text, next), size) !== targetClass
    ) {
      return position;
    }

    position = next;
  }

  return position;
}

function previousWordEnd(
  text: string,
  offset: number,
  size: "small" | "big",
): number {
  if (offset <= 0) {
    return 0;
  }

  let position = previousUnicodeCursorOffset(text, offset);
  const currentClass = wordClass(characterAt(text, position), size);

  if (currentClass !== "blank") {
    while (position > 0) {
      const previous = previousUnicodeCursorOffset(text, position);

      if (wordClass(characterAt(text, previous), size) !== currentClass) {
        break;
      }

      position = previous;
    }

    if (position > 0) {
      position = previousUnicodeCursorOffset(text, position);
    }
  }

  while (
    position > 0 &&
    wordClass(characterAt(text, position), size) === "blank"
  ) {
    position = previousUnicodeCursorOffset(text, position);
  }

  return position;
}

function repeatBounded(
  start: number,
  count: number,
  move: (position: number) => number,
): number {
  let position = start;
  let repetition = 0;

  while (repetition < count) {
    const next = move(position);

    if (next === position) {
      return position;
    }

    position = next;
    repetition += 1;
  }

  return position;
}

function orderedLineRange(originLine: number, targetLine: number): VimLineRange {
  return {
    kind: "line",
    startLine: Math.min(originLine, targetLine),
    endLine: Math.max(originLine, targetLine),
  };
}

function exclusiveRange(
  start: number,
  end: number,
): VimCharacterRange {
  return {
    kind: "character",
    start: Math.min(start, end),
    end: Math.max(start, end),
    inclusivity: "exclusive",
  };
}

function inclusiveForwardRange(
  text: string,
  start: number,
  target: number,
): VimCharacterRange {
  return {
    kind: "character",
    start,
    end: nextUnicodeCursorOffset(text, target),
    inclusivity: "inclusive",
  };
}

function inclusiveBackwardRange(
  text: string,
  target: number,
  origin: number,
): VimCharacterRange {
  return {
    kind: "character",
    start: target,
    end: nextUnicodeCursorOffset(text, origin),
    inclusivity: "inclusive",
  };
}

function exclusiveBackwardRange(
  text: string,
  target: number,
  origin: number,
): VimCharacterRange {
  return {
    kind: "character",
    start: nextUnicodeCursorOffset(text, target),
    end: nextUnicodeCursorOffset(text, origin),
    inclusivity: "exclusive",
  };
}

function resolveHorizontal(
  options: ResolveVimMotionOptions,
  direction: "backward" | "forward",
): VimMotionResolution {
  const line = lineAt(options.lines, options.cursor.line);
  let column = options.cursor.column;
  let moved = 0;

  while (moved < options.count) {
    let next = column;

    if (direction === "backward") {
      next = previousUnicodeCursorOffset(line, column);
    } else if (column < lastCursorColumn(line)) {
      next = nextUnicodeCursorOffset(line, column);
    }

    if (next === column) {
      break;
    }

    column = next;
    moved += 1;
  }

  if (moved === 0) {
    return { kind: "invalid" };
  }

  const origin = vimTextOffsetForPosition(options.lines, options.cursor);
  const targetPosition = { line: options.cursor.line, column };
  const target = vimTextOffsetForPosition(options.lines, targetPosition);

  return {
    kind: "resolved",
    motion: {
      cursor: targetPosition,
      range: exclusiveRange(origin, target),
      goalColumn: { kind: "none" },
    },
  };
}

function resolveVertical(
  options: ResolveVimMotionOptions,
  direction: "previous" | "next",
  target: "goal-column" | "first-nonblank",
): VimMotionResolution {
  const available =
    direction === "previous"
      ? options.cursor.line
      : options.lines.length - options.cursor.line - 1;
  const distance = Math.min(options.count, available);

  if (distance === 0) {
    return { kind: "invalid" };
  }

  const line =
    direction === "previous"
      ? options.cursor.line - distance
      : options.cursor.line + distance;
  const value = lineAt(options.lines, line);
  const desiredColumn =
    options.goalColumn.kind === "present"
      ? options.goalColumn.column
      : options.cursor.column;
  const column =
    target === "first-nonblank"
      ? firstNonblankColumn(value)
      : Math.min(lastCursorColumn(value), desiredColumn);

  return {
    kind: "resolved",
    motion: {
      cursor: { line, column },
      range: orderedLineRange(options.cursor.line, line),
      goalColumn:
        target === "goal-column"
          ? { kind: "present", column: desiredColumn }
          : { kind: "none" },
    },
  };
}

function resolveLineTarget(
  options: ResolveVimMotionOptions,
  motion: "line-start" | "line-first-nonblank" | "line-last-nonblank",
): VimMotionResolution {
  const line = lineAt(options.lines, options.cursor.line);
  let column = 0;

  if (motion === "line-first-nonblank") {
    column = firstNonblankColumn(line);
  } else if (motion === "line-last-nonblank") {
    column = lastNonblankColumn(line);
  }

  const origin = vimTextOffsetForPosition(options.lines, options.cursor);
  const targetPosition = { line: options.cursor.line, column };
  const target = vimTextOffsetForPosition(options.lines, targetPosition);
  const text = joinLines(options.lines);
  let range = exclusiveRange(origin, target);

  if (motion === "line-last-nonblank") {
    range =
      target >= origin
        ? inclusiveForwardRange(text, origin, target)
        : inclusiveBackwardRange(text, target, origin);
  }

  return {
    kind: "resolved",
    motion: {
      cursor: targetPosition,
      range,
      goalColumn: { kind: "none" },
    },
  };
}

function resolveRelativeLine(
  options: ResolveVimMotionOptions,
  target: "first-nonblank" | "last-character",
): VimMotionResolution {
  const available = options.lines.length - options.cursor.line;

  if (target === "last-character" && options.count > available) {
    return { kind: "invalid" };
  }

  const distance = Math.min(options.count, available) - 1;
  const line = options.cursor.line + distance;
  const value = lineAt(options.lines, line);
  const column =
    target === "first-nonblank"
      ? firstNonblankColumn(value)
      : lastCursorColumn(value);
  const cursor = { line, column };

  if (target === "first-nonblank") {
    return {
      kind: "resolved",
      motion: {
        cursor,
        range: orderedLineRange(options.cursor.line, line),
        goalColumn: { kind: "none" },
      },
    };
  }

  const text = joinLines(options.lines);
  const origin = vimTextOffsetForPosition(options.lines, options.cursor);
  const targetOffset = vimTextOffsetForPosition(options.lines, cursor);

  return {
    kind: "resolved",
    motion: {
      cursor,
      range: inclusiveForwardRange(text, origin, targetOffset),
      goalColumn: { kind: "none" },
    },
  };
}

function resolveDocumentLine(
  options: ResolveVimMotionOptions,
  end: "start" | "end",
): VimMotionResolution {
  let requestedLine = Math.min(options.count - 1, options.lines.length - 1);

  if (end === "start" && options.count === 1) {
    requestedLine = 0;
  } else if (end === "end" && options.count === 1) {
    requestedLine = options.lines.length - 1;
  }
  const value = lineAt(options.lines, requestedLine);
  const cursor = {
    line: requestedLine,
    column: firstNonblankColumn(value),
  };

  return {
    kind: "resolved",
    motion: {
      cursor,
      range: orderedLineRange(options.cursor.line, requestedLine),
      goalColumn: { kind: "none" },
    },
  };
}

function resolvePercentage(options: ResolveVimMotionOptions): VimMotionResolution {
  if (options.count < 1 || options.count > 100) {
    return { kind: "invalid" };
  }

  const line = Math.max(
    0,
    Math.min(
      options.lines.length - 1,
      Math.ceil((options.count * options.lines.length) / 100) - 1,
    ),
  );
  const cursor = {
    line,
    column: firstNonblankColumn(lineAt(options.lines, line)),
  };

  return {
    kind: "resolved",
    motion: {
      cursor,
      range: orderedLineRange(options.cursor.line, line),
      goalColumn: { kind: "none" },
    },
  };
}

function resolveWord(
  options: ResolveVimMotionOptions,
  direction: "forward" | "backward" | "end" | "previous-end",
  size: "small" | "big",
): VimMotionResolution {
  const text = joinLines(options.lines);
  const emptyOffsets = emptyLineOffsets(options.lines);
  const origin = vimTextOffsetForPosition(options.lines, options.cursor);
  const target = repeatBounded(origin, options.count, (position) => {
    switch (direction) {
      case "forward":
        return nextWordStart(text, emptyOffsets, position, size);
      case "backward":
        return previousWordStart(text, emptyOffsets, position, size);
      case "end": {
        const end = nextWordEnd(text, position, size);

        if (end === position && end < text.length) {
          return nextWordEnd(
            text,
            nextUnicodeCursorOffset(text, end),
            size,
          );
        }

        return end;
      }
      case "previous-end":
        return previousWordEnd(text, position, size);
    }
  });

  if (target === origin) {
    return { kind: "invalid" };
  }

  const cursor = vimPositionForTextOffset(options.lines, target, "character");
  const inclusive = direction === "end" || direction === "previous-end";
  let range = exclusiveRange(origin, target);

  if (inclusive) {
    range =
      target > origin
        ? inclusiveForwardRange(text, origin, target)
        : inclusiveBackwardRange(text, target, origin);
  }

  return {
    kind: "resolved",
    motion: {
      cursor,
      range,
      goalColumn: { kind: "none" },
    },
  };
}

function findTargetColumn(
  line: string,
  origin: number,
  direction: "forward" | "backward",
  target: string,
  count: number,
): number | undefined {
  let column = origin;
  let found = 0;

  while (found < count) {
    const next =
      direction === "forward"
        ? nextUnicodeCursorOffset(line, column)
        : previousUnicodeCursorOffset(line, column);

    if (next === column) {
      return undefined;
    }

    column = next;

    if (line.slice(column, nextUnicodeCursorOffset(line, column)) === target) {
      found += 1;
    }
  }

  return column;
}

function resolveFind(
  options: ResolveVimMotionOptions,
  motion: VimFindMotion,
  targetCharacter: string,
): VimMotionResolution {
  const line = lineAt(options.lines, options.cursor.line);
  const direction = motion === "f" || motion === "t" ? "forward" : "backward";
  const found = findTargetColumn(
    line,
    options.cursor.column,
    direction,
    targetCharacter,
    options.count,
  );

  if (found === undefined) {
    return { kind: "invalid" };
  }

  let column = found;

  if (motion === "t") {
    column = previousUnicodeCursorOffset(line, found);
  } else if (motion === "T") {
    column = nextUnicodeCursorOffset(line, found);
  }

  const cursor = { line: options.cursor.line, column };
  const text = joinLines(options.lines);
  const origin = vimTextOffsetForPosition(options.lines, options.cursor);
  const target = vimTextOffsetForPosition(options.lines, cursor);
  let range: VimCharacterRange;

  if (motion === "f" || motion === "t") {
    range = inclusiveForwardRange(text, origin, target);
  } else if (motion === "F") {
    range = exclusiveBackwardRange(text, target, origin);
  } else {
    range = exclusiveBackwardRange(
      text,
      previousUnicodeCursorOffset(text, target),
      origin,
    );
  }

  return {
    kind: "resolved",
    motion: {
      cursor,
      range,
      goalColumn: { kind: "none" },
    },
  };
}

function delimiterAtOrAfterCursor(
  lines: ReadonlyArray<string>,
  cursor: Readonly<{ line: number; column: number }>,
): Readonly<{ character: string; offset: number }> | undefined {
  const line = lineAt(lines, cursor.line);
  let column = cursor.column;

  while (column < line.length) {
    const character = line.slice(column, nextUnicodeCursorOffset(line, column));

    if (openingPairs.has(character) || closingPairs.has(character)) {
      return {
        character,
        offset: vimLineStartOffset(lines, cursor.line) + column,
      };
    }

    column = nextUnicodeCursorOffset(line, column);
  }

  return undefined;
}

function matchingDelimiterOffset(
  text: string,
  delimiter: Readonly<{ character: string; offset: number }>,
): number | undefined {
  const closing = openingPairs.get(delimiter.character);

  if (closing !== undefined) {
    let depth = 1;
    let offset = nextUnicodeCursorOffset(text, delimiter.offset);

    while (offset < text.length) {
      const character = characterAt(text, offset);

      if (character === delimiter.character) {
        depth += 1;
      } else if (character === closing) {
        depth -= 1;

        if (depth === 0) {
          return offset;
        }
      }

      offset = nextUnicodeCursorOffset(text, offset);
    }

    return undefined;
  }

  const opening = closingPairs.get(delimiter.character);

  if (opening === undefined) {
    return undefined;
  }

  let depth = 1;
  let offset = delimiter.offset;

  while (offset > 0) {
    offset = previousUnicodeCursorOffset(text, offset);
    const character = characterAt(text, offset);

    if (character === delimiter.character) {
      depth += 1;
    } else if (character === opening) {
      depth -= 1;

      if (depth === 0) {
        return offset;
      }
    }
  }

  return undefined;
}

function resolveMatchPair(options: ResolveVimMotionOptions): VimMotionResolution {
  const text = joinLines(options.lines);
  const delimiter = delimiterAtOrAfterCursor(options.lines, options.cursor);

  if (delimiter === undefined) {
    return { kind: "invalid" };
  }

  const target = matchingDelimiterOffset(text, delimiter);

  if (target === undefined) {
    return { kind: "invalid" };
  }

  const origin = vimTextOffsetForPosition(options.lines, options.cursor);
  const cursor = vimPositionForTextOffset(options.lines, target, "character");
  const range =
    target >= origin
      ? inclusiveForwardRange(text, origin, target)
      : inclusiveBackwardRange(text, target, origin);

  return {
    kind: "resolved",
    motion: {
      cursor,
      range,
      goalColumn: { kind: "none" },
    },
  };
}

const paragraphMacroPairs = "IPLPPPQPP TPHPLIPpLpItpplpipbp";
const sectionMacroPairs = "SHNHH HUnhsh";

type OffsetSpan = Readonly<{ start: number; end: number }>;
type TagToken = Readonly<{
  kind: "open" | "close";
  name: string;
  start: number;
  end: number;
}>;
type TagEndScan =
  | Readonly<{ kind: "complete"; end: number }>
  | Readonly<{ kind: "malformed"; next: number }>;

function sortedUnique(values: ReadonlyArray<number>): ReadonlyArray<number> {
  return [...new Set(values)].sort((left, right) => left - right);
}

function lineStarts(lines: ReadonlyArray<string>): ReadonlyArray<number> {
  const starts: Array<number> = [];
  let offset = 0;

  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }

  return starts;
}

function matchesRoffMacro(line: string, pairs: string): boolean {
  if (!line.startsWith(".") || line.length < 2) {
    return false;
  }

  const first = line.slice(1, 2);
  const second = line.slice(2, 3);

  if (second === " ") {
    for (let index = 0; index < pairs.length; index += 2) {
      if (pairs.slice(index, index + 1) === first) {
        return true;
      }
    }

    return false;
  }

  const pair = first + second;

  for (let index = 0; index < pairs.length; index += 2) {
    if (pairs.slice(index, index + 2) === pair) {
      return true;
    }
  }

  return false;
}

function sectionBoundaryLines(lines: ReadonlyArray<string>): ReadonlyArray<number> {
  const boundaries = [0];

  for (let line = 0; line < lines.length; line += 1) {
    const value = lineAt(lines, line);

    if (
      value.startsWith("\f") ||
      value.startsWith("{") ||
      matchesRoffMacro(value, sectionMacroPairs)
    ) {
      boundaries.push(line);
    }
  }

  return sortedUnique(boundaries);
}

function paragraphBoundaryLines(
  lines: ReadonlyArray<string>,
  whitespaceOnly: boolean,
): ReadonlyArray<number> {
  const boundaries = [...sectionBoundaryLines(lines)];

  for (let line = 0; line < lines.length; line += 1) {
    const value = lineAt(lines, line);
    const blank = whitespaceOnly ? /^\s*$/u.test(value) : value.length === 0;

    if (blank || matchesRoffMacro(value, paragraphMacroPairs)) {
      boundaries.push(line);
    }
  }

  return sortedUnique(boundaries);
}

function sentenceBoundaryOffsets(lines: ReadonlyArray<string>): ReadonlyArray<number> {
  const text = joinLines(lines);
  const starts = lineStarts(lines);
  const boundaries: Array<number> = [0];

  for (const line of paragraphBoundaryLines(lines, false)) {
    const start = starts[line];

    if (start !== undefined) {
      boundaries.push(start, start + firstNonblankColumn(lineAt(lines, line)));
    }
  }

  let offset = 0;

  while (offset < text.length) {
    const character = characterAt(text, offset);

    if (character === "." || character === "!" || character === "?") {
      let after = nextUnicodeCursorOffset(text, offset);

      while (after < text.length && ")]\"'".includes(characterAt(text, after))) {
        after = nextUnicodeCursorOffset(text, after);
      }

      const atLineEnd = after >= text.length || characterAt(text, after) === "\n";
      const hasTwoSpaces = text.slice(after, after + 2) === "  ";

      if (atLineEnd || hasTwoSpaces) {
        let next = after;

        while (next < text.length && /^\s$/u.test(characterAt(text, next))) {
          next = nextUnicodeCursorOffset(text, next);
        }

        if (next < text.length) {
          boundaries.push(next);
        }
      }
    }

    offset = nextUnicodeCursorOffset(text, offset);
  }

  return sortedUnique(boundaries);
}

function countedBoundary(
  boundaries: ReadonlyArray<number>,
  origin: number,
  count: number,
  direction: "backward" | "forward",
): number | undefined {
  const candidates = boundaries.filter((boundary) =>
    direction === "backward" ? boundary < origin : boundary > origin,
  );
  const ordered = direction === "backward" ? [...candidates].reverse() : candidates;
  const availableIndex = Math.min(count, ordered.length) - 1;

  return availableIndex < 0 ? undefined : ordered[availableIndex];
}

function resolveBoundaryMotion(
  options: ResolveVimMotionOptions,
  boundaries: ReadonlyArray<number>,
  direction: "backward" | "forward",
): VimMotionResolution {
  const origin = vimTextOffsetForPosition(options.lines, options.cursor);
  const target = countedBoundary(boundaries, origin, options.count, direction);

  if (target === undefined) {
    return { kind: "invalid" };
  }

  const cursor = vimPositionForTextOffset(options.lines, target, "character");
  const linewiseEnd = Math.max(options.cursor.line, cursor.line) - 1;
  const range: VimMotionRange = cursor.column === 0 && cursor.line !== options.cursor.line
    ? {
        kind: "line",
        startLine: Math.min(options.cursor.line, cursor.line),
        endLine: linewiseEnd,
      }
    : exclusiveRange(origin, target);

  return {
    kind: "resolved",
    motion: {
      cursor,
      range,
      goalColumn: { kind: "none" },
    },
  };
}

function sectionTargetOffsets(
  lines: ReadonlyArray<string>,
  target: "start" | "end",
): ReadonlyArray<number> {
  const starts = lineStarts(lines);
  const offsets: Array<number> = [];

  for (let line = 0; line < lines.length; line += 1) {
    const value = lineAt(lines, line);
    const matches = target === "start"
      ? value.startsWith("{") || matchesRoffMacro(value, sectionMacroPairs) || value.startsWith("\f")
      : value.startsWith("}");

    if (matches) {
      const start = starts[line];

      if (start !== undefined) {
        offsets.push(start);
      }
    }
  }

  if (target === "start") {
    offsets.push(0);
  } else {
    const lastLine = lines.length - 1;
    const last = lineAt(lines, lastLine);
    const start = starts[lastLine];

    if (start !== undefined) {
      const terminalIsLineStart = last.length === 0 || last === "]]" || last === "}";
      offsets.push(terminalIsLineStart ? start : start + lastCursorColumn(last));
    }
  }

  return sortedUnique(offsets);
}

function resolveMark(
  options: ResolveVimMotionOptions,
  target: Readonly<{ line: number; column: number }>,
  linewise: boolean,
): VimMotionResolution {
  const targetLine = Math.max(0, Math.min(options.lines.length - 1, target.line));
  const targetColumn = linewise
    ? firstNonblankColumn(lineAt(options.lines, targetLine))
    : target.column;
  const cursor = vimPositionForTextOffset(
    options.lines,
    vimTextOffsetForPosition(options.lines, { line: targetLine, column: targetColumn }),
    "character",
  );
  const range = linewise
    ? orderedLineRange(options.cursor.line, cursor.line)
    : exclusiveRange(
        vimTextOffsetForPosition(options.lines, options.cursor),
        vimTextOffsetForPosition(options.lines, cursor),
      );

  return {
    kind: "resolved",
    motion: { cursor, range, goalColumn: { kind: "none" } },
  };
}

function trimSpan(text: string, span: OffsetSpan): OffsetSpan | undefined {
  let start = span.start;
  let end = span.end;

  while (start < end && /^\s$/u.test(characterAt(text, start))) {
    start = nextUnicodeCursorOffset(text, start);
  }

  while (end > start) {
    const previous = previousUnicodeCursorOffset(text, end);

    if (!/^\s$/u.test(characterAt(text, previous))) {
      break;
    }

    end = previous;
  }

  return start === end ? undefined : { start, end };
}

function aroundWhitespace(text: string, span: OffsetSpan): OffsetSpan {
  let end = span.end;

  while (end < text.length && /^\s$/u.test(characterAt(text, end))) {
    end = nextUnicodeCursorOffset(text, end);
  }

  if (end > span.end) {
    return { start: span.start, end };
  }

  let start = span.start;

  while (start > 0) {
    const previous = previousUnicodeCursorOffset(text, start);

    if (!/^\s$/u.test(characterAt(text, previous))) {
      break;
    }

    start = previous;
  }

  return { start, end: span.end };
}

function wordSpans(text: string, size: "small" | "big"): ReadonlyArray<OffsetSpan> {
  const spans: Array<OffsetSpan> = [];
  let start = 0;

  while (start < text.length) {
    const targetClass = wordClass(characterAt(text, start), size);
    let end = nextUnicodeCursorOffset(text, start);

    while (end < text.length && wordClass(characterAt(text, end), size) === targetClass) {
      end = nextUnicodeCursorOffset(text, end);
    }

    spans.push({ start, end });
    start = end;
  }

  return spans;
}

function spanContainingOrFollowing(
  spans: ReadonlyArray<OffsetSpan>,
  cursor: number,
): number | undefined {
  const containing = spans.findIndex((span) => cursor >= span.start && cursor < span.end);

  if (containing >= 0) {
    return containing;
  }

  const following = spans.findIndex((span) => span.start >= cursor);
  return following >= 0 ? following : undefined;
}

function resolveWordObject(
  options: ResolveVimMotionOptions,
  size: "small" | "big",
  around: boolean,
): OffsetSpan | undefined {
  const text = joinLines(options.lines);
  const spans = wordSpans(text, size);
  const cursor = vimTextOffsetForPosition(options.lines, options.cursor);
  const first = spanContainingOrFollowing(spans, cursor);

  if (first === undefined) {
    return undefined;
  }

  let selectedFirst = first;
  let selectedLast = first;
  const spanIsBlank = (index: number): boolean => {
    const span = spans[index];
    return span === undefined || wordClass(characterAt(text, span.start), size) === "blank";
  };

  if (around) {
    while (selectedFirst < spans.length && spanIsBlank(selectedFirst)) {
      selectedFirst += 1;
    }

    if (selectedFirst >= spans.length) {
      selectedFirst = first;

      while (selectedFirst > 0 && spanIsBlank(selectedFirst)) {
        selectedFirst -= 1;
      }
    }
  }

  if (around) {
    selectedLast = selectedFirst;
    let selectedObjects = 1;

    while (selectedObjects < options.count) {
      let next = selectedLast + 1;

      while (next < spans.length && spanIsBlank(next)) {
        next += 1;
      }

      if (next >= spans.length) {
        break;
      }

      selectedLast = next;
      selectedObjects += 1;
    }
  } else {
    selectedLast = Math.min(spans.length - 1, first + options.count - 1);
  }

  const firstSpan = spans[selectedFirst];
  const lastSpan = spans[selectedLast];

  if (firstSpan === undefined || lastSpan === undefined) {
    return undefined;
  }

  const span = { start: firstSpan.start, end: lastSpan.end };
  return around ? aroundWhitespace(text, span) : span;
}

function sentenceSpans(lines: ReadonlyArray<string>): ReadonlyArray<OffsetSpan> {
  const text = joinLines(lines);
  const boundaries = sentenceBoundaryOffsets(lines);
  const spans: Array<OffsetSpan> = [];

  for (let index = 0; index < boundaries.length; index += 1) {
    const start = boundaries[index];
    const next = boundaries[index + 1] ?? text.length;

    if (start !== undefined && next > start) {
      spans.push({ start, end: next });
    }
  }

  return spans;
}

function resolveSentenceObject(
  options: ResolveVimMotionOptions,
  around: boolean,
): OffsetSpan | undefined {
  const text = joinLines(options.lines);
  const spans = sentenceSpans(options.lines);
  const cursor = vimTextOffsetForPosition(options.lines, options.cursor);
  const first = spanContainingOrFollowing(spans, cursor);

  if (first === undefined) {
    return undefined;
  }

  const last = Math.min(spans.length - 1, first + options.count - 1);
  const firstSpan = spans[first];
  const lastSpan = spans[last];

  if (firstSpan === undefined || lastSpan === undefined) {
    return undefined;
  }

  const trimmed = trimSpan(text, { start: firstSpan.start, end: lastSpan.end });

  if (trimmed === undefined) {
    return undefined;
  }

  return around ? aroundWhitespace(text, trimmed) : trimmed;
}

function resolveParagraphObject(
  options: ResolveVimMotionOptions,
  around: boolean,
): VimLineRange | undefined {
  const firstLine = lineAt(options.lines, 0);
  const firstLineIsBoundary = /^\s*$/u.test(firstLine) ||
    matchesRoffMacro(firstLine, paragraphMacroPairs) ||
    matchesRoffMacro(firstLine, sectionMacroPairs) ||
    firstLine.startsWith("\f") ||
    firstLine.startsWith("{");
  const boundarySet = new Set(
    paragraphBoundaryLines(options.lines, true).filter(
      (line) => line !== 0 || firstLineIsBoundary,
    ),
  );
  let startLine = options.cursor.line;

  if (boundarySet.has(startLine)) {
    while (startLine < options.lines.length && boundarySet.has(startLine)) {
      startLine += 1;
    }
  }

  if (startLine >= options.lines.length) {
    return undefined;
  }

  while (startLine > 0 && !boundarySet.has(startLine - 1)) {
    startLine -= 1;
  }

  let endLine = startLine;
  let paragraphs = 1;

  while (paragraphs < options.count) {
    while (endLine + 1 < options.lines.length && !boundarySet.has(endLine + 1)) {
      endLine += 1;
    }

    let next = endLine + 1;

    while (next < options.lines.length && boundarySet.has(next)) {
      next += 1;
    }

    if (next >= options.lines.length) {
      break;
    }

    endLine = next;
    paragraphs += 1;
  }

  while (endLine + 1 < options.lines.length && !boundarySet.has(endLine + 1)) {
    endLine += 1;
  }

  if (around) {
    let separatorEnd = endLine;

    while (separatorEnd + 1 < options.lines.length && boundarySet.has(separatorEnd + 1)) {
      separatorEnd += 1;
    }

    if (separatorEnd > endLine) {
      endLine = separatorEnd;
    } else {
      while (startLine > 0 && boundarySet.has(startLine - 1)) {
        startLine -= 1;
      }
    }
  }

  return { kind: "line", startLine, endLine };
}

function resolveQuoteObject(
  options: ResolveVimMotionOptions,
  quote: string,
  around: boolean,
): OffsetSpan | undefined {
  const line = lineAt(options.lines, options.cursor.line);
  const lineStart = vimLineStartOffset(options.lines, options.cursor.line);
  const quotes: Array<number> = [];
  let column = 0;
  let escaped = false;

  while (column < line.length) {
    const character = characterAt(line, column);

    if (character === "\\") {
      escaped = !escaped;
    } else {
      if (character === quote && !escaped) {
        quotes.push(column);
      }

      escaped = false;
    }

    column = nextUnicodeCursorOffset(line, column);
  }

  for (let index = 0; index + 1 < quotes.length; index += 2) {
    const opening = quotes[index];
    const closing = quotes[index + 1];

    if (opening === undefined || closing === undefined) {
      continue;
    }

    if (options.cursor.column >= opening && options.cursor.column <= closing) {
      const includeDelimiters = around || (!around && options.count === 2);
      const start = lineStart + (includeDelimiters ? opening : nextUnicodeCursorOffset(line, opening));
      const end = lineStart + (includeDelimiters ? nextUnicodeCursorOffset(line, closing) : closing);

      if (start === end) {
        return around ? { start: lineStart + opening, end: lineStart + nextUnicodeCursorOffset(line, closing) } : undefined;
      }

      return around ? aroundWhitespace(joinLines(options.lines), { start, end }) : { start, end };
    }
  }

  return undefined;
}

function resolveDelimiterObject(
  options: ResolveVimMotionOptions,
  opening: string,
  closing: string,
  around: boolean,
): OffsetSpan | undefined {
  const text = joinLines(options.lines);
  const cursor = vimTextOffsetForPosition(options.lines, options.cursor);
  const enclosing: Array<OffsetSpan> = [];
  const stack: Array<Readonly<{ character: string; offset: number }>> = [];
  const firstOpeningIndices: Array<number | undefined> = [
    undefined,
    undefined,
    undefined,
    undefined,
  ];
  const objectOpenings = "([{<";
  const objectClosings = ")]}>";
  let offset = 0;
  let escaped = false;

  while (offset < text.length) {
    const character = characterAt(text, offset);

    if (character === "\\") {
      escaped = !escaped;
    } else {
      const delimiterIsEscaped = escaped;
      escaped = false;

      if (!delimiterIsEscaped) {
        const openingIndex = objectOpenings.indexOf(character);
        const closingIndex = objectClosings.indexOf(character);

        if (openingIndex >= 0) {
          if (firstOpeningIndices[openingIndex] === undefined) {
            firstOpeningIndices[openingIndex] = stack.length;
          }

          stack.push({ character, offset });
        } else if (closingIndex >= 0) {
          const expectedOpening = objectOpenings.slice(closingIndex, closingIndex + 1);
          const candidate = stack.at(-1);

          if (candidate?.character === expectedOpening) {
            const removedIndex = stack.length - 1;
            stack.pop();

            if (firstOpeningIndices[closingIndex] === removedIndex) {
              firstOpeningIndices[closingIndex] = undefined;
            }

            if (
              candidate.character === opening &&
              character === closing &&
              cursor >= candidate.offset &&
              cursor <= offset
            ) {
              enclosing.push({
                start: candidate.offset,
                end: nextUnicodeCursorOffset(text, offset),
              });
            }
          } else {
            const crossed = firstOpeningIndices[closingIndex];

            if (crossed !== undefined) {
              while (stack.length > crossed) {
                const removedIndex = stack.length - 1;
                const removed = stack.pop();

                if (removed === undefined) {
                  throw new Error("Vim delimiter stack truncation must remove an opening.");
                }

                const removedType = objectOpenings.indexOf(removed.character);

                if (firstOpeningIndices[removedType] === removedIndex) {
                  firstOpeningIndices[removedType] = undefined;
                }
              }
            }
          }
        }
      }
    }

    offset = nextUnicodeCursorOffset(text, offset);
  }

  const selected = enclosing[Math.min(options.count, enclosing.length) - 1];

  if (selected === undefined) {
    return undefined;
  }

  const span = around
    ? selected
    : {
        start: nextUnicodeCursorOffset(text, selected.start),
        end: previousUnicodeCursorOffset(text, selected.end),
      };

  return span.start === span.end ? undefined : span;
}

function scanTagEnd(text: string, start: number): TagEndScan {
  let quote: string | undefined;
  let quotedRecovery: number | undefined;
  let offset = start;

  while (offset < text.length) {
    const character = characterAt(text, offset);

    if (quote !== undefined) {
      if (character === quote) {
        quote = undefined;
      } else if (character === "<" && quotedRecovery === undefined) {
        quotedRecovery = offset;
      }
    } else if (character === "\"" || character === "'") {
      quote = character;
    } else if (character === "<") {
      return { kind: "malformed", next: offset };
    } else if (character === ">") {
      return { kind: "complete", end: nextUnicodeCursorOffset(text, offset) };
    }

    offset = nextUnicodeCursorOffset(text, offset);
  }

  return { kind: "malformed", next: quotedRecovery ?? start };
}

function tagTokens(text: string): ReadonlyArray<TagToken> {
  const tokens: Array<TagToken> = [];
  let offset = 0;
  let commentsCannotClose = false;

  while (offset < text.length) {
    if (characterAt(text, offset) !== "<") {
      offset = nextUnicodeCursorOffset(text, offset);
      continue;
    }

    if (text.startsWith("<!--", offset)) {
      const commentEnd = commentsCannotClose
        ? -1
        : text.indexOf("-->", offset + 4);

      if (commentEnd < 0) {
        commentsCannotClose = true;
        offset += 4;
        continue;
      }

      offset = commentEnd + 3;
      continue;
    }

    const scanned = scanTagEnd(text, nextUnicodeCursorOffset(text, offset));

    if (scanned.kind === "malformed") {
      offset = scanned.next;
      continue;
    }

    const end = scanned.end;

    const source = text.slice(offset + 1, end - 1).trim();
    const skipped = source.length === 0 || source.startsWith("!") || source.startsWith("?") || source.endsWith("/");

    if (!skipped) {
      const close = source.startsWith("/");
      const nameSource = close ? source.slice(1).trimStart() : source;
      const match = /^[A-Za-z][A-Za-z0-9:._-]*/u.exec(nameSource);

      if (match !== null) {
        const remainder = nameSource.slice(match[0].length);

        if (close && remainder.trim().length > 0) {
          offset = end;
          continue;
        }

        tokens.push({
          kind: close ? "close" : "open",
          name: match[0].toLowerCase(),
          start: offset,
          end,
        });
      }
    }

    offset = end;
  }

  return tokens;
}

function popTagOpening(
  stack: Array<TagToken>,
  firstOpeningIndices: Map<string, number>,
): TagToken {
  const removedIndex = stack.length - 1;
  const removed = stack.pop();

  if (removed === undefined) {
    throw new Error("Vim tag stack truncation must remove an opening tag.");
  }

  if (firstOpeningIndices.get(removed.name) === removedIndex) {
    firstOpeningIndices.delete(removed.name);
  }

  return removed;
}

function resolveTagObject(
  options: ResolveVimMotionOptions,
  around: boolean,
): OffsetSpan | undefined {
  const text = joinLines(options.lines);
  const cursor = vimTextOffsetForPosition(options.lines, options.cursor);
  const stack: Array<TagToken> = [];
  const firstOpeningIndices = new Map<string, number>();
  const enclosing: Array<Readonly<{ open: TagToken; close: TagToken }>> = [];

  for (const token of tagTokens(text)) {
    if (token.kind === "open") {
      if (!firstOpeningIndices.has(token.name)) {
        firstOpeningIndices.set(token.name, stack.length);
      }

      stack.push(token);
      continue;
    }

    const open = stack.at(-1);

    if (open?.name !== token.name) {
      const crossed = firstOpeningIndices.get(token.name);

      if (crossed !== undefined) {
        while (stack.length > crossed) {
          popTagOpening(stack, firstOpeningIndices);
        }
      }

      continue;
    }

    popTagOpening(stack, firstOpeningIndices);

    if (cursor >= open.start && cursor < token.end) {
      enclosing.push({ open, close: token });
    }
  }

  const pair = enclosing[Math.min(options.count, enclosing.length) - 1];

  if (pair === undefined) {
    return undefined;
  }

  if (around) {
    return { start: pair.open.start, end: pair.close.end };
  }

  if (pair.open.end === pair.close.start) {
    return { start: pair.open.start, end: pair.open.end };
  }

  return { start: pair.open.end, end: pair.close.start };
}

function resolveTextObject(options: ResolveVimMotionOptions): VimMotionResolution {
  if (options.request.kind !== "text-object") {
    return { kind: "invalid" };
  }

  if (options.request.object === "paragraph") {
    const range = resolveParagraphObject(options, options.request.around);

    if (range === undefined) {
      return { kind: "invalid" };
    }

    return {
      kind: "resolved",
      motion: {
        cursor: { line: range.startLine, column: firstNonblankColumn(lineAt(options.lines, range.startLine)) },
        range,
        goalColumn: { kind: "none" },
      },
    };
  }

  let span: OffsetSpan | undefined;

  switch (options.request.object) {
    case "word":
      span = resolveWordObject(options, "small", options.request.around);
      break;
    case "WORD":
      span = resolveWordObject(options, "big", options.request.around);
      break;
    case "sentence":
      span = resolveSentenceObject(options, options.request.around);
      break;
    case "double-quote":
      span = resolveQuoteObject(options, "\"", options.request.around);
      break;
    case "single-quote":
      span = resolveQuoteObject(options, "'", options.request.around);
      break;
    case "backtick-quote":
      span = resolveQuoteObject(options, "`", options.request.around);
      break;
    case "square-brackets":
      span = resolveDelimiterObject(options, "[", "]", options.request.around);
      break;
    case "round-brackets":
      span = resolveDelimiterObject(options, "(", ")", options.request.around);
      break;
    case "angle-brackets":
      span = resolveDelimiterObject(options, "<", ">", options.request.around);
      break;
    case "curly-brackets":
      span = resolveDelimiterObject(options, "{", "}", options.request.around);
      break;
    case "tag":
      span = resolveTagObject(options, options.request.around);
      break;
  }

  if (span === undefined || span.start === span.end) {
    return { kind: "invalid" };
  }

  return {
    kind: "resolved",
    motion: {
      cursor: vimPositionForTextOffset(options.lines, span.start, "character"),
      range: {
        kind: "character",
        start: normalizeUnicodeCursorOffset(joinLines(options.lines), span.start),
        end: normalizeUnicodeCursorOffset(joinLines(options.lines), span.end),
        inclusivity: "inclusive",
      },
      goalColumn: { kind: "none" },
    },
  };
}

export function resolveVimMotion(
  options: ResolveVimMotionOptions,
): VimMotionResolution {
  if (options.request.kind === "find") {
    return resolveFind(options, options.request.motion, options.request.target);
  }

  if (options.request.kind === "mark") {
    return resolveMark(options, options.request.target, options.request.linewise);
  }

  if (options.request.kind === "text-object") {
    return resolveTextObject(options);
  }

  switch (options.request.motion) {
    case "left":
      return resolveHorizontal(options, "backward");
    case "right":
      return resolveHorizontal(options, "forward");
    case "line-next":
      return resolveVertical(options, "next", "goal-column");
    case "line-previous":
      return resolveVertical(options, "previous", "goal-column");
    case "line-next-first-nonblank":
      return resolveVertical(options, "next", "first-nonblank");
    case "line-previous-first-nonblank":
      return resolveVertical(options, "previous", "first-nonblank");
    case "line-start":
    case "line-first-nonblank":
    case "line-last-nonblank":
      return resolveLineTarget(options, options.request.motion);
    case "line-current":
      return resolveRelativeLine(options, "first-nonblank");
    case "line-end":
      return resolveRelativeLine(options, "last-character");
    case "word-forward":
      return resolveWord(options, "forward", "small");
    case "WORD-forward":
      return resolveWord(options, "forward", "big");
    case "word-backward":
      return resolveWord(options, "backward", "small");
    case "WORD-backward":
      return resolveWord(options, "backward", "big");
    case "word-end":
      return resolveWord(options, "end", "small");
    case "WORD-end":
      return resolveWord(options, "end", "big");
    case "word-previous-end":
      return resolveWord(options, "previous-end", "small");
    case "WORD-previous-end":
      return resolveWord(options, "previous-end", "big");
    case "document-start":
      return resolveDocumentLine(options, "start");
    case "document-end":
      return resolveDocumentLine(options, "end");
    case "sentence-backward":
      return resolveBoundaryMotion(options, sentenceBoundaryOffsets(options.lines), "backward");
    case "sentence-forward":
      return resolveBoundaryMotion(options, sentenceBoundaryOffsets(options.lines), "forward");
    case "paragraph-backward": {
      const starts = lineStarts(options.lines);
      const boundaries = paragraphBoundaryLines(options.lines, false).flatMap((line) => {
        const start = starts[line];
        return start === undefined ? [] : [start];
      });
      return resolveBoundaryMotion(options, boundaries, "backward");
    }
    case "paragraph-forward": {
      const starts = lineStarts(options.lines);
      const boundaries = paragraphBoundaryLines(options.lines, false).flatMap((line) => {
        const start = starts[line];
        return start === undefined ? [] : [start];
      });
      return resolveBoundaryMotion(options, boundaries, "forward");
    }
    case "section-start-backward":
      return resolveBoundaryMotion(options, sectionTargetOffsets(options.lines, "start"), "backward");
    case "section-end-backward":
      return resolveBoundaryMotion(options, sectionTargetOffsets(options.lines, "end"), "backward");
    case "section-start-forward":
      return resolveBoundaryMotion(options, sectionTargetOffsets(options.lines, "start"), "forward");
    case "section-end-forward":
      return resolveBoundaryMotion(options, sectionTargetOffsets(options.lines, "end"), "forward");
    case "match-pair":
      return resolveMatchPair(options);
    case "percentage":
      return resolvePercentage(options);
  }
}
