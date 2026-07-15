import {
  nextUnicodeCursorOffset,
  normalizeUnicodeCursorOffset,
  previousUnicodeCursorOffset,
} from "../terminal/UnicodeCursor.ts";

export type VimPosition = Readonly<{
  line: number;
  column: number;
}>;

export type VimMode =
  | Readonly<{ kind: "normal" }>
  | Readonly<{ kind: "insert" }>
  | Readonly<{ kind: "visual" }>
  | Readonly<{
      kind: "command";
      prompt: ":" | "/";
      input: string;
    }>;

export const VimMode = {
  Normal: { kind: "normal" },
  Insert: { kind: "insert" },
  Visual: { kind: "visual" },
} as const satisfies Readonly<{
  Normal: VimMode;
  Insert: VimMode;
  Visual: VimMode;
}>;

export type VimSelection =
  | Readonly<{ kind: "none" }>
  | Readonly<{
      kind: "line";
      anchorLine: number;
      activeLine: number;
    }>;

export type VimRegister =
  | Readonly<{ kind: "empty" }>
  | Readonly<{
      kind: "character";
      text: string;
    }>
  | Readonly<{
      kind: "line";
      lines: ReadonlyArray<string>;
    }>;

export type VimSearch =
  | Readonly<{ kind: "none" }>
  | Readonly<{
      kind: "active";
      query: string;
    }>;

export type VimCommandEffect =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "write" }>
  | Readonly<{ kind: "quit" }>
  | Readonly<{ kind: "force-quit" }>
  | Readonly<{
      kind: "unrecognized-command";
      source: string;
    }>;

export type VimMotion =
  | "left"
  | "right"
  | "word-forward"
  | "word-backward"
  | "word-end"
  | "line-start"
  | "line-end"
  | "line-previous"
  | "line-next"
  | "document-start"
  | "document-end";

export type VimOperator = "delete" | "change" | "yank";

export type VimDigit = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export type VimNormalKey =
  | Readonly<{
      kind: "digit";
      digit: VimDigit;
    }>
  | Readonly<{
      kind: "motion";
      motion: VimMotion;
    }>
  | Readonly<{
      kind: "operator";
      operator: VimOperator;
    }>
  | Readonly<{ kind: "delete-character" }>
  | Readonly<{ kind: "paste-after" }>
  | Readonly<{ kind: "paste-before" }>
  | Readonly<{ kind: "undo" }>
  | Readonly<{ kind: "redo" }>
  | Readonly<{ kind: "enter-visual-line" }>
  | Readonly<{ kind: "enter-command" }>
  | Readonly<{ kind: "enter-search" }>
  | Readonly<{ kind: "search-next" }>
  | Readonly<{ kind: "search-previous" }>
  | Readonly<{ kind: "insert-before" }>
  | Readonly<{ kind: "insert-after" }>
  | Readonly<{ kind: "insert-line-start" }>
  | Readonly<{ kind: "insert-line-end" }>
  | Readonly<{ kind: "escape" }>;

export type VimNormalKeyMatch =
  | Readonly<{
      kind: "recognized";
      key: VimNormalKey;
    }>
  | Readonly<{ kind: "unrecognized" }>;

export type VimParsedCommand =
  | Readonly<{ kind: "write" }>
  | Readonly<{ kind: "quit" }>
  | Readonly<{ kind: "force-quit" }>;

export type VimCommandParseResult =
  | Readonly<{
      kind: "recognized";
      command: VimParsedCommand;
    }>
  | Readonly<{
      kind: "unrecognized";
      source: string;
    }>;

type VimSnapshot = Readonly<{
  lines: ReadonlyArray<string>;
  cursor: VimPosition;
  mode: VimMode;
  selection: VimSelection;
}>;

type VimCount =
  | Readonly<{ kind: "absent" }>
  | Readonly<{
      kind: "present";
      value: number;
    }>;

type VimPending =
  | Readonly<{ kind: "none" }>
  | Readonly<{
      kind: "count";
      count: number;
    }>
  | Readonly<{
      kind: "operator";
      operator: VimOperator;
      count: number;
      motionCount: VimCount;
    }>;

type VimTextState = Readonly<{
  lines: ReadonlyArray<string>;
  cursor: VimPosition;
  mode: VimMode;
  selection: VimSelection;
}>;

type VimTextRange =
  | Readonly<{
      kind: "character";
      start: number;
      end: number;
    }>
  | Readonly<{
      kind: "line";
      startLine: number;
      endLine: number;
    }>;

export type VimBuffer = Readonly<{
  lines: ReadonlyArray<string>;
  cursor: VimPosition;
  mode: VimMode;
  selection: VimSelection;
  undoStack: ReadonlyArray<VimSnapshot>;
  redoStack: ReadonlyArray<VimSnapshot>;
  register: VimRegister;
  search: VimSearch;
  commandEffect: VimCommandEffect;
  savedText: string;
  pending: VimPending;
}>;

export type CreateVimBufferOptions = Readonly<{
  text: string;
  mode: Extract<VimMode, { kind: "normal" | "insert" }>;
}>;

const wordCharacterPattern = /[\p{L}\p{N}_]/u;
const normalDigits = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

function splitText(text: string): ReadonlyArray<string> {
  return text.split("\n");
}

function joinLines(lines: ReadonlyArray<string>): string {
  return lines.join("\n");
}

function clampLine(lines: ReadonlyArray<string>, line: number): number {
  if (!Number.isSafeInteger(line)) {
    throw new Error("Vim cursor lines must be safe integers.");
  }

  return Math.max(0, Math.min(lines.length - 1, line));
}

function lastCursorColumn(line: string): number {
  return line.length === 0
    ? 0
    : previousUnicodeCursorOffset(line, line.length);
}

function normalisePosition(
  lines: ReadonlyArray<string>,
  position: VimPosition,
  mode: VimMode,
): VimPosition {
  const lineIndex = clampLine(lines, position.line);
  const line = lines[lineIndex];

  if (line === undefined) {
    throw new Error("Vim buffers must always contain at least one line.");
  }

  if (!Number.isSafeInteger(position.column)) {
    throw new Error("Vim cursor columns must be safe integers.");
  }

  const normalizedColumn = normalizeUnicodeCursorOffset(
    line,
    Math.max(0, Math.min(line.length, position.column)),
  );
  const allowsLineEnd = mode.kind === "insert";
  const maximumColumn = allowsLineEnd
    ? line.length
    : lastCursorColumn(line);

  return {
    line: lineIndex,
    column: Math.min(normalizedColumn, maximumColumn),
  };
}

function normaliseSelection(
  lines: ReadonlyArray<string>,
  mode: VimMode,
  selection: VimSelection,
): VimSelection {
  if (mode.kind !== "visual" || selection.kind !== "line") {
    return { kind: "none" };
  }

  return {
    kind: "line",
    anchorLine: clampLine(lines, selection.anchorLine),
    activeLine: clampLine(lines, selection.activeLine),
  };
}

function createTextState(
  lines: ReadonlyArray<string>,
  cursor: VimPosition,
  mode: VimMode,
  selection: VimSelection,
): VimTextState {
  const safeLines = lines.length === 0 ? [""] : [...lines];
  const safeCursor = normalisePosition(safeLines, cursor, mode);

  return {
    lines: safeLines,
    cursor: safeCursor,
    mode,
    selection: normaliseSelection(safeLines, mode, selection),
  };
}

function snapshot(buffer: VimBuffer): VimSnapshot {
  return {
    lines: buffer.lines,
    cursor: buffer.cursor,
    mode: buffer.mode,
    selection: buffer.selection,
  };
}

function textStateMatches(
  buffer: VimBuffer,
  next: VimTextState,
): boolean {
  return (
    joinLines(buffer.lines) === joinLines(next.lines) &&
    buffer.cursor.line === next.cursor.line &&
    buffer.cursor.column === next.cursor.column &&
    buffer.mode.kind === next.mode.kind &&
    buffer.selection.kind === next.selection.kind
  );
}

function withPending(buffer: VimBuffer, pending: VimPending): VimBuffer {
  return { ...buffer, pending };
}

function resetPending(buffer: VimBuffer): VimBuffer {
  return withPending(buffer, { kind: "none" });
}

function withTextState(buffer: VimBuffer, next: VimTextState): VimBuffer {
  return {
    ...buffer,
    ...next,
    pending: { kind: "none" },
  };
}

function commitEdit(
  buffer: VimBuffer,
  next: VimTextState,
  register: VimRegister,
): VimBuffer {
  if (textStateMatches(buffer, next) && buffer.register.kind === register.kind) {
    return resetPending(buffer);
  }

  return {
    ...buffer,
    ...next,
    undoStack: [...buffer.undoStack, snapshot(buffer)],
    redoStack: [],
    register,
    pending: { kind: "none" },
  };
}

function pendingCount(pending: VimPending): number {
  return pending.kind === "count" ? pending.count : 1;
}

function capCount(count: number, lines: ReadonlyArray<string>): number {
  const maximum = Math.max(
    1,
    lines.reduce((total, line) => total + line.length + 1, 0),
  );

  return Math.max(1, Math.min(count, maximum));
}

function appendCount(existing: VimCount, digit: VimDigit): VimCount {
  const value =
    existing.kind === "present" ? existing.value * 10 + digit : digit;

  return {
    kind: "present",
    value: Math.min(value, Number.MAX_SAFE_INTEGER),
  };
}

function appendNormalCount(buffer: VimBuffer, digit: VimDigit): VimBuffer {
  if (buffer.pending.kind === "operator") {
    return withPending(buffer, {
      ...buffer.pending,
      motionCount: appendCount(buffer.pending.motionCount, digit),
    });
  }

  if (buffer.pending.kind === "count") {
    return withPending(buffer, {
      kind: "count",
      count: Math.min(
        buffer.pending.count * 10 + digit,
        Number.MAX_SAFE_INTEGER,
      ),
    });
  }

  return withPending(buffer, { kind: "count", count: digit });
}

function lineStartOffset(lines: ReadonlyArray<string>, line: number): number {
  let offset = 0;

  for (let index = 0; index < line; index += 1) {
    const value = lines[index];

    if (value === undefined) {
      throw new Error("Vim cursor lines must reference existing text.");
    }

    offset += value.length + 1;
  }

  return offset;
}

function textOffsetForPosition(
  lines: ReadonlyArray<string>,
  position: VimPosition,
): number {
  const safeLine = clampLine(lines, position.line);
  const line = lines[safeLine];

  if (line === undefined) {
    throw new Error("Vim buffers must always contain at least one line.");
  }

  const column = normalizeUnicodeCursorOffset(
    line,
    Math.max(0, Math.min(line.length, position.column)),
  );

  return lineStartOffset(lines, safeLine) + column;
}

function positionForTextOffset(
  lines: ReadonlyArray<string>,
  offset: number,
  mode: VimMode,
): VimPosition {
  const text = joinLines(lines);
  const normalizedOffset = normalizeUnicodeCursorOffset(text, offset);
  let remaining: number = normalizedOffset;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];

    if (line === undefined) {
      throw new Error("Vim buffers must always contain at least one line.");
    }

    if (remaining <= line.length) {
      return normalisePosition(
        lines,
        { line: lineIndex, column: remaining },
        mode,
      );
    }

    remaining -= line.length + 1;
  }

  const lastLine = lines.length - 1;
  const line = lines[lastLine];

  if (line === undefined) {
    throw new Error("Vim buffers must always contain at least one line.");
  }

  return normalisePosition(
    lines,
    { line: lastLine, column: line.length },
    mode,
  );
}

function moveCharacterLeft(
  lines: ReadonlyArray<string>,
  position: VimPosition,
  count: number,
): VimPosition {
  const line = lines[position.line];

  if (line === undefined) {
    throw new Error("Vim cursor lines must reference existing text.");
  }

  let column = position.column;

  for (let step = 0; step < count; step += 1) {
    column = previousUnicodeCursorOffset(line, column);
  }

  return { line: position.line, column };
}

function moveCharacterRight(
  lines: ReadonlyArray<string>,
  position: VimPosition,
  count: number,
): VimPosition {
  const line = lines[position.line];

  if (line === undefined) {
    throw new Error("Vim cursor lines must reference existing text.");
  }

  const maximumColumn = lastCursorColumn(line);
  let column = position.column;

  for (let step = 0; step < count; step += 1) {
    if (column >= maximumColumn) {
      break;
    }

    column = nextUnicodeCursorOffset(line, column);
  }

  return { line: position.line, column };
}

function characterAt(text: string, offset: number): string {
  const start = normalizeUnicodeCursorOffset(text, offset);
  const end = nextUnicodeCursorOffset(text, start);

  return text.slice(start, end);
}

function isWordCharacter(character: string): boolean {
  return wordCharacterPattern.test(character);
}

function wordForward(text: string, offset: number, count: number): number {
  let position = normalizeUnicodeCursorOffset(text, offset);

  for (let repetition = 0; repetition < count; repetition += 1) {
    while (
      position < text.length &&
      isWordCharacter(characterAt(text, position))
    ) {
      position = nextUnicodeCursorOffset(text, position);
    }

    while (
      position < text.length &&
      !isWordCharacter(characterAt(text, position))
    ) {
      position = nextUnicodeCursorOffset(text, position);
    }
  }

  return position;
}

function wordBackward(text: string, offset: number, count: number): number {
  let position = normalizeUnicodeCursorOffset(text, offset);

  for (let repetition = 0; repetition < count; repetition += 1) {
    if (position === 0) {
      return 0;
    }

    position = previousUnicodeCursorOffset(text, position);

    while (position > 0 && !isWordCharacter(characterAt(text, position))) {
      position = previousUnicodeCursorOffset(text, position);
    }

    while (
      position > 0 &&
      isWordCharacter(
        characterAt(text, previousUnicodeCursorOffset(text, position)),
      )
    ) {
      position = previousUnicodeCursorOffset(text, position);
    }
  }

  return position;
}

function wordEnd(text: string, offset: number, count: number): number {
  if (text.length === 0) {
    return 0;
  }

  let position = normalizeUnicodeCursorOffset(text, offset);
  const lastCursor = previousUnicodeCursorOffset(text, text.length);

  for (let repetition = 0; repetition < count; repetition += 1) {
    while (
      position < lastCursor &&
      !isWordCharacter(characterAt(text, position))
    ) {
      position = nextUnicodeCursorOffset(text, position);
    }

    while (
      position < lastCursor &&
      isWordCharacter(
        characterAt(text, nextUnicodeCursorOffset(text, position)),
      )
    ) {
      position = nextUnicodeCursorOffset(text, position);
    }

    if (repetition < count - 1 && position < lastCursor) {
      position = nextUnicodeCursorOffset(text, position);
    }
  }

  return position;
}

function moveCursorForMotion(
  buffer: VimBuffer,
  motion: VimMotion,
  count: number,
): VimPosition {
  const safeCount = capCount(count, buffer.lines);
  const text = joinLines(buffer.lines);
  const offset = textOffsetForPosition(buffer.lines, buffer.cursor);

  switch (motion) {
    case "left":
      return normalisePosition(
        buffer.lines,
        moveCharacterLeft(buffer.lines, buffer.cursor, safeCount),
        VimMode.Normal,
      );
    case "right":
      return normalisePosition(
        buffer.lines,
        moveCharacterRight(buffer.lines, buffer.cursor, safeCount),
        VimMode.Normal,
      );
    case "word-forward":
      return positionForTextOffset(
        buffer.lines,
        wordForward(text, offset, safeCount),
        VimMode.Normal,
      );
    case "word-backward":
      return positionForTextOffset(
        buffer.lines,
        wordBackward(text, offset, safeCount),
        VimMode.Normal,
      );
    case "word-end":
      return positionForTextOffset(
        buffer.lines,
        wordEnd(text, offset, safeCount),
        VimMode.Normal,
      );
    case "line-start":
      return { line: buffer.cursor.line, column: 0 };
    case "line-end": {
      const line = buffer.lines[buffer.cursor.line];

      if (line === undefined) {
        throw new Error("Vim cursor lines must reference existing text.");
      }

      return { line: buffer.cursor.line, column: lastCursorColumn(line) };
    }
    case "line-previous": {
      const line = Math.max(0, buffer.cursor.line - safeCount);
      const target = buffer.lines[line];

      if (target === undefined) {
        throw new Error("Vim cursor lines must reference existing text.");
      }

      return {
        line,
        column: Math.min(lastCursorColumn(target), buffer.cursor.column),
      };
    }
    case "line-next": {
      const line = Math.min(buffer.lines.length - 1, buffer.cursor.line + safeCount);
      const target = buffer.lines[line];

      if (target === undefined) {
        throw new Error("Vim cursor lines must reference existing text.");
      }

      return {
        line,
        column: Math.min(lastCursorColumn(target), buffer.cursor.column),
      };
    }
    case "document-start":
      return { line: 0, column: 0 };
    case "document-end": {
      const line = buffer.lines.length - 1;
      const target = buffer.lines[line];

      if (target === undefined) {
        throw new Error("Vim buffers must always contain at least one line.");
      }

      return { line, column: lastCursorColumn(target) };
    }
  }
}

function lineRangeForMotion(
  buffer: VimBuffer,
  motion: Extract<
    VimMotion,
    "line-previous" | "line-next" | "document-start" | "document-end"
  >,
  count: number,
): VimTextRange {
  const target = moveCursorForMotion(buffer, motion, count);

  return {
    kind: "line",
    startLine: Math.min(buffer.cursor.line, target.line),
    endLine: Math.max(buffer.cursor.line, target.line),
  };
}

function characterRangeForMotion(
  buffer: VimBuffer,
  motion: Exclude<
    VimMotion,
    "line-previous" | "line-next" | "document-start" | "document-end"
  >,
  count: number,
): VimTextRange {
  const safeCount = capCount(count, buffer.lines);
  const text = joinLines(buffer.lines);
  const cursorOffset = textOffsetForPosition(buffer.lines, buffer.cursor);

  switch (motion) {
    case "left":
      return {
        kind: "character",
        start: textOffsetForPosition(
          buffer.lines,
          moveCharacterLeft(buffer.lines, buffer.cursor, safeCount),
        ),
        end: cursorOffset,
      };
    case "right": {
      const target = moveCharacterRight(
        buffer.lines,
        buffer.cursor,
        safeCount,
      );
      const targetOffset = textOffsetForPosition(buffer.lines, target);

      return {
        kind: "character",
        start: cursorOffset,
        end: nextUnicodeCursorOffset(text, targetOffset),
      };
    }
    case "word-forward":
      return {
        kind: "character",
        start: cursorOffset,
        end: wordForward(text, cursorOffset, safeCount),
      };
    case "word-backward":
      return {
        kind: "character",
        start: wordBackward(text, cursorOffset, safeCount),
        end: cursorOffset,
      };
    case "word-end":
      return {
        kind: "character",
        start: cursorOffset,
        end: nextUnicodeCursorOffset(
          text,
          wordEnd(text, cursorOffset, safeCount),
        ),
      };
    case "line-start":
      return {
        kind: "character",
        start: lineStartOffset(buffer.lines, buffer.cursor.line),
        end: cursorOffset,
      };
    case "line-end": {
      const line = buffer.lines[buffer.cursor.line];

      if (line === undefined) {
        throw new Error("Vim cursor lines must reference existing text.");
      }

      return {
        kind: "character",
        start: cursorOffset,
        end: lineStartOffset(buffer.lines, buffer.cursor.line) + line.length,
      };
    }
  }
}

function rangeForMotion(
  buffer: VimBuffer,
  motion: VimMotion,
  count: number,
): VimTextRange {
  switch (motion) {
    case "line-previous":
    case "line-next":
    case "document-start":
    case "document-end":
      return lineRangeForMotion(buffer, motion, count);
    case "left":
    case "right":
    case "word-forward":
    case "word-backward":
    case "word-end":
    case "line-start":
    case "line-end":
      return characterRangeForMotion(buffer, motion, count);
  }
}

function registerForRange(
  buffer: VimBuffer,
  range: VimTextRange,
): VimRegister {
  if (range.kind === "line") {
    return {
      kind: "line",
      lines: buffer.lines.slice(range.startLine, range.endLine + 1),
    };
  }

  const text = joinLines(buffer.lines);

  return {
    kind: "character",
    text: text.slice(range.start, range.end),
  };
}

function deleteRange(
  buffer: VimBuffer,
  range: VimTextRange,
  enterInsertMode: boolean,
): VimBuffer {
  if (range.kind === "line") {
    const register = registerForRange(buffer, range);

    if (register.kind !== "line" || register.lines.length === 0) {
      return resetPending(buffer);
    }

    const remaining = [
      ...buffer.lines.slice(0, range.startLine),
      ...buffer.lines.slice(range.endLine + 1),
    ];
    const lines = remaining.length === 0 ? [""] : remaining;
    const cursor = {
      line: Math.min(range.startLine, lines.length - 1),
      column: 0,
    };
    const mode = enterInsertMode ? VimMode.Insert : VimMode.Normal;

    return commitEdit(
      buffer,
      createTextState(lines, cursor, mode, { kind: "none" }),
      register,
    );
  }

  const register = registerForRange(buffer, range);

  if (register.kind !== "character" || register.text.length === 0) {
    const mode = enterInsertMode ? VimMode.Insert : VimMode.Normal;

    return withTextState(
      buffer,
      createTextState(buffer.lines, buffer.cursor, mode, { kind: "none" }),
    );
  }

  const text = joinLines(buffer.lines);
  const start = normalizeUnicodeCursorOffset(text, range.start);
  const end = Math.max(start, normalizeUnicodeCursorOffset(text, range.end));
  const lines = splitText(text.slice(0, start) + text.slice(end));
  const mode = enterInsertMode ? VimMode.Insert : VimMode.Normal;
  const cursor = positionForTextOffset(lines, start, mode);

  return commitEdit(
    buffer,
    createTextState(lines, cursor, mode, { kind: "none" }),
    register,
  );
}

function applyOperatorRange(
  buffer: VimBuffer,
  operator: VimOperator,
  range: VimTextRange,
): VimBuffer {
  if (operator === "yank") {
    return {
      ...buffer,
      register: registerForRange(buffer, range),
      pending: { kind: "none" },
    };
  }

  return deleteRange(buffer, range, operator === "change");
}

function wholeLineRange(buffer: VimBuffer, count: number): VimTextRange {
  return {
    kind: "line",
    startLine: buffer.cursor.line,
    endLine: Math.min(buffer.lines.length - 1, buffer.cursor.line + count - 1),
  };
}

function handleOperator(buffer: VimBuffer, operator: VimOperator): VimBuffer {
  if (buffer.pending.kind === "operator") {
    if (buffer.pending.operator === operator) {
      return applyOperatorRange(
        buffer,
        operator,
        wholeLineRange(buffer, buffer.pending.count),
      );
    }

    return withPending(buffer, {
      kind: "operator",
      operator,
      count: buffer.pending.count,
      motionCount: { kind: "absent" },
    });
  }

  return withPending(buffer, {
    kind: "operator",
    operator,
    count: pendingCount(buffer.pending),
    motionCount: { kind: "absent" },
  });
}

function handleMotion(buffer: VimBuffer, motion: VimMotion): VimBuffer {
  if (buffer.pending.kind === "operator") {
    const motionCount =
      buffer.pending.motionCount.kind === "present"
        ? buffer.pending.motionCount.value
        : 1;
    const count = Math.min(
      buffer.pending.count * motionCount,
      Number.MAX_SAFE_INTEGER,
    );

    return applyOperatorRange(
      buffer,
      buffer.pending.operator,
      rangeForMotion(buffer, motion, count),
    );
  }

  const cursor = moveCursorForMotion(
    buffer,
    motion,
    pendingCount(buffer.pending),
  );

  return withTextState(
    buffer,
    createTextState(buffer.lines, cursor, VimMode.Normal, { kind: "none" }),
  );
}

function deleteCharacters(buffer: VimBuffer): VimBuffer {
  const line = buffer.lines[buffer.cursor.line];

  if (line === undefined) {
    throw new Error("Vim cursor lines must reference existing text.");
  }

  const start = buffer.cursor.column;
  let end = start;
  const count = capCount(pendingCount(buffer.pending), buffer.lines);

  for (let step = 0; step < count && end < line.length; step += 1) {
    end = nextUnicodeCursorOffset(line, end);
  }

  const lineOffset = lineStartOffset(buffer.lines, buffer.cursor.line);

  return deleteRange(
    buffer,
    {
      kind: "character",
      start: lineOffset + start,
      end: lineOffset + end,
    },
    false,
  );
}

function enterInsertMode(buffer: VimBuffer, cursor: VimPosition): VimBuffer {
  return withTextState(
    buffer,
    createTextState(buffer.lines, cursor, VimMode.Insert, { kind: "none" }),
  );
}

function enterNormalMode(buffer: VimBuffer): VimBuffer {
  return withTextState(
    buffer,
    createTextState(buffer.lines, buffer.cursor, VimMode.Normal, {
      kind: "none",
    }),
  );
}

function enterVisualMode(buffer: VimBuffer): VimBuffer {
  return withTextState(
    buffer,
    createTextState(buffer.lines, buffer.cursor, VimMode.Visual, {
      kind: "line",
      anchorLine: buffer.cursor.line,
      activeLine: buffer.cursor.line,
    }),
  );
}

function visualRange(buffer: VimBuffer): VimTextRange {
  if (buffer.selection.kind !== "line") {
    throw new Error("Visual mode requires a linewise selection.");
  }

  return {
    kind: "line",
    startLine: Math.min(buffer.selection.anchorLine, buffer.selection.activeLine),
    endLine: Math.max(buffer.selection.anchorLine, buffer.selection.activeLine),
  };
}

function updateVisualSelection(
  buffer: VimBuffer,
  motion: VimMotion,
): VimBuffer {
  if (buffer.selection.kind !== "line") {
    throw new Error("Visual mode requires a linewise selection.");
  }

  const cursor = moveCursorForMotion(
    buffer,
    motion,
    pendingCount(buffer.pending),
  );

  return withTextState(
    buffer,
    createTextState(buffer.lines, cursor, VimMode.Visual, {
      kind: "line",
      anchorLine: buffer.selection.anchorLine,
      activeLine: cursor.line,
    }),
  );
}

function applyVisualKey(buffer: VimBuffer, key: VimNormalKey): VimBuffer {
  if (key.kind === "escape" || key.kind === "enter-visual-line") {
    return enterNormalMode(buffer);
  }

  if (key.kind === "digit") {
    return appendNormalCount(buffer, key.digit);
  }

  if (key.kind === "motion") {
    return updateVisualSelection(buffer, key.motion);
  }

  if (key.kind === "operator") {
    return applyOperatorRange(buffer, key.operator, visualRange(buffer));
  }

  if (key.kind === "delete-character") {
    return applyOperatorRange(buffer, "delete", visualRange(buffer));
  }

  return resetPending(buffer);
}

function pasteRegister(buffer: VimBuffer, afterCursor: boolean): VimBuffer {
  if (buffer.register.kind === "empty") {
    return resetPending(buffer);
  }

  if (buffer.register.kind === "line") {
    const insertionLine = buffer.cursor.line + (afterCursor ? 1 : 0);
    const lines = [
      ...buffer.lines.slice(0, insertionLine),
      ...buffer.register.lines,
      ...buffer.lines.slice(insertionLine),
    ];

    return commitEdit(
      buffer,
      createTextState(
        lines,
        { line: insertionLine, column: 0 },
        VimMode.Normal,
        { kind: "none" },
      ),
      buffer.register,
    );
  }

  const text = joinLines(buffer.lines);
  const cursorOffset = textOffsetForPosition(buffer.lines, buffer.cursor);
  const insertionOffset = afterCursor
    ? nextUnicodeCursorOffset(text, cursorOffset)
    : cursorOffset;
  const nextText =
    text.slice(0, insertionOffset) +
    buffer.register.text +
    text.slice(insertionOffset);
  const lines = splitText(nextText);
  const cursor = positionForTextOffset(
    lines,
    insertionOffset + buffer.register.text.length,
    VimMode.Normal,
  );

  return commitEdit(
    buffer,
    createTextState(lines, cursor, VimMode.Normal, { kind: "none" }),
    buffer.register,
  );
}

function undo(buffer: VimBuffer): VimBuffer {
  const previous = buffer.undoStack.at(-1);

  if (previous === undefined) {
    return resetPending(buffer);
  }

  return {
    ...buffer,
    ...previous,
    undoStack: buffer.undoStack.slice(0, -1),
    redoStack: [snapshot(buffer), ...buffer.redoStack],
    pending: { kind: "none" },
  };
}

function redo(buffer: VimBuffer): VimBuffer {
  const next = buffer.redoStack[0];

  if (next === undefined) {
    return resetPending(buffer);
  }

  return {
    ...buffer,
    ...next,
    undoStack: [...buffer.undoStack, snapshot(buffer)],
    redoStack: buffer.redoStack.slice(1),
    pending: { kind: "none" },
  };
}

function isLineStartKey(buffer: VimBuffer, key: VimNormalKey): boolean {
  if (key.kind !== "digit" || key.digit !== 0) {
    return false;
  }

  if (buffer.pending.kind === "none") {
    return true;
  }

  return (
    buffer.pending.kind === "operator" &&
    buffer.pending.motionCount.kind === "absent"
  );
}

function moveToSearchMatch(
  buffer: VimBuffer,
  direction: "forward" | "backward",
): VimBuffer {
  if (buffer.search.kind !== "active" || buffer.search.query.length === 0) {
    return resetPending(buffer);
  }

  const text = joinLines(buffer.lines);
  const cursorOffset = textOffsetForPosition(buffer.lines, buffer.cursor);
  const searchStart =
    direction === "forward"
      ? nextUnicodeCursorOffset(text, cursorOffset)
      : cursorOffset;
  const index =
    direction === "forward"
      ? text.indexOf(buffer.search.query, searchStart)
      : searchStart === 0
        ? -1
        : text.lastIndexOf(buffer.search.query, searchStart - 1);
  const wrappedIndex =
    index === -1
      ? direction === "forward"
        ? text.indexOf(buffer.search.query)
        : text.lastIndexOf(buffer.search.query)
      : index;

  if (wrappedIndex === -1) {
    return resetPending(buffer);
  }

  return withTextState(
    buffer,
    createTextState(
      buffer.lines,
      positionForTextOffset(buffer.lines, wrappedIndex, VimMode.Normal),
      VimMode.Normal,
      { kind: "none" },
    ),
  );
}

export function createVimBuffer({
  text,
  mode,
}: CreateVimBufferOptions): VimBuffer {
  const lines = splitText(text);
  const cursor =
    mode.kind === "normal"
      ? { line: 0, column: 0 }
      : { line: 0, column: 0 };
  const state = createTextState(lines, cursor, mode, { kind: "none" });

  return {
    ...state,
    undoStack: [],
    redoStack: [],
    register: { kind: "empty" },
    search: { kind: "none" },
    commandEffect: { kind: "none" },
    savedText: text,
    pending: { kind: "none" },
  };
}

export function createEmptyVimBuffer(): VimBuffer {
  return createVimBuffer({ text: "", mode: VimMode.Insert });
}

export function vimBufferText(buffer: VimBuffer): string {
  return joinLines(buffer.lines);
}

export function vimBufferCursorOffset(buffer: VimBuffer): number {
  return textOffsetForPosition(buffer.lines, buffer.cursor);
}

export function isVimBufferDirty(buffer: VimBuffer): boolean {
  return vimBufferText(buffer) !== buffer.savedText;
}

export function markVimBufferSaved(buffer: VimBuffer): VimBuffer {
  return { ...buffer, savedText: vimBufferText(buffer) };
}

export function clearVimCommandEffect(buffer: VimBuffer): VimBuffer {
  return { ...buffer, commandEffect: { kind: "none" } };
}

export function moveVimInsertCursor(
  buffer: VimBuffer,
  cursor: VimPosition,
): VimBuffer {
  if (buffer.mode.kind !== "insert") {
    return buffer;
  }

  return withTextState(
    buffer,
    createTextState(buffer.lines, cursor, VimMode.Insert, { kind: "none" }),
  );
}

export function moveVimInsertCursorToTextOffset(
  buffer: VimBuffer,
  cursorOffset: number,
): VimBuffer {
  if (buffer.mode.kind !== "insert") {
    return buffer;
  }

  return moveVimInsertCursor(
    buffer,
    positionForTextOffset(buffer.lines, cursorOffset, VimMode.Insert),
  );
}

export function insertVimText(buffer: VimBuffer, text: string): VimBuffer {
  if (buffer.mode.kind !== "insert" || text.length === 0) {
    return buffer;
  }

  const currentText = vimBufferText(buffer);
  const cursorOffset = textOffsetForPosition(buffer.lines, buffer.cursor);
  const nextText =
    currentText.slice(0, cursorOffset) +
    text +
    currentText.slice(cursorOffset);
  const lines = splitText(nextText);
  const cursor = positionForTextOffset(
    lines,
    cursorOffset + text.length,
    VimMode.Insert,
  );

  return commitEdit(
    buffer,
    createTextState(lines, cursor, VimMode.Insert, { kind: "none" }),
    buffer.register,
  );
}

export function replaceVimInsertText(
  buffer: VimBuffer,
  text: string,
  cursorOffset: number,
): VimBuffer {
  if (buffer.mode.kind !== "insert") {
    return buffer;
  }

  const lines = splitText(text);
  const cursor = positionForTextOffset(lines, cursorOffset, VimMode.Insert);

  return commitEdit(
    buffer,
    createTextState(lines, cursor, VimMode.Insert, { kind: "none" }),
    buffer.register,
  );
}

export function backspaceVimText(buffer: VimBuffer): VimBuffer {
  if (buffer.mode.kind !== "insert") {
    return buffer;
  }

  const text = vimBufferText(buffer);
  const cursorOffset = textOffsetForPosition(buffer.lines, buffer.cursor);

  if (cursorOffset === 0) {
    return buffer;
  }

  const start = previousUnicodeCursorOffset(text, cursorOffset);
  const lines = splitText(text.slice(0, start) + text.slice(cursorOffset));
  const cursor = positionForTextOffset(lines, start, VimMode.Insert);

  return commitEdit(
    buffer,
    createTextState(lines, cursor, VimMode.Insert, { kind: "none" }),
    buffer.register,
  );
}

export function deleteVimTextAtCursor(buffer: VimBuffer): VimBuffer {
  if (buffer.mode.kind !== "insert") {
    return buffer;
  }

  const text = vimBufferText(buffer);
  const cursorOffset = textOffsetForPosition(buffer.lines, buffer.cursor);

  if (cursorOffset === text.length) {
    return buffer;
  }

  const end = nextUnicodeCursorOffset(text, cursorOffset);
  const lines = splitText(text.slice(0, cursorOffset) + text.slice(end));
  const cursor = positionForTextOffset(lines, cursorOffset, VimMode.Insert);

  return commitEdit(
    buffer,
    createTextState(lines, cursor, VimMode.Insert, { kind: "none" }),
    buffer.register,
  );
}

export function applyNormalVimKey(
  buffer: VimBuffer,
  key: VimNormalKey,
): VimBuffer {
  if (buffer.mode.kind === "visual") {
    return applyVisualKey(buffer, key);
  }

  if (buffer.mode.kind === "insert") {
    return key.kind === "escape" ? enterNormalMode(buffer) : buffer;
  }

  if (buffer.mode.kind === "command") {
    return key.kind === "escape" ? enterNormalMode(buffer) : buffer;
  }

  if (isLineStartKey(buffer, key)) {
    return handleMotion(buffer, "line-start");
  }

  switch (key.kind) {
    case "digit":
      return appendNormalCount(buffer, key.digit);
    case "motion":
      return handleMotion(buffer, key.motion);
    case "operator":
      return handleOperator(buffer, key.operator);
    case "delete-character":
      return deleteCharacters(buffer);
    case "paste-after":
      return pasteRegister(buffer, true);
    case "paste-before":
      return pasteRegister(buffer, false);
    case "undo":
      return undo(buffer);
    case "redo":
      return redo(buffer);
    case "enter-visual-line":
      return enterVisualMode(buffer);
    case "enter-command":
      return {
        ...buffer,
        mode: { kind: "command", prompt: ":", input: "" },
        selection: { kind: "none" },
        pending: { kind: "none" },
      };
    case "enter-search":
      return {
        ...buffer,
        mode: { kind: "command", prompt: "/", input: "" },
        selection: { kind: "none" },
        pending: { kind: "none" },
      };
    case "search-next":
      return moveToSearchMatch(buffer, "forward");
    case "search-previous":
      return moveToSearchMatch(buffer, "backward");
    case "insert-before":
      return enterInsertMode(buffer, buffer.cursor);
    case "insert-after": {
      const text = vimBufferText(buffer);
      const offset = textOffsetForPosition(buffer.lines, buffer.cursor);

      return enterInsertMode(
        buffer,
        positionForTextOffset(
          buffer.lines,
          nextUnicodeCursorOffset(text, offset),
          VimMode.Insert,
        ),
      );
    }
    case "insert-line-start":
      return enterInsertMode(buffer, {
        line: buffer.cursor.line,
        column: 0,
      });
    case "insert-line-end": {
      const line = buffer.lines[buffer.cursor.line];

      if (line === undefined) {
        throw new Error("Vim cursor lines must reference existing text.");
      }

      return enterInsertMode(buffer, {
        line: buffer.cursor.line,
        column: line.length,
      });
    }
    case "escape":
      return enterNormalMode(buffer);
  }
}

export function appendVimCommandInput(
  buffer: VimBuffer,
  text: string,
): VimBuffer {
  if (buffer.mode.kind !== "command" || text.length === 0) {
    return buffer;
  }

  return {
    ...buffer,
    mode: {
      ...buffer.mode,
      input: buffer.mode.input + text,
    },
  };
}

export function backspaceVimCommandInput(buffer: VimBuffer): VimBuffer {
  if (buffer.mode.kind !== "command" || buffer.mode.input.length === 0) {
    return buffer;
  }

  const end = previousUnicodeCursorOffset(
    buffer.mode.input,
    buffer.mode.input.length,
  );

  return {
    ...buffer,
    mode: {
      ...buffer.mode,
      input: buffer.mode.input.slice(0, end),
    },
  };
}

export function parseVimCommand(source: string): VimCommandParseResult {
  switch (source.trim()) {
    case "w":
      return { kind: "recognized", command: { kind: "write" } };
    case "q":
      return { kind: "recognized", command: { kind: "quit" } };
    case "q!":
      return { kind: "recognized", command: { kind: "force-quit" } };
    default:
      return { kind: "unrecognized", source };
  }
}

export function submitVimCommand(buffer: VimBuffer): VimBuffer {
  if (buffer.mode.kind !== "command") {
    return buffer;
  }

  if (buffer.mode.prompt === "/") {
    if (buffer.mode.input.length === 0) {
      return enterNormalMode(buffer);
    }

    return moveToSearchMatch(
      {
        ...buffer,
        mode: VimMode.Normal,
        selection: { kind: "none" },
        search: { kind: "active", query: buffer.mode.input },
        pending: { kind: "none" },
      },
      "forward",
    );
  }

  const parsed = parseVimCommand(buffer.mode.input);
  const commandEffect: VimCommandEffect =
    parsed.kind === "recognized"
      ? parsed.command
      : { kind: "unrecognized-command", source: parsed.source };

  return {
    ...buffer,
    mode: VimMode.Normal,
    selection: { kind: "none" },
    commandEffect,
    pending: { kind: "none" },
  };
}

export function normalVimKeyFromKeyboard(
  key: string,
  ctrlKey: boolean,
  metaKey: boolean,
): VimNormalKeyMatch {
  if (ctrlKey && !metaKey && key.toLowerCase() === "r") {
    return { kind: "recognized", key: { kind: "redo" } };
  }

  if (ctrlKey || metaKey) {
    return { kind: "unrecognized" };
  }

  const digit = normalDigits.find((candidate) => String(candidate) === key);

  if (digit !== undefined) {
    return { kind: "recognized", key: { kind: "digit", digit } };
  }

  switch (key) {
    case "h":
    case "ArrowLeft":
      return { kind: "recognized", key: { kind: "motion", motion: "left" } };
    case "l":
    case "ArrowRight":
      return { kind: "recognized", key: { kind: "motion", motion: "right" } };
    case "j":
    case "ArrowDown":
      return {
        kind: "recognized",
        key: { kind: "motion", motion: "line-next" },
      };
    case "k":
    case "ArrowUp":
      return {
        kind: "recognized",
        key: { kind: "motion", motion: "line-previous" },
      };
    case "w":
      return {
        kind: "recognized",
        key: { kind: "motion", motion: "word-forward" },
      };
    case "b":
      return {
        kind: "recognized",
        key: { kind: "motion", motion: "word-backward" },
      };
    case "e":
      return {
        kind: "recognized",
        key: { kind: "motion", motion: "word-end" },
      };
    case "g":
    case "Home":
      return {
        kind: "recognized",
        key: { kind: "motion", motion: "document-start" },
      };
    case "G":
      return {
        kind: "recognized",
        key: { kind: "motion", motion: "document-end" },
      };
    case "0":
      return {
        kind: "recognized",
        key: { kind: "motion", motion: "line-start" },
      };
    case "$":
    case "End":
      return {
        kind: "recognized",
        key: { kind: "motion", motion: "line-end" },
      };
    case "d":
      return { kind: "recognized", key: { kind: "operator", operator: "delete" } };
    case "c":
      return { kind: "recognized", key: { kind: "operator", operator: "change" } };
    case "y":
      return { kind: "recognized", key: { kind: "operator", operator: "yank" } };
    case "x":
      return { kind: "recognized", key: { kind: "delete-character" } };
    case "p":
      return { kind: "recognized", key: { kind: "paste-after" } };
    case "P":
      return { kind: "recognized", key: { kind: "paste-before" } };
    case "u":
      return { kind: "recognized", key: { kind: "undo" } };
    case "V":
    case "v":
      return { kind: "recognized", key: { kind: "enter-visual-line" } };
    case ":":
      return { kind: "recognized", key: { kind: "enter-command" } };
    case "/":
      return { kind: "recognized", key: { kind: "enter-search" } };
    case "n":
      return { kind: "recognized", key: { kind: "search-next" } };
    case "N":
      return { kind: "recognized", key: { kind: "search-previous" } };
    case "i":
      return { kind: "recognized", key: { kind: "insert-before" } };
    case "a":
      return { kind: "recognized", key: { kind: "insert-after" } };
    case "I":
      return { kind: "recognized", key: { kind: "insert-line-start" } };
    case "A":
      return { kind: "recognized", key: { kind: "insert-line-end" } };
    case "Escape":
      return { kind: "recognized", key: { kind: "escape" } };
    default:
      return { kind: "unrecognized" };
  }
}
