import {
  nextUnicodeCursorOffset,
  normalizeUnicodeCursorOffset,
  previousUnicodeCursorOffset,
} from "../terminal/UnicodeCursor.ts";
import {
  resolveVimMotion,
  vimLineStartOffset as lineStartOffset,
  vimPositionForTextOffset,
  vimTextOffsetForPosition as textOffsetForPosition,
  type VimFindMotion,
  type VimGoalColumn,
  type VimLastFind,
  type VimMotion,
  type VimMotionRange,
  type VimMotionRequest,
} from "./VimMotion.ts";

export type { VimMotion } from "./VimMotion.ts";

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

export const VimMode: Readonly<{
  Normal: Extract<VimMode, { kind: "normal" }>;
  Insert: Extract<VimMode, { kind: "insert" }>;
  Visual: Extract<VimMode, { kind: "visual" }>;
}> = {
  Normal: { kind: "normal" },
  Insert: { kind: "insert" },
  Visual: { kind: "visual" },
};

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

export type VimStatus =
  | Readonly<{ kind: "none" }>
  | Readonly<{
      kind: "invalid-input";
      source: string;
    }>;

export type VimOperator = "delete" | "change" | "yank";

export type VimDigit = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export type VimNormalKey =
  | Readonly<{
      kind: "literal";
      value: string;
    }>
  | Readonly<{
      kind: "motion";
      motion: VimMotion;
    }>
  | Readonly<{ kind: "digit"; digit: VimDigit }>
  | Readonly<{ kind: "operator"; operator: VimOperator }>
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

type VimCommandContext =
  | Readonly<{ kind: "normal"; count: number }>
  | Readonly<{
      kind: "operator";
      operator: VimOperator;
      count: number;
    }>;

type VimCount =
  | Readonly<{ kind: "absent" }>
  | Readonly<{ kind: "present"; value: number }>;

type VimPending =
  | Readonly<{ kind: "none" }>
  | Readonly<{
      kind: "count";
      count: number;
      source: string;
    }>
  | Readonly<{
      kind: "operator";
      operator: VimOperator;
      operatorCount: VimCount;
      motionCount: VimCount;
      source: string;
    }>
  | Readonly<{
      kind: "prefix";
      context: VimCommandContext;
      source: string;
    }>
  | Readonly<{
      kind: "find";
      context: VimCommandContext;
      motion: VimFindMotion;
      source: string;
    }>;

type VimTextState = Readonly<{
  lines: ReadonlyArray<string>;
  cursor: VimPosition;
  mode: VimMode;
  selection: VimSelection;
}>;

type VimTextRange = VimMotionRange;

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
  status: VimStatus;
  savedText: string;
  pending: VimPending;
  goalColumn: VimGoalColumn;
  lastFind: VimLastFind;
}>;

export type CreateVimBufferOptions = Readonly<{
  text: string;
  mode: Extract<VimMode, { kind: "normal" | "insert" }>;
}>;

const vimHistoryCapacity = 100;

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
  return {
    ...buffer,
    pending: { kind: "none" },
    status: { kind: "none" },
  };
}

function withTextState(buffer: VimBuffer, next: VimTextState): VimBuffer {
  return {
    ...buffer,
    ...next,
    pending: { kind: "none" },
    status: { kind: "none" },
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
    undoStack: [...buffer.undoStack, snapshot(buffer)].slice(
      -vimHistoryCapacity,
    ),
    redoStack: [],
    register,
    pending: { kind: "none" },
    status: { kind: "none" },
    goalColumn: { kind: "none" },
  };
}

function clearVimStatus(buffer: VimBuffer): VimBuffer {
  return buffer.status.kind === "none"
    ? buffer
    : { ...buffer, status: { kind: "none" } };
}

function invalidInput(buffer: VimBuffer, source: string): VimBuffer {
  return {
    ...buffer,
    pending: { kind: "none" },
    status: { kind: "invalid-input", source },
  };
}

function appendSaturatedDecimal(count: number, digit: number): number {
  const maximumPrefix = Math.floor((Number.MAX_SAFE_INTEGER - digit) / 10);

  return count > maximumPrefix
    ? Number.MAX_SAFE_INTEGER
    : count * 10 + digit;
}

function multiplySaturated(left: number, right: number): number {
  return left > Math.floor(Number.MAX_SAFE_INTEGER / right)
    ? Number.MAX_SAFE_INTEGER
    : left * right;
}

function pendingCount(pending: VimPending): number {
  return pending.kind === "count" ? pending.count : 1;
}

function commandContext(buffer: VimBuffer): VimCommandContext {
  if (buffer.pending.kind === "operator") {
    const operatorCount =
      buffer.pending.operatorCount.kind === "present"
        ? buffer.pending.operatorCount.value
        : 1;
    const motionCount =
      buffer.pending.motionCount.kind === "present"
        ? buffer.pending.motionCount.value
        : 1;

    return {
      kind: "operator",
      operator: buffer.pending.operator,
      count: multiplySaturated(operatorCount, motionCount),
    };
  }

  return { kind: "normal", count: pendingCount(buffer.pending) };
}

function appendCount(buffer: VimBuffer, digit: number): VimBuffer {
  if (buffer.pending.kind === "operator") {
    const motionCount: VimCount = {
      kind: "present",
      value: appendSaturatedDecimal(
        buffer.pending.motionCount.kind === "present"
          ? buffer.pending.motionCount.value
          : 0,
        digit,
      ),
    };

    return clearVimStatus(
      withPending(buffer, {
        ...buffer.pending,
        motionCount,
        source: buffer.pending.source + String(digit),
      }),
    );
  }

  if (buffer.pending.kind === "count") {
    return clearVimStatus(
      withPending(buffer, {
        kind: "count",
        count: appendSaturatedDecimal(buffer.pending.count, digit),
        source: buffer.pending.source + String(digit),
      }),
    );
  }

  return clearVimStatus(
    withPending(buffer, {
      kind: "count",
      count: digit,
      source: String(digit),
    }),
  );
}

function positionForTextOffset(
  lines: ReadonlyArray<string>,
  offset: number,
  mode: VimMode,
): VimPosition {
  const boundary = mode.kind === "insert" ? "insertion" : "character";

  return vimPositionForTextOffset(lines, offset, boundary);
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
      status: { kind: "none" },
      goalColumn: { kind: "none" },
    };
  }

  return deleteRange(buffer, range, operator === "change");
}

function wholeLineRange(buffer: VimBuffer, count: number): VimTextRange {
  const available = buffer.lines.length - buffer.cursor.line;
  const distance = Math.min(count, available) - 1;

  return {
    kind: "line",
    startLine: buffer.cursor.line,
    endLine: buffer.cursor.line + distance,
  };
}

function operatorSource(operator: VimOperator): "d" | "c" | "y" {
  switch (operator) {
    case "delete":
      return "d";
    case "change":
      return "c";
    case "yank":
      return "y";
  }
}

function handleOperator(buffer: VimBuffer, operator: VimOperator): VimBuffer {
  if (buffer.mode.kind === "visual") {
    return applyOperatorRange(buffer, operator, visualRange(buffer));
  }

  if (buffer.pending.kind === "operator") {
    const source = buffer.pending.source + operatorSource(operator);

    if (buffer.pending.operator !== operator) {
      return invalidInput(buffer, source);
    }

    return applyOperatorRange(
      buffer,
      operator,
      wholeLineRange(
        buffer,
        buffer.pending.operatorCount.kind === "present"
          ? buffer.pending.operatorCount.value
          : 1,
      ),
    );
  }

  const countSource = buffer.pending.kind === "count" ? buffer.pending.source : "";
  const operatorCount: VimCount =
    buffer.pending.kind === "count"
      ? { kind: "present", value: buffer.pending.count }
      : { kind: "absent" };

  return clearVimStatus(
    withPending(buffer, {
      kind: "operator",
      operator,
      operatorCount,
      motionCount: { kind: "absent" },
      source: countSource + operatorSource(operator),
    }),
  );
}

function executeMotion(
  buffer: VimBuffer,
  request: VimMotionRequest,
  context: VimCommandContext,
  source: string,
  lastFind: VimLastFind,
): VimBuffer {
  const resolution = resolveVimMotion({
    lines: buffer.lines,
    cursor: buffer.cursor,
    request,
    count: context.count,
    goalColumn: buffer.goalColumn,
  });

  if (resolution.kind === "invalid") {
    return invalidInput(buffer, source);
  }

  if (buffer.mode.kind === "visual") {
    if (buffer.selection.kind !== "line") {
      throw new Error("Visual mode requires a linewise selection.");
    }

    const moved = withTextState(
      buffer,
      createTextState(
        buffer.lines,
        resolution.motion.cursor,
        VimMode.Visual,
        {
          kind: "line",
          anchorLine: buffer.selection.anchorLine,
          activeLine: resolution.motion.cursor.line,
        },
      ),
    );

    return {
      ...moved,
      goalColumn: resolution.motion.goalColumn,
      lastFind,
    };
  }

  if (context.kind === "operator") {
    return {
      ...applyOperatorRange(
        buffer,
        context.operator,
        resolution.motion.range,
      ),
      lastFind,
      goalColumn: { kind: "none" },
      status: { kind: "none" },
    };
  }

  const moved = withTextState(
    buffer,
    createTextState(
      buffer.lines,
      resolution.motion.cursor,
      VimMode.Normal,
      { kind: "none" },
    ),
  );

  return {
    ...moved,
    goalColumn: resolution.motion.goalColumn,
    lastFind,
  };
}

function handleMotion(buffer: VimBuffer, motion: VimMotion, source: string): VimBuffer {
  return executeMotion(
    buffer,
    { kind: "motion", motion },
    commandContext(buffer),
    source,
    buffer.lastFind,
  );
}

function deleteCharacters(buffer: VimBuffer): VimBuffer {
  const line = buffer.lines[buffer.cursor.line];

  if (line === undefined) {
    throw new Error("Vim cursor lines must reference existing text.");
  }

  const start = buffer.cursor.column;
  let end = start;
  const count = pendingCount(buffer.pending);
  let moved = 0;

  while (moved < count && end < line.length) {
    end = nextUnicodeCursorOffset(line, end);
    moved += 1;
  }

  if (end === start) {
    return invalidInput(buffer, "x");
  }

  const lineOffset = lineStartOffset(buffer.lines, buffer.cursor.line);

  return deleteRange(
    buffer,
    {
      kind: "character",
      start: lineOffset + start,
      end: lineOffset + end,
      inclusivity: "inclusive",
    },
    false,
  );
}

function enterInsertMode(buffer: VimBuffer, cursor: VimPosition): VimBuffer {
  return withTextState(
    { ...buffer, goalColumn: { kind: "none" } },
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
    redoStack: [snapshot(buffer), ...buffer.redoStack].slice(
      0,
      vimHistoryCapacity,
    ),
    pending: { kind: "none" },
    status: { kind: "none" },
    goalColumn: { kind: "none" },
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
    undoStack: [...buffer.undoStack, snapshot(buffer)].slice(
      -vimHistoryCapacity,
    ),
    redoStack: buffer.redoStack.slice(1),
    pending: { kind: "none" },
    status: { kind: "none" },
    goalColumn: { kind: "none" },
  };
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
  let index: number;

  if (direction === "forward") {
    index = text.indexOf(buffer.search.query, searchStart);
  } else if (searchStart === 0) {
    index = -1;
  } else {
    index = text.lastIndexOf(buffer.search.query, searchStart - 1);
  }

  let wrappedIndex = index;

  if (index === -1) {
    wrappedIndex =
      direction === "forward"
        ? text.indexOf(buffer.search.query)
        : text.lastIndexOf(buffer.search.query);
  }

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
  const cursor = { line: 0, column: 0 };
  const state = createTextState(lines, cursor, mode, { kind: "none" });

  return {
    ...state,
    undoStack: [],
    redoStack: [],
    register: { kind: "empty" },
    search: { kind: "none" },
    commandEffect: { kind: "none" },
    status: { kind: "none" },
    savedText: text,
    pending: { kind: "none" },
    goalColumn: { kind: "none" },
    lastFind: { kind: "none" },
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

function deleteVimInsertRange(
  buffer: VimBuffer,
  start: number,
  end: number,
): VimBuffer {
  const text = vimBufferText(buffer);
  const safeStart = normalizeUnicodeCursorOffset(text, start);
  const safeEnd = Math.max(
    safeStart,
    normalizeUnicodeCursorOffset(text, end),
  );

  if (safeStart === safeEnd) {
    return buffer;
  }

  const lines = splitText(text.slice(0, safeStart) + text.slice(safeEnd));

  return commitEdit(
    buffer,
    createTextState(
      lines,
      positionForTextOffset(lines, safeStart, VimMode.Insert),
      VimMode.Insert,
      { kind: "none" },
    ),
    buffer.register,
  );
}

export function backspaceVimInsertText(buffer: VimBuffer): VimBuffer {
  if (buffer.mode.kind !== "insert") {
    return buffer;
  }

  const cursorOffset = vimBufferCursorOffset(buffer);

  if (cursorOffset === 0) {
    return buffer;
  }

  return deleteVimInsertRange(
    buffer,
    previousUnicodeCursorOffset(vimBufferText(buffer), cursorOffset),
    cursorOffset,
  );
}

export function deleteVimInsertText(buffer: VimBuffer): VimBuffer {
  if (buffer.mode.kind !== "insert") {
    return buffer;
  }

  const text = vimBufferText(buffer);
  const cursorOffset = vimBufferCursorOffset(buffer);

  if (cursorOffset === text.length) {
    return buffer;
  }

  return deleteVimInsertRange(
    buffer,
    cursorOffset,
    nextUnicodeCursorOffset(text, cursorOffset),
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

function pendingSource(buffer: VimBuffer): string {
  return buffer.pending.kind === "none" ? "" : buffer.pending.source;
}

function hasExplicitCount(buffer: VimBuffer): boolean {
  return (
    buffer.pending.kind === "count" ||
    (buffer.pending.kind === "operator" &&
      (buffer.pending.operatorCount.kind === "present" ||
        buffer.pending.motionCount.kind === "present"))
  );
}

function beginPrefix(buffer: VimBuffer): VimBuffer {
  return clearVimStatus(
    withPending(buffer, {
      kind: "prefix",
      context: commandContext(buffer),
      source: pendingSource(buffer) + "g",
    }),
  );
}

function beginFind(buffer: VimBuffer, motion: VimFindMotion): VimBuffer {
  return clearVimStatus(
    withPending(buffer, {
      kind: "find",
      context: commandContext(buffer),
      motion,
      source: pendingSource(buffer) + motion,
    }),
  );
}

function reverseFindMotion(motion: VimFindMotion): VimFindMotion {
  switch (motion) {
    case "f":
      return "F";
    case "F":
      return "f";
    case "t":
      return "T";
    case "T":
      return "t";
  }
}

function repeatFind(buffer: VimBuffer, reverse: boolean): VimBuffer {
  const source = pendingSource(buffer) + (reverse ? "," : ";");

  if (buffer.lastFind.kind === "none") {
    return invalidInput(buffer, source);
  }

  const motion = reverse
    ? reverseFindMotion(buffer.lastFind.motion)
    : buffer.lastFind.motion;

  return executeMotion(
    buffer,
    { kind: "find", motion, target: buffer.lastFind.target },
    commandContext(buffer),
    source,
    buffer.lastFind,
  );
}

function applyPrefixContinuation(buffer: VimBuffer, value: string): VimBuffer {
  if (buffer.pending.kind !== "prefix") {
    throw new Error("Vim prefix continuation requires prefix state.");
  }

  const source = buffer.pending.source + value;
  let motion: VimMotion;

  switch (value) {
    case "g":
      motion = "document-start";
      break;
    case "e":
      motion = "word-previous-end";
      break;
    case "E":
      motion = "WORD-previous-end";
      break;
    case "_":
      motion = "line-last-nonblank";
      break;
    default:
      return invalidInput(buffer, source);
  }

  return executeMotion(
    buffer,
    { kind: "motion", motion },
    buffer.pending.context,
    source,
    buffer.lastFind,
  );
}

function applyFindTarget(buffer: VimBuffer, value: string): VimBuffer {
  if (buffer.pending.kind !== "find") {
    throw new Error("Vim find target requires find state.");
  }

  const source = buffer.pending.source + value;

  if (Array.from(value).length !== 1) {
    return invalidInput(buffer, source);
  }

  return executeMotion(
    buffer,
    { kind: "find", motion: buffer.pending.motion, target: value },
    buffer.pending.context,
    source,
    {
      kind: "present",
      motion: buffer.pending.motion,
      target: value,
    },
  );
}

function insertAfterCursor(buffer: VimBuffer): VimBuffer {
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

function insertAtLineEnd(buffer: VimBuffer): VimBuffer {
  const line = buffer.lines[buffer.cursor.line];

  if (line === undefined) {
    throw new Error("Vim cursor lines must reference existing text.");
  }

  return enterInsertMode(buffer, {
    line: buffer.cursor.line,
    column: line.length,
  });
}

function applyLiteral(buffer: VimBuffer, value: string): VimBuffer {
  if (buffer.pending.kind === "prefix") {
    return applyPrefixContinuation(buffer, value);
  }

  if (buffer.pending.kind === "find") {
    return applyFindTarget(buffer, value);
  }

  if (/^[0-9]$/u.test(value)) {
    const digit = Number(value);
    const zeroIsMotion =
      value === "0" &&
      (buffer.pending.kind === "none" ||
        (buffer.pending.kind === "operator" &&
          buffer.pending.motionCount.kind === "absent"));

    if (zeroIsMotion) {
      return handleMotion(buffer, "line-start", pendingSource(buffer) + value);
    }

    return appendCount(buffer, digit);
  }

  switch (value) {
    case "h":
      return handleMotion(buffer, "left", pendingSource(buffer) + value);
    case "l":
    case " ":
      return handleMotion(buffer, "right", pendingSource(buffer) + value);
    case "j":
      return handleMotion(buffer, "line-next", pendingSource(buffer) + value);
    case "k":
      return handleMotion(buffer, "line-previous", pendingSource(buffer) + value);
    case "+":
      return handleMotion(
        buffer,
        "line-next-first-nonblank",
        pendingSource(buffer) + value,
      );
    case "-":
      return handleMotion(
        buffer,
        "line-previous-first-nonblank",
        pendingSource(buffer) + value,
      );
    case "^":
      return handleMotion(
        buffer,
        "line-first-nonblank",
        pendingSource(buffer) + value,
      );
    case "_":
      return handleMotion(buffer, "line-current", pendingSource(buffer) + value);
    case "$":
      return handleMotion(buffer, "line-end", pendingSource(buffer) + value);
    case "w":
      return handleMotion(buffer, "word-forward", pendingSource(buffer) + value);
    case "W":
      return handleMotion(buffer, "WORD-forward", pendingSource(buffer) + value);
    case "b":
      return handleMotion(buffer, "word-backward", pendingSource(buffer) + value);
    case "B":
      return handleMotion(buffer, "WORD-backward", pendingSource(buffer) + value);
    case "e":
      return handleMotion(buffer, "word-end", pendingSource(buffer) + value);
    case "E":
      return handleMotion(buffer, "WORD-end", pendingSource(buffer) + value);
    case "g":
      return beginPrefix(buffer);
    case "G":
      return handleMotion(
        buffer,
        hasExplicitCount(buffer) ? "document-start" : "document-end",
        pendingSource(buffer) + value,
      );
    case "%":
      return handleMotion(
        buffer,
        hasExplicitCount(buffer) ? "percentage" : "match-pair",
        pendingSource(buffer) + value,
      );
    case "f":
    case "F":
    case "t":
    case "T":
      return beginFind(buffer, value);
    case ";":
      return repeatFind(buffer, false);
    case ",":
      return repeatFind(buffer, true);
    case "d":
      return handleOperator(buffer, "delete");
    case "c":
      return handleOperator(buffer, "change");
    case "y":
      return handleOperator(buffer, "yank");
    case "x":
      return buffer.mode.kind === "visual"
        ? applyOperatorRange(buffer, "delete", visualRange(buffer))
        : deleteCharacters(buffer);
    case "p":
      return buffer.mode.kind === "visual"
        ? invalidInput(buffer, pendingSource(buffer) + value)
        : pasteRegister(buffer, true);
    case "P":
      return buffer.mode.kind === "visual"
        ? invalidInput(buffer, pendingSource(buffer) + value)
        : pasteRegister(buffer, false);
    case "u":
      return buffer.mode.kind === "visual"
        ? invalidInput(buffer, pendingSource(buffer) + value)
        : undo(buffer);
    case "v":
    case "V":
      return buffer.mode.kind === "visual"
        ? enterNormalMode(buffer)
        : enterVisualMode(buffer);
    case ":":
      return buffer.mode.kind === "visual"
        ? invalidInput(buffer, value)
        : {
            ...buffer,
            mode: { kind: "command", prompt: ":", input: "" },
            selection: { kind: "none" },
            pending: { kind: "none" },
            status: { kind: "none" },
          };
    case "/":
      return buffer.mode.kind === "visual"
        ? invalidInput(buffer, value)
        : {
            ...buffer,
            mode: { kind: "command", prompt: "/", input: "" },
            selection: { kind: "none" },
            pending: { kind: "none" },
            status: { kind: "none" },
          };
    case "n":
      return moveToSearchMatch(buffer, "forward");
    case "N":
      return moveToSearchMatch(buffer, "backward");
    case "i":
      return buffer.mode.kind === "visual"
        ? invalidInput(buffer, value)
        : enterInsertMode(buffer, buffer.cursor);
    case "a":
      return buffer.mode.kind === "visual"
        ? invalidInput(buffer, value)
        : insertAfterCursor(buffer);
    case "I":
      return buffer.mode.kind === "visual"
        ? invalidInput(buffer, value)
        : enterInsertMode(buffer, { line: buffer.cursor.line, column: 0 });
    case "A":
      return buffer.mode.kind === "visual"
        ? invalidInput(buffer, value)
        : insertAtLineEnd(buffer);
    default:
      return invalidInput(buffer, pendingSource(buffer) + value);
  }
}

export function applyNormalVimKey(
  buffer: VimBuffer,
  key: VimNormalKey,
): VimBuffer {
  if (key.kind === "escape") {
    return buffer.mode.kind === "insert" ||
      buffer.mode.kind === "command" ||
      buffer.mode.kind === "visual"
      ? enterNormalMode(buffer)
      : resetPending(buffer);
  }

  if (buffer.mode.kind === "insert" || buffer.mode.kind === "command") {
    return buffer;
  }

  if (key.kind === "motion") {
    if (buffer.pending.kind === "prefix" || buffer.pending.kind === "find") {
      return invalidInput(buffer, pendingSource(buffer));
    }

    return handleMotion(buffer, key.motion, pendingSource(buffer) + key.motion);
  }

  switch (key.kind) {
    case "digit":
      return applyLiteral(buffer, String(key.digit));
    case "operator":
      return handleOperator(buffer, key.operator);
    case "delete-character":
      return applyLiteral(buffer, "x");
    case "paste-after":
      return applyLiteral(buffer, "p");
    case "paste-before":
      return applyLiteral(buffer, "P");
    case "undo":
      return applyLiteral(buffer, "u");
    case "redo":
      return buffer.mode.kind === "visual"
        ? invalidInput(buffer, pendingSource(buffer) + "Ctrl+r")
        : redo(buffer);
    case "enter-visual-line":
      return applyLiteral(buffer, "V");
    case "enter-command":
      return applyLiteral(buffer, ":");
    case "enter-search":
      return applyLiteral(buffer, "/");
    case "search-next":
      return applyLiteral(buffer, "n");
    case "search-previous":
      return applyLiteral(buffer, "N");
    case "insert-before":
      return applyLiteral(buffer, "i");
    case "insert-after":
      return applyLiteral(buffer, "a");
    case "insert-line-start":
      return applyLiteral(buffer, "I");
    case "insert-line-end":
      return applyLiteral(buffer, "A");
    case "literal":
      return applyLiteral(buffer, key.value);
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
    status: { kind: "none" },
    goalColumn: { kind: "none" },
  };
}

export function normalVimKeyFromKeyboard(
  key: string,
  ctrlKey: boolean,
  metaKey: boolean,
): VimNormalKeyMatch {
  if (metaKey) {
    return { kind: "unrecognized" };
  }

  if (ctrlKey) {
    switch (key.toLowerCase()) {
      case "h":
        return { kind: "recognized", key: { kind: "motion", motion: "left" } };
      case "n":
        return {
          kind: "recognized",
          key: { kind: "motion", motion: "line-next" },
        };
      case "p":
        return {
          kind: "recognized",
          key: { kind: "motion", motion: "line-previous" },
        };
      case "r":
        return { kind: "recognized", key: { kind: "redo" } };
      default:
        return { kind: "unrecognized" };
    }
  }

  switch (key) {
    case "ArrowLeft":
    case "Backspace":
      return { kind: "recognized", key: { kind: "motion", motion: "left" } };
    case "ArrowRight":
      return { kind: "recognized", key: { kind: "motion", motion: "right" } };
    case "ArrowDown":
      return {
        kind: "recognized",
        key: { kind: "motion", motion: "line-next" },
      };
    case "ArrowUp":
      return {
        kind: "recognized",
        key: { kind: "motion", motion: "line-previous" },
      };
    case "Home":
      return {
        kind: "recognized",
        key: { kind: "motion", motion: "line-start" },
      };
    case "End":
      return {
        kind: "recognized",
        key: { kind: "motion", motion: "line-end" },
      };
    case "Enter":
      return {
        kind: "recognized",
        key: { kind: "motion", motion: "line-next-first-nonblank" },
      };
    case "Escape":
      return { kind: "recognized", key: { kind: "escape" } };
    default:
      return Array.from(key).length === 1
        ? { kind: "recognized", key: { kind: "literal", value: key } }
        : { kind: "unrecognized" };
  }
}
