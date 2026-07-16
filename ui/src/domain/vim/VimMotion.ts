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
  | "match-pair"
  | "percentage";

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

export function resolveVimMotion(
  options: ResolveVimMotionOptions,
): VimMotionResolution {
  if (options.request.kind === "find") {
    return resolveFind(options, options.request.motion, options.request.target);
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
    case "match-pair":
      return resolveMatchPair(options);
    case "percentage":
      return resolvePercentage(options);
  }
}
