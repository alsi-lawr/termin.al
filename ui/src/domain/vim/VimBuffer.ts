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
  type VimTextObject,
} from "./VimMotion.ts";
import {
  deleteVimBlock,
  editVimBlockChange,
  extendVimVisualSelection,
  putVimBlock,
  vimBlockRegister,
  vimVisualRange,
  type VimBlockChange,
  type VimBlockRegister,
  type VimPosition,
  type VimSelection,
  type VimVisualRange,
} from "./VimVisualSelection.ts";
import {
  applyTextSubstitution,
  parseTextSubstitution,
  type TextSubstitution,
} from "../text/TextSubstitution.ts";

export type { VimMotion } from "./VimMotion.ts";

export type VimMode =
  | Readonly<{ kind: "normal" }>
  | Readonly<{ kind: "insert" }>
  | Readonly<{ kind: "visual-character" }>
  | Readonly<{ kind: "visual-line" }>
  | Readonly<{ kind: "visual-block" }>
  | Readonly<{
      kind: "command";
      input: string;
    }>
  | Readonly<{
      kind: "search";
      prompt: "/" | "?";
      input: string;
      direction: VimSearchDirection;
      context: VimCommandContext;
    }>;

export const VimMode: Readonly<{
  Normal: Extract<VimMode, { kind: "normal" }>;
  Insert: Extract<VimMode, { kind: "insert" }>;
  VisualCharacter: Extract<VimMode, { kind: "visual-character" }>;
  VisualLine: Extract<VimMode, { kind: "visual-line" }>;
  VisualBlock: Extract<VimMode, { kind: "visual-block" }>;
}> = {
  Normal: { kind: "normal" },
  Insert: { kind: "insert" },
  VisualCharacter: { kind: "visual-character" },
  VisualLine: { kind: "visual-line" },
  VisualBlock: { kind: "visual-block" },
};

export type VimRegister =
  | Readonly<{ kind: "empty" }>
  | Readonly<{
      kind: "character";
      text: string;
    }>
  | Readonly<{
      kind: "line";
      lines: ReadonlyArray<string>;
    }>
  | VimBlockRegister;

export type VimSearch =
  | Readonly<{ kind: "none" }>
  | Readonly<{
      kind: "active";
      query: string;
      direction: VimSearchDirection;
    }>;

export type VimSearchDirection = "forward" | "backward";

export type VimCapability =
  | Readonly<{ kind: "editable" }>
  | Readonly<{ kind: "read-only" }>;

export const VimCapability: Readonly<{
  Editable: Extract<VimCapability, { kind: "editable" }>;
  ReadOnly: Extract<VimCapability, { kind: "read-only" }>;
}> = {
  Editable: { kind: "editable" },
  ReadOnly: { kind: "read-only" },
};

type VimCapabilityOperation =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "text-mutation"; source: string }>
  | Readonly<{ kind: "register-mutation"; source: string }>
  | Readonly<{ kind: "history-mutation"; source: string }>
  | Readonly<{ kind: "write-effect"; source: string }>
  | Readonly<{ kind: "quit" }>;

type VimCapabilityGate =
  | Readonly<{ kind: "allowed" }>
  | Readonly<{ kind: "handled"; buffer: VimBuffer }>;

export type VimCommandEffect =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "write" }>
  | Readonly<{ kind: "quit" }>
  | Readonly<{ kind: "force-quit" }>
  | Readonly<{
      kind: "show-history";
      history: "command" | "search";
    }>
  | Readonly<{ kind: "show-messages" }>
  | Readonly<{
      kind: "unrecognized-command";
      source: string;
    }>;

export type VimStatus =
  | Readonly<{ kind: "none" }>
  | Readonly<{
      kind: "invalid-input";
      source: string;
    }>
  | Readonly<{
      kind: "invalid-search";
      query: string;
    }>
  | Readonly<{
      kind: "no-search-match";
      query: string;
    }>
  | Readonly<{ kind: "no-previous-search" }>
  | Readonly<{
      kind: "invalid-substitution";
      message: string;
    }>
  | Readonly<{
      kind: "no-substitution-match";
      pattern: string;
    }>
  | Readonly<{
      kind: "read-only";
      source: string;
    }>;

export type VimOperator = "delete" | "change" | "yank";

export type VimDigit = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export type VimMarkName =
  | "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h" | "i"
  | "j" | "k" | "l" | "m" | "n" | "o" | "p" | "q" | "r"
  | "s" | "t" | "u" | "v" | "w" | "x" | "y" | "z";

export type VimMark = Readonly<{
  name: VimMarkName;
  position: VimPosition;
}>;

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
  | Readonly<{ kind: "enter-visual-character" }>
  | Readonly<{ kind: "enter-visual-line" }>
  | Readonly<{ kind: "enter-visual-block" }>
  | Readonly<{ kind: "enter-command" }>
  | Readonly<{ kind: "enter-search" }>
  | Readonly<{ kind: "search-next" }>
  | Readonly<{ kind: "search-previous" }>
  | Readonly<{ kind: "insert-before" }>
  | Readonly<{ kind: "insert-after" }>
  | Readonly<{ kind: "insert-line-start" }>
  | Readonly<{ kind: "insert-line-end" }>
  | Readonly<{ kind: "insert-key" }>
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
  | Readonly<{ kind: "force-quit" }>
  | Readonly<{
      kind: "show-history";
      history: "command" | "search";
    }>
  | Readonly<{ kind: "show-messages" }>;

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
  marks: ReadonlyArray<VimMark>;
  register: VimRegister;
}>;

export type VimCommandContext =
  | Readonly<{ kind: "normal"; count: number }>
  | Readonly<{
      kind: "visual-selection";
      count: number;
      mode: Extract<
        VimMode,
        { kind: "visual-character" | "visual-line" | "visual-block" }
      >;
    }>
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
    }>
  | Readonly<{
      kind: "section";
      context: VimCommandContext;
      opening: "[" | "]";
      source: string;
    }>
  | Readonly<{
      kind: "mark";
      action: "set" | "jump-exact" | "jump-line";
      context: VimCommandContext;
      source: string;
    }>
  | Readonly<{
      kind: "text-object";
      context: Extract<VimCommandContext, { kind: "operator" | "visual-selection" }>;
      around: boolean;
      source: string;
    }>;

type VimTextState = Readonly<{
  lines: ReadonlyArray<string>;
  cursor: VimPosition;
  mode: VimMode;
  selection: VimSelection;
}>;

type VimTextRange = VimMotionRange;

type VimInsertSession =
  | Readonly<{ kind: "ordinary" }>
  | Readonly<{
      kind: "block-change";
      change: VimBlockChange;
    }>
  | Readonly<{ kind: "block-change-ended" }>;

export type VimBuffer = Readonly<{
  capability: VimCapability;
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
  marks: ReadonlyArray<VimMark>;
  insertSession: VimInsertSession;
}>;

export type CreateVimBufferOptions = Readonly<{
  text: string;
  mode: Extract<VimMode, { kind: "normal" | "insert" }>;
  capability?: VimCapability;
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

export function isVimVisualMode(
  mode: VimMode,
): mode is Extract<
  VimMode,
  { kind: "visual-character" | "visual-line" | "visual-block" }
> {
  return mode.kind === "visual-character" ||
    mode.kind === "visual-line" ||
    mode.kind === "visual-block";
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
    selection,
  };
}

function snapshot(buffer: VimBuffer): VimSnapshot {
  return {
    lines: buffer.lines,
    cursor: buffer.cursor,
    mode: buffer.mode,
    selection: buffer.selection,
    marks: buffer.marks,
    register: buffer.register,
  };
}

type VimEditInterval = Readonly<{
  oldStart: number;
  oldEnd: number;
  newEnd: number;
}>;

function editInterval(oldText: string, newText: string): VimEditInterval {
  let start = 0;
  const sharedLength = Math.min(oldText.length, newText.length);

  while (start < sharedLength && oldText[start] === newText[start]) {
    start += 1;
  }

  const safeStart = normalizeUnicodeCursorOffset(oldText, start);
  let oldEnd = oldText.length;
  let newEnd = newText.length;

  while (
    oldEnd > safeStart &&
    newEnd > safeStart &&
    oldText[oldEnd - 1] === newText[newEnd - 1]
  ) {
    oldEnd -= 1;
    newEnd -= 1;
  }

  return {
    oldStart: safeStart,
    oldEnd: normalizeUnicodeCursorOffset(oldText, oldEnd),
    newEnd: normalizeUnicodeCursorOffset(newText, newEnd),
  };
}

function adjustMarks(
  buffer: VimBuffer,
  lines: ReadonlyArray<string>,
  intervals: ReadonlyArray<VimEditInterval>,
): ReadonlyArray<VimMark> {
  const newText = joinLines(lines);
  const adjusted: Array<VimMark> = [];

  for (const mark of buffer.marks) {
    const offset = textOffsetForPosition(buffer.lines, mark.position);
    let nextOffset = offset;
    let removed = false;

    for (const interval of intervals) {
      const delta = interval.newEnd - interval.oldEnd;

      if (interval.oldStart === interval.oldEnd) {
        if (offset >= interval.oldStart) {
          nextOffset += delta;
        }
      } else if (offset >= interval.oldStart && offset < interval.oldEnd) {
        removed = true;
        break;
      } else if (offset >= interval.oldEnd) {
        nextOffset += delta;
      }
    }

    if (removed || nextOffset < 0 || nextOffset > newText.length) {
      continue;
    }

    adjusted.push({
      name: mark.name,
      position: vimPositionForTextOffset(lines, nextOffset, "character"),
    });
  }

  return adjusted;
}

function lineEditIntervals(
  buffer: VimBuffer,
  lines: ReadonlyArray<string>,
  startLine: number,
  endLine: number,
): ReadonlyArray<VimEditInterval> {
  const intervals: Array<VimEditInterval> = [];

  for (let line = startLine; line <= endLine; line += 1) {
    const oldText = lineAt(buffer.lines, line);
    const newText = lineAt(lines, line);

    if (oldText === newText) {
      continue;
    }

    const local = editInterval(oldText, newText);
    const offset = lineStartOffset(buffer.lines, line);
    intervals.push({
      oldStart: offset + local.oldStart,
      oldEnd: offset + local.oldEnd,
      newEnd: offset + local.newEnd,
    });
  }

  return intervals;
}

function adjustLineMarks(
  buffer: VimBuffer,
  lines: ReadonlyArray<string>,
  startLine: number,
  endLine: number,
): ReadonlyArray<VimMark> {
  return adjustMarks(
    buffer,
    lines,
    lineEditIntervals(buffer, lines, startLine, endLine),
  );
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
  intervals: ReadonlyArray<VimEditInterval>,
): VimBuffer {
  if (textStateMatches(buffer, next) && buffer.register === register) {
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
    marks: adjustMarks(buffer, next.lines, intervals),
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

function gateVimCapability(
  buffer: VimBuffer,
  operation: VimCapabilityOperation,
): VimCapabilityGate {
  switch (buffer.capability.kind) {
    case "editable":
      return { kind: "allowed" };
    case "read-only":
      if (operation.kind === "none") {
        return { kind: "allowed" };
      }

      if (operation.kind === "quit") {
        return {
          kind: "handled",
          buffer: {
            ...resetPending(buffer),
            commandEffect: { kind: "quit" },
          },
        };
      }

      return {
        kind: "handled",
        buffer: {
          ...buffer,
          commandEffect: { kind: "none" },
          pending: { kind: "none" },
          status: { kind: "read-only", source: operation.source },
        },
      };
  }
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
  if (isVimVisualMode(buffer.mode)) {
    return {
      kind: "visual-selection",
      count: pendingCount(buffer.pending),
      mode: buffer.mode,
    };
  }

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

function lineAt(lines: ReadonlyArray<string>, line: number): string {
  const value = lines[line];

  if (value === undefined) {
    throw new Error("Vim positions must reference existing lines.");
  }

  return value;
}

function lineDeletionInterval(
  buffer: VimBuffer,
  range: Extract<VimTextRange, { kind: "line" }>,
): VimEditInterval {
  const oldText = joinLines(buffer.lines);
  let oldStart = lineStartOffset(buffer.lines, range.startLine);

  if (range.startLine > 0 && range.endLine === buffer.lines.length - 1) {
    oldStart -= 1;
  }

  const oldEnd = range.endLine === buffer.lines.length - 1
    ? oldText.length
    : lineStartOffset(buffer.lines, range.endLine + 1);

  return { oldStart, oldEnd, newEnd: oldStart };
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
      [lineDeletionInterval(buffer, range)],
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
    [{ oldStart: start, oldEnd: end, newEnd: start }],
  );
}

function topLeftCursor(
  lines: ReadonlyArray<string>,
  range: Extract<VimVisualRange, { kind: "block" }>,
  mode: VimMode,
): VimPosition {
  return normalisePosition(
    lines,
    { line: range.startLine, column: range.startColumn },
    mode,
  );
}

function deleteBlockRange(
  buffer: VimBuffer,
  range: Extract<VimVisualRange, { kind: "block" }>,
  operation: "delete" | "change",
): VimBuffer {
  const editSource: VimBuffer = {
    ...buffer,
    mode: VimMode.Normal,
    selection: { kind: "none" },
    insertSession: { kind: "ordinary" },
  };
  const deletion = deleteVimBlock(buffer.lines, range);
  const mode = operation === "change" ? VimMode.Insert : VimMode.Normal;
  const cursor = topLeftCursor(deletion.lines, range, mode);
  const committed = commitEdit(
    editSource,
    createTextState(deletion.lines, cursor, mode, { kind: "none" }),
    deletion.register,
    [editInterval(joinLines(buffer.lines), joinLines(deletion.lines))],
  );
  const next = {
    ...committed,
    marks: adjustLineMarks(
      editSource,
      deletion.lines,
      range.startLine,
      range.endLine,
    ),
  };

  return operation === "change"
    ? {
        ...next,
        insertSession: {
          kind: "block-change",
          change: deletion.change,
        },
      }
    : next;
}

function finishVisualYank(
  buffer: VimBuffer,
  register: VimRegister,
  cursor: VimPosition,
): VimBuffer {
  return {
    ...withTextState(
      buffer,
      createTextState(buffer.lines, cursor, VimMode.Normal, { kind: "none" }),
    ),
    register,
    goalColumn: { kind: "none" },
    insertSession: { kind: "ordinary" },
  };
}

function applyVisualOperator(
  buffer: VimBuffer,
  operator: VimOperator,
): VimBuffer {
  const range = vimVisualRange(buffer.lines, buffer.selection);

  if (range.kind === "block") {
    return operator === "yank"
      ? finishVisualYank(
          buffer,
          vimBlockRegister(buffer.lines, range),
          topLeftCursor(buffer.lines, range, VimMode.Normal),
        )
      : deleteBlockRange(
          buffer,
          range,
          operator === "change" ? "change" : "delete",
        );
  }

  const textRange: VimTextRange = range.kind === "character"
    ? {
        kind: "character",
        start: range.start,
        end: range.end,
        inclusivity: "inclusive",
      }
    : range;

  if (operator === "yank") {
    const cursor = range.kind === "line"
      ? { line: range.startLine, column: 0 }
      : positionForTextOffset(buffer.lines, range.start, VimMode.Normal);
    return finishVisualYank(buffer, registerForRange(buffer, textRange), cursor);
  }

  return deleteRange(
    {
      ...buffer,
      mode: VimMode.Normal,
      selection: { kind: "none" },
      insertSession: { kind: "ordinary" },
    },
    textRange,
    operator === "change",
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
  if (isVimVisualMode(buffer.mode)) {
    return applyVisualOperator(buffer, operator);
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

  if (isVimVisualMode(buffer.mode)) {
    if (buffer.selection.kind === "none") {
      throw new Error("Visual mode requires a typed visual selection.");
    }

    const extended = extendVimVisualSelection(
      buffer.lines,
      buffer.selection,
      request.kind === "text-object"
        ? {
            kind: "text-object",
            cursor: resolution.motion.cursor,
            range: resolution.motion.range,
          }
        : { kind: "motion", cursor: resolution.motion.cursor },
    );
    const moved = withTextState(
      buffer,
      createTextState(
        buffer.lines,
        extended.cursor,
        buffer.mode,
        extended.selection,
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
  return {
    ...withTextState(
      { ...buffer, goalColumn: { kind: "none" } },
      createTextState(buffer.lines, cursor, VimMode.Insert, { kind: "none" }),
    ),
    insertSession: { kind: "ordinary" },
  };
}

function enterNormalMode(buffer: VimBuffer): VimBuffer {
  const cursor = buffer.insertSession.kind === "block-change" &&
      buffer.insertSession.change.insertedText.length > 0
    ? {
        line: buffer.insertSession.change.startLine,
        column: previousUnicodeCursorOffset(
          lineAt(buffer.lines, buffer.insertSession.change.startLine),
          buffer.insertSession.change.startColumn +
            buffer.insertSession.change.insertedText.length,
        ),
      }
    : buffer.cursor;

  return {
    ...withTextState(
      buffer,
      createTextState(buffer.lines, cursor, VimMode.Normal, {
        kind: "none",
      }),
    ),
    insertSession: { kind: "ordinary" },
  };
}

type VimVisualMode = Extract<
  VimMode,
  { kind: "visual-character" | "visual-line" | "visual-block" }
>;

function selectionForVisualMode(
  buffer: VimBuffer,
  mode: VimVisualMode,
): VimSelection {
  const anchor = (() => {
    switch (buffer.selection.kind) {
      case "character":
      case "block":
        return buffer.selection.anchor;
      case "line":
        return { line: buffer.selection.anchorLine, column: buffer.cursor.column };
      case "none":
        return buffer.cursor;
    }
  })();

  switch (mode.kind) {
    case "visual-character":
      return { kind: "character", anchor, active: buffer.cursor };
    case "visual-line":
      return {
        kind: "line",
        anchorLine: anchor.line,
        activeLine: buffer.cursor.line,
      };
    case "visual-block":
      return { kind: "block", anchor, active: buffer.cursor };
  }
}

function enterVisualMode(buffer: VimBuffer, mode: VimVisualMode): VimBuffer {
  if (buffer.mode.kind === mode.kind) {
    return enterNormalMode(buffer);
  }

  return withTextState(
    buffer,
    createTextState(
      buffer.lines,
      buffer.cursor,
      mode,
      selectionForVisualMode(buffer, mode),
    ),
  );
}

function pasteRegister(buffer: VimBuffer, afterCursor: boolean): VimBuffer {
  if (buffer.register.kind === "empty") {
    return resetPending(buffer);
  }

  if (buffer.register.kind === "line") {
    const oldText = joinLines(buffer.lines);
    const insertionLine = buffer.cursor.line + (afterCursor ? 1 : 0);
    const insertionOffset = insertionLine === buffer.lines.length
      ? oldText.length
      : lineStartOffset(buffer.lines, insertionLine);
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
      [{
        oldStart: insertionOffset,
        oldEnd: insertionOffset,
        newEnd: insertionOffset + joinLines(lines).length - oldText.length,
      }],
    );
  }

  if (buffer.register.kind === "block") {
    const put = putVimBlock(buffer.lines, buffer.cursor, buffer.register, {
      placement: afterCursor ? "after" : "before",
      count: pendingCount(buffer.pending),
    });

    const committed = commitEdit(
      buffer,
      createTextState(
        put.lines,
        put.cursor,
        VimMode.Normal,
        { kind: "none" },
      ),
      buffer.register,
      [editInterval(joinLines(buffer.lines), joinLines(put.lines))],
    );

    return {
      ...committed,
      marks: adjustLineMarks(
        buffer,
        put.lines,
        buffer.cursor.line,
        Math.min(
          buffer.lines.length - 1,
          buffer.cursor.line + buffer.register.fragments.length - 1,
        ),
      ),
    };
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
    [{
      oldStart: insertionOffset,
      oldEnd: insertionOffset,
      newEnd: insertionOffset + buffer.register.text.length,
    }],
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
    ...createTextState(
      previous.lines,
      previous.cursor,
      VimMode.Normal,
      { kind: "none" },
    ),
    undoStack: buffer.undoStack.slice(0, -1),
    redoStack: [snapshot(buffer), ...buffer.redoStack].slice(
      0,
      vimHistoryCapacity,
    ),
    pending: { kind: "none" },
    status: { kind: "none" },
    goalColumn: { kind: "none" },
    insertSession: { kind: "ordinary" },
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
    ...createTextState(
      next.lines,
      next.cursor,
      VimMode.Normal,
      { kind: "none" },
    ),
    undoStack: [...buffer.undoStack, snapshot(buffer)].slice(
      -vimHistoryCapacity,
    ),
    redoStack: buffer.redoStack.slice(1),
    pending: { kind: "none" },
    status: { kind: "none" },
    goalColumn: { kind: "none" },
    insertSession: { kind: "ordinary" },
  };
}

type VimSearchMatch = Readonly<{
  start: number;
  end: number;
}>;

export type VimCommandPreviewRange = Readonly<{
  start: number;
  end: number;
  role: "search" | "current-search" | "matched" | "replaced";
}>;

export type VimCommandPreview = Readonly<{
  source: string;
  ranges: ReadonlyArray<VimCommandPreviewRange>;
}>;

type VimSearchMatches =
  | Readonly<{ kind: "matches"; values: ReadonlyArray<VimSearchMatch> }>
  | Readonly<{ kind: "invalid" }>;

function searchMatches(text: string, query: string): VimSearchMatches {
  let expression: RegExp;

  try {
    expression = new RegExp(query, "gmu");
  } catch (error: unknown) {
    if (error instanceof SyntaxError) {
      return { kind: "invalid" };
    }

    throw error;
  }

  const values: Array<VimSearchMatch> = [];
  let match = expression.exec(text);

  while (match !== null) {
    values.push({ start: match.index, end: match.index + match[0].length });

    if (match[0].length === 0) {
      expression.lastIndex = nextUnicodeCursorOffset(text, expression.lastIndex);

      if (expression.lastIndex === text.length && match.index === text.length) {
        break;
      }
    }

    match = expression.exec(text);
  }

  return { kind: "matches", values };
}

function searchMatchFrom(
  matches: ReadonlyArray<VimSearchMatch>,
  cursorOffset: number,
  direction: VimSearchDirection,
): VimSearchMatch | undefined {
  if (direction === "forward") {
    return matches.find((match) => match.start > cursorOffset) ?? matches[0];
  }

  return matches.findLast((match) => match.start < cursorOffset) ?? matches.at(-1);
}

function searchMatchForContext(
  matches: ReadonlyArray<VimSearchMatch>,
  cursorOffset: number,
  direction: VimSearchDirection,
  count: number,
): VimSearchMatch | undefined {
  if (matches.length === 0) {
    return undefined;
  }

  const stepCount = ((count - 1) % matches.length) + 1;
  let target: VimSearchMatch | undefined;
  let offset = cursorOffset;

  for (let iteration = 0; iteration < stepCount; iteration += 1) {
    target = searchMatchFrom(matches, offset, direction);

    if (target === undefined) {
      return undefined;
    }

    offset = target.start;
  }

  return target;
}

function searchFailure(
  buffer: VimBuffer,
  query: string,
  kind: "invalid-search" | "no-search-match",
  context: VimCommandContext,
): VimBuffer {
  const mode = context.kind === "visual-selection"
    ? context.mode
    : VimMode.Normal;

  return {
    ...buffer,
    mode,
    selection: context.kind === "visual-selection"
      ? buffer.selection
      : { kind: "none" },
    pending: { kind: "none" },
    status: { kind, query },
  };
}

function noPreviousSearchFailure(
  buffer: VimBuffer,
  context: VimCommandContext,
): VimBuffer {
  return {
    ...searchFailure(buffer, "", "no-search-match", context),
    status: { kind: "no-previous-search" },
  };
}

function searchMotionRange(
  cursorOffset: number,
  targetOffset: number,
): VimTextRange {
  return {
    kind: "character",
    start: Math.min(cursorOffset, targetOffset),
    end: Math.max(cursorOffset, targetOffset),
    inclusivity: "exclusive",
  };
}

function applySearchMatch(
  buffer: VimBuffer,
  match: VimSearchMatch,
  context: VimCommandContext,
): VimBuffer {
  const cursorOffset = textOffsetForPosition(buffer.lines, buffer.cursor);
  const cursor = positionForTextOffset(buffer.lines, match.start, VimMode.Normal);

  if (context.kind === "operator") {
    return applyOperatorRange(
      { ...buffer, mode: VimMode.Normal, selection: { kind: "none" } },
      context.operator,
      searchMotionRange(cursorOffset, match.start),
    );
  }

  if (context.kind === "visual-selection") {
    if (buffer.selection.kind === "none") {
      throw new Error("Visual search motions require a typed selection.");
    }

    const extended = extendVimVisualSelection(
      buffer.lines,
      buffer.selection,
      { kind: "motion", cursor },
    );

    return withTextState(
      buffer,
      createTextState(buffer.lines, extended.cursor, context.mode, extended.selection),
    );
  }

  return withTextState(
    buffer,
    createTextState(buffer.lines, cursor, VimMode.Normal, { kind: "none" }),
  );
}

function moveToSearchMatch(
  buffer: VimBuffer,
  direction: VimSearchDirection,
  context: VimCommandContext,
): VimBuffer {
  if (buffer.search.kind !== "active" || buffer.search.query.length === 0) {
    return invalidInput(buffer, direction === "forward" ? "n" : "N");
  }

  const text = joinLines(buffer.lines);
  const matches = searchMatches(text, buffer.search.query);

  if (matches.kind === "invalid") {
    return searchFailure(buffer, buffer.search.query, "invalid-search", context);
  }

  if (matches.values.length === 0) {
    return searchFailure(buffer, buffer.search.query, "no-search-match", context);
  }

  const cursorOffset = textOffsetForPosition(buffer.lines, buffer.cursor);
  const target = searchMatchForContext(
    matches.values,
    cursorOffset,
    direction,
    context.count,
  );

  return target === undefined
    ? searchFailure(buffer, buffer.search.query, "no-search-match", context)
    : applySearchMatch(buffer, target, { ...context, count: 1 });
}

export function createVimBuffer({
  text,
  mode,
  capability = VimCapability.Editable,
}: CreateVimBufferOptions): VimBuffer {
  const lines = splitText(text);
  const cursor = { line: 0, column: 0 };
  const state = createTextState(lines, cursor, mode, { kind: "none" });

  return {
    capability,
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
    marks: [],
    insertSession: { kind: "ordinary" },
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

type VimInsertion = Readonly<{
  textState: VimTextState;
  interval: VimEditInterval;
}>;

function insertAtVimCursor(buffer: VimBuffer, text: string): VimInsertion {
  const currentText = vimBufferText(buffer);
  const cursorOffset = vimBufferCursorOffset(buffer);
  const lines = splitText(
    currentText.slice(0, cursorOffset) + text + currentText.slice(cursorOffset),
  );

  return {
    textState: createTextState(
      lines,
      positionForTextOffset(lines, cursorOffset + text.length, VimMode.Insert),
      VimMode.Insert,
      { kind: "none" },
    ),
    interval: {
      oldStart: cursorOffset,
      oldEnd: cursorOffset,
      newEnd: cursorOffset + text.length,
    },
  };
}

function continueBlockChange(
  buffer: VimBuffer,
  insertedText: string,
): VimBuffer {
  if (buffer.insertSession.kind === "ordinary" || insertedText.length === 0) {
    return buffer;
  }

  if (buffer.insertSession.kind === "block-change-ended") {
    const insertion = insertAtVimCursor(buffer, insertedText);

    return {
      ...buffer,
      ...insertion.textState,
      marks: adjustMarks(buffer, insertion.textState.lines, [insertion.interval]),
      insertSession: { kind: "block-change-ended" },
    };
  }

  if (insertedText.includes("\n")) {
    const change = buffer.insertSession.change;
    const cleared = editVimBlockChange(
      buffer.lines,
      change,
      { kind: "clear" },
    );
    const intermediate: VimBuffer = {
      ...buffer,
      lines: cleared.lines,
      cursor: cleared.cursor,
      marks: adjustLineMarks(
        buffer,
        cleared.lines,
        change.startLine,
        change.eligibleLines.at(-1) ?? change.startLine,
      ),
    };
    const replacement = change.insertedText + insertedText;
    const insertion = insertAtVimCursor(intermediate, replacement);

    return {
      ...intermediate,
      ...insertion.textState,
      marks: adjustMarks(
        intermediate,
        insertion.textState.lines,
        [insertion.interval],
      ),
      insertSession: { kind: "block-change-ended" },
    };
  }

  const result = editVimBlockChange(
    buffer.lines,
    buffer.insertSession.change,
    { kind: "insert", text: insertedText },
  );

  return {
    ...buffer,
    ...createTextState(
      result.lines,
      result.cursor,
      VimMode.Insert,
      { kind: "none" },
    ),
    marks: adjustLineMarks(
      buffer,
      result.lines,
      result.change.startLine,
      result.change.eligibleLines.at(-1) ?? result.change.startLine,
    ),
    insertSession: { kind: "block-change", change: result.change },
  };
}

export function insertVimText(buffer: VimBuffer, text: string): VimBuffer {
  const capability = gateVimCapability(buffer, {
    kind: "text-mutation",
    source: "insert",
  });

  if (capability.kind === "handled") {
    return capability.buffer;
  }

  if (buffer.mode.kind !== "insert" || text.length === 0) {
    return buffer;
  }

  if (buffer.insertSession.kind !== "ordinary") {
    return continueBlockChange(buffer, text);
  }

  const insertion = insertAtVimCursor(buffer, text);

  return commitEdit(
    buffer,
    insertion.textState,
    buffer.register,
    [insertion.interval],
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
    [{ oldStart: safeStart, oldEnd: safeEnd, newEnd: safeStart }],
  );
}

export function backspaceVimInsertText(buffer: VimBuffer): VimBuffer {
  const capability = gateVimCapability(buffer, {
    kind: "text-mutation",
    source: "backspace",
  });

  if (capability.kind === "handled") {
    return capability.buffer;
  }

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
  const capability = gateVimCapability(buffer, {
    kind: "text-mutation",
    source: "delete",
  });

  if (capability.kind === "handled") {
    return capability.buffer;
  }

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
  const capability = gateVimCapability(buffer, {
    kind: "text-mutation",
    source: "insert",
  });

  if (capability.kind === "handled") {
    return capability.buffer;
  }

  if (buffer.mode.kind !== "insert") {
    return buffer;
  }

  if (buffer.insertSession.kind === "block-change") {
    const interval = editInterval(vimBufferText(buffer), text);
    return continueBlockChange(
      buffer,
      text.slice(interval.oldStart, interval.newEnd),
    );
  }

  if (buffer.insertSession.kind === "block-change-ended") {
    const lines = splitText(text);
    const cursor = positionForTextOffset(lines, cursorOffset, VimMode.Insert);

    return {
      ...buffer,
      ...createTextState(lines, cursor, VimMode.Insert, { kind: "none" }),
      marks: adjustMarks(
        buffer,
        lines,
        [editInterval(vimBufferText(buffer), text)],
      ),
    };
  }

  const lines = splitText(text);
  const cursor = positionForTextOffset(lines, cursorOffset, VimMode.Insert);
  const interval = editInterval(vimBufferText(buffer), text);

  return commitEdit(
    buffer,
    createTextState(lines, cursor, VimMode.Insert, { kind: "none" }),
    buffer.register,
    [interval],
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

function beginSection(buffer: VimBuffer, opening: "[" | "]"): VimBuffer {
  return clearVimStatus(
    withPending(buffer, {
      kind: "section",
      context: commandContext(buffer),
      opening,
      source: pendingSource(buffer) + opening,
    }),
  );
}

function beginMark(
  buffer: VimBuffer,
  action: "set" | "jump-exact" | "jump-line",
  source: string,
): VimBuffer {
  const context = commandContext(buffer);

  if (
    action === "set" &&
    (context.kind === "operator" || buffer.pending.kind !== "none")
  ) {
    return invalidInput(buffer, pendingSource(buffer) + source);
  }

  return clearVimStatus(
    withPending(buffer, {
      kind: "mark",
      action,
      context,
      source: pendingSource(buffer) + source,
    }),
  );
}

function beginTextObject(buffer: VimBuffer, around: boolean, source: string): VimBuffer {
  const context = commandContext(buffer);

  if (context.kind !== "operator" && context.kind !== "visual-selection") {
    return invalidInput(buffer, pendingSource(buffer) + source);
  }

  return clearVimStatus(
    withPending(buffer, {
      kind: "text-object",
      context,
      around,
      source: pendingSource(buffer) + source,
    }),
  );
}

function vimMarkName(value: string): VimMarkName | undefined {
  switch (value) {
    case "a": return "a";
    case "b": return "b";
    case "c": return "c";
    case "d": return "d";
    case "e": return "e";
    case "f": return "f";
    case "g": return "g";
    case "h": return "h";
    case "i": return "i";
    case "j": return "j";
    case "k": return "k";
    case "l": return "l";
    case "m": return "m";
    case "n": return "n";
    case "o": return "o";
    case "p": return "p";
    case "q": return "q";
    case "r": return "r";
    case "s": return "s";
    case "t": return "t";
    case "u": return "u";
    case "v": return "v";
    case "w": return "w";
    case "x": return "x";
    case "y": return "y";
    case "z": return "z";
    default: return undefined;
  }
}

function textObject(value: string): VimTextObject | undefined {
  switch (value) {
    case "w": return "word";
    case "W": return "WORD";
    case "s": return "sentence";
    case "p": return "paragraph";
    case "\"": return "double-quote";
    case "'": return "single-quote";
    case "`": return "backtick-quote";
    case "[":
    case "]": return "square-brackets";
    case "(":
    case ")":
    case "b": return "round-brackets";
    case "<":
    case ">": return "angle-brackets";
    case "{":
    case "}":
    case "B": return "curly-brackets";
    case "t": return "tag";
    default: return undefined;
  }
}

function applySectionContinuation(buffer: VimBuffer, value: string): VimBuffer {
  if (buffer.pending.kind !== "section") {
    throw new Error("Vim section continuation requires section state.");
  }

  const source = buffer.pending.source + value;
  let motion: VimMotion;

  if (buffer.pending.opening === "[" && value === "[") {
    motion = "section-start-backward";
  } else if (buffer.pending.opening === "[" && value === "]") {
    motion = "section-end-backward";
  } else if (buffer.pending.opening === "]" && value === "]") {
    motion = "section-start-forward";
  } else if (buffer.pending.opening === "]" && value === "[") {
    motion = "section-end-forward";
  } else {
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

function applyMarkContinuation(buffer: VimBuffer, value: string): VimBuffer {
  if (buffer.pending.kind !== "mark") {
    throw new Error("Vim mark continuation requires mark state.");
  }

  const source = buffer.pending.source + value;
  const name = vimMarkName(value);

  if (name === undefined) {
    return invalidInput(buffer, source);
  }

  if (buffer.pending.action === "set") {
    const marks = buffer.marks.filter((mark) => mark.name !== name);
    return {
      ...resetPending(buffer),
      marks: [...marks, { name, position: buffer.cursor }],
    };
  }

  const mark = buffer.marks.find((candidate) => candidate.name === name);

  if (mark === undefined) {
    return invalidInput(buffer, source);
  }

  return executeMotion(
    buffer,
    {
      kind: "mark",
      target: mark.position,
      linewise: buffer.pending.action === "jump-line",
    },
    buffer.pending.context,
    source,
    buffer.lastFind,
  );
}

function applyTextObjectContinuation(buffer: VimBuffer, value: string): VimBuffer {
  if (buffer.pending.kind !== "text-object") {
    throw new Error("Vim text-object continuation requires object state.");
  }

  const source = buffer.pending.source + value;
  const object = textObject(value);

  if (object === undefined) {
    return invalidInput(buffer, source);
  }

  return executeMotion(
    buffer,
    { kind: "text-object", object, around: buffer.pending.around },
    buffer.pending.context,
    source,
    buffer.lastFind,
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

  if (value === "n" || value === "N") {
    return selectSearchMatch(
      buffer,
      value === "n" ? "forward" : "backward",
      buffer.pending.context,
      source,
    );
  }

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

function searchObjectMatchFrom(
  matches: ReadonlyArray<VimSearchMatch>,
  cursorOffset: number,
  direction: VimSearchDirection,
): VimSearchMatch | undefined {
  const containing = matches.find(
    (match) => match.start <= cursorOffset && cursorOffset < match.end,
  );

  return containing ?? searchMatchFrom(matches, cursorOffset, direction);
}

function selectSearchMatch(
  buffer: VimBuffer,
  direction: VimSearchDirection,
  context: VimCommandContext,
  source: string,
): VimBuffer {
  if (buffer.search.kind !== "active" || buffer.search.query.length === 0) {
    return invalidInput(buffer, source);
  }

  const text = joinLines(buffer.lines);
  const matches = searchMatches(text, buffer.search.query);

  if (matches.kind === "invalid") {
    return searchFailure(
      buffer,
      buffer.search.query,
      "invalid-search",
      context,
    );
  }

  const cursorOffset = textOffsetForPosition(buffer.lines, buffer.cursor);
  const stepCount = matches.values.length === 0
    ? 0
    : ((context.count - 1) % matches.values.length) + 1;
  let match = searchObjectMatchFrom(matches.values, cursorOffset, direction);

  for (let iteration = 1; iteration < stepCount && match !== undefined; iteration += 1) {
    match = searchMatchFrom(matches.values, match.start, direction);
  }

  if (match === undefined || match.start === match.end) {
    return searchFailure(
      buffer,
      buffer.search.query,
      "no-search-match",
      context,
    );
  }

  if (context.kind === "operator") {
    return applyOperatorRange(
      buffer,
      context.operator,
      {
        kind: "character",
        start: match.start,
        end: match.end,
        inclusivity: "inclusive",
      },
    );
  }

  const anchor = positionForTextOffset(buffer.lines, match.start, VimMode.Normal);
  const active = positionForTextOffset(
    buffer.lines,
    previousUnicodeCursorOffset(text, match.end),
    VimMode.Normal,
  );

  return withTextState(
    buffer,
    createTextState(
      buffer.lines,
      active,
      VimMode.VisualCharacter,
      { kind: "character", anchor, active },
    ),
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

const noCapabilityOperation: VimCapabilityOperation = { kind: "none" };

function operatorCapabilityOperation(
  operator: VimOperator,
  source: string,
): VimCapabilityOperation {
  return operator === "yank"
    ? { kind: "register-mutation", source }
    : { kind: "text-mutation", source };
}

function literalCapabilityClassification(
  buffer: VimBuffer,
  value: string,
): VimCapabilityOperation {
  if (
    buffer.pending.kind === "prefix" ||
    buffer.pending.kind === "find" ||
    buffer.pending.kind === "section" ||
    buffer.pending.kind === "mark" ||
    buffer.pending.kind === "text-object"
  ) {
    return noCapabilityOperation;
  }

  const source = pendingSource(buffer) + value;
  const visual = isVimVisualMode(buffer.mode);

  if (
    (value === "i" || value === "a") &&
    (visual || buffer.pending.kind === "operator")
  ) {
    return noCapabilityOperation;
  }

  if (
    visual &&
    (value === "p" || value === "P" || value === "I" ||
      value === "A" || value === "u")
  ) {
    return noCapabilityOperation;
  }

  switch (value) {
    case "d":
    case "c":
    case "x":
    case "p":
    case "P":
    case "i":
    case "a":
    case "I":
    case "A":
      return { kind: "text-mutation", source };
    case "y":
      return { kind: "register-mutation", source };
    case "u":
      return { kind: "history-mutation", source };
    case "q":
      return buffer.mode.kind === "normal" && buffer.pending.kind === "none"
        ? { kind: "quit" }
        : noCapabilityOperation;
    default:
      return noCapabilityOperation;
  }
}

function normalKeyCapabilityClassification(
  buffer: VimBuffer,
  key: VimNormalKey,
): VimCapabilityOperation {
  switch (key.kind) {
    case "operator":
      return operatorCapabilityOperation(
        key.operator,
        pendingSource(buffer) + operatorSource(key.operator),
      );
    case "delete-character":
      return literalCapabilityClassification(buffer, "x");
    case "paste-after":
      return literalCapabilityClassification(buffer, "p");
    case "paste-before":
      return literalCapabilityClassification(buffer, "P");
    case "undo":
      return literalCapabilityClassification(buffer, "u");
    case "redo":
      return isVimVisualMode(buffer.mode)
        ? noCapabilityOperation
        : {
            kind: "history-mutation",
            source: "Ctrl+r",
          };
    case "insert-before":
      return literalCapabilityClassification(buffer, "i");
    case "insert-after":
      return literalCapabilityClassification(buffer, "a");
    case "insert-line-start":
      return literalCapabilityClassification(buffer, "I");
    case "insert-line-end":
      return literalCapabilityClassification(buffer, "A");
    case "insert-key":
      return { kind: "text-mutation", source: "Insert" };
    case "literal":
      return literalCapabilityClassification(buffer, key.value);
    case "motion":
    case "digit":
    case "enter-visual-character":
    case "enter-visual-line":
    case "enter-visual-block":
    case "enter-command":
    case "enter-search":
    case "search-next":
    case "search-previous":
    case "escape":
      return noCapabilityOperation;
  }
}

function applyLiteral(buffer: VimBuffer, value: string): VimBuffer {
  if (buffer.pending.kind === "prefix") {
    return applyPrefixContinuation(buffer, value);
  }

  if (buffer.pending.kind === "find") {
    return applyFindTarget(buffer, value);
  }

  if (buffer.pending.kind === "section") {
    return applySectionContinuation(buffer, value);
  }

  if (buffer.pending.kind === "mark") {
    return applyMarkContinuation(buffer, value);
  }

  if (buffer.pending.kind === "text-object") {
    return applyTextObjectContinuation(buffer, value);
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
    case "(":
      return handleMotion(buffer, "sentence-backward", pendingSource(buffer) + value);
    case ")":
      return handleMotion(buffer, "sentence-forward", pendingSource(buffer) + value);
    case "{":
      return handleMotion(buffer, "paragraph-backward", pendingSource(buffer) + value);
    case "}":
      return handleMotion(buffer, "paragraph-forward", pendingSource(buffer) + value);
    case "[":
    case "]":
      return beginSection(buffer, value);
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
    case "m":
      return beginMark(buffer, "set", value);
    case "'":
      return beginMark(buffer, "jump-line", value);
    case "`":
      return beginMark(buffer, "jump-exact", value);
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
      return isVimVisualMode(buffer.mode)
        ? applyVisualOperator(buffer, "delete")
        : deleteCharacters(buffer);
    case "p":
      return isVimVisualMode(buffer.mode)
        ? invalidInput(buffer, pendingSource(buffer) + value)
        : pasteRegister(buffer, true);
    case "P":
      return isVimVisualMode(buffer.mode)
        ? invalidInput(buffer, pendingSource(buffer) + value)
        : pasteRegister(buffer, false);
    case "u":
      return isVimVisualMode(buffer.mode)
        ? invalidInput(buffer, pendingSource(buffer) + value)
        : undo(buffer);
    case "v":
      return enterVisualMode(buffer, VimMode.VisualCharacter);
    case "V":
      return enterVisualMode(buffer, VimMode.VisualLine);
    case ":":
      return isVimVisualMode(buffer.mode)
        ? invalidInput(buffer, value)
        : {
            ...buffer,
            mode: { kind: "command", input: "" },
            selection: { kind: "none" },
            pending: { kind: "none" },
            status: { kind: "none" },
          };
    case "/":
    case "?":
      return {
        ...buffer,
        mode: {
          kind: "search",
          prompt: value,
          input: "",
          direction: value === "/" ? "forward" : "backward",
          context: commandContext(buffer),
        },
        pending: { kind: "none" },
        status: { kind: "none" },
      };
    case "n":
      return moveToSearchMatch(
        buffer,
        buffer.search.kind === "active" ? buffer.search.direction : "forward",
        commandContext(buffer),
      );
    case "N":
      return moveToSearchMatch(
        buffer,
        buffer.search.kind === "active" && buffer.search.direction === "backward"
          ? "forward"
          : "backward",
        commandContext(buffer),
      );
    case "q":
      return invalidInput(buffer, pendingSource(buffer) + value);
    case "i":
      return buffer.pending.kind === "operator" || isVimVisualMode(buffer.mode)
        ? beginTextObject(buffer, false, value)
        : enterInsertMode(buffer, buffer.cursor);
    case "a":
      return buffer.pending.kind === "operator" || isVimVisualMode(buffer.mode)
        ? beginTextObject(buffer, true, value)
        : insertAfterCursor(buffer);
    case "I":
      return isVimVisualMode(buffer.mode)
        ? invalidInput(buffer, value)
        : enterInsertMode(buffer, { line: buffer.cursor.line, column: 0 });
    case "A":
      return isVimVisualMode(buffer.mode)
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
    if (
      buffer.mode.kind === "insert" ||
      buffer.mode.kind === "command" ||
      buffer.mode.kind === "search" ||
      isVimVisualMode(buffer.mode)
    ) {
      return enterNormalMode(buffer);
    }

    if (buffer.pending.kind !== "none") {
      return resetPending(buffer);
    }

    const capability = gateVimCapability(buffer, { kind: "quit" });
    return capability.kind === "handled"
      ? capability.buffer
      : resetPending(buffer);
  }

  if (
    buffer.mode.kind === "insert" ||
    buffer.mode.kind === "command" ||
    buffer.mode.kind === "search"
  ) {
    return buffer;
  }

  const classification = normalKeyCapabilityClassification(buffer, key);
  const capability = gateVimCapability(buffer, classification);

  if (capability.kind === "handled") {
    return capability.buffer;
  }

  if (key.kind === "motion") {
    if (
      buffer.pending.kind !== "none" &&
      buffer.pending.kind !== "count" &&
      buffer.pending.kind !== "operator"
    ) {
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
      return isVimVisualMode(buffer.mode)
        ? invalidInput(buffer, pendingSource(buffer) + "Ctrl+r")
        : redo(buffer);
    case "enter-visual-character":
      return applyLiteral(buffer, "v");
    case "enter-visual-line":
      return applyLiteral(buffer, "V");
    case "enter-visual-block":
      return enterVisualMode(buffer, VimMode.VisualBlock);
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
    case "insert-key":
      return enterInsertMode(buffer, buffer.cursor);
    case "literal":
      return applyLiteral(buffer, key.value);
  }
}

export function appendVimCommandInput(
  buffer: VimBuffer,
  text: string,
): VimBuffer {
  if (
    (buffer.mode.kind !== "command" && buffer.mode.kind !== "search") ||
    text.length === 0
  ) {
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
  if (
    (buffer.mode.kind !== "command" && buffer.mode.kind !== "search") ||
    buffer.mode.input.length === 0
  ) {
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

export function replaceVimCommandInput(
  buffer: VimBuffer,
  input: string,
): VimBuffer {
  if (buffer.mode.kind !== "command" && buffer.mode.kind !== "search") {
    return buffer;
  }

  return {
    ...buffer,
    mode: { ...buffer.mode, input },
  };
}

type VimSubstitutionCommand = Readonly<{
  range: "current-line" | "whole-buffer";
  substitution: TextSubstitution;
}>;

type VimSubstitutionCommandParseResult =
  | Readonly<{ kind: "unrecognized" }>
  | Readonly<{ kind: "invalid"; message: string }>
  | Readonly<{ kind: "parsed"; command: VimSubstitutionCommand }>;

function parseVimSubstitutionCommand(
  buffer: VimBuffer,
  source: string,
): VimSubstitutionCommandParseResult {
  if (!source.startsWith("s") && !source.startsWith("%s")) {
    return { kind: "unrecognized" };
  }

  const previousPattern = buffer.search.kind === "active"
    ? buffer.search.query
    : undefined;
  const wholeBuffer = source.startsWith("%s");
  const substitution = parseTextSubstitution(
    wholeBuffer ? source.slice(1) : source,
    previousPattern,
  );

  return substitution.kind === "invalid"
    ? substitution
    : {
        kind: "parsed",
        command: {
          range: wholeBuffer ? "whole-buffer" : "current-line",
          substitution: substitution.substitution,
        },
      };
}

type VimSubstitutionEvaluation = Readonly<{
  lines: ReadonlyArray<string>;
  matched: boolean;
  firstChanged: VimPosition | undefined;
  ranges: ReadonlyArray<VimCommandPreviewRange>;
}>;

function evaluateVimSubstitution(
  buffer: VimBuffer,
  command: VimSubstitutionCommand,
): VimSubstitutionEvaluation {
  const lines = [...buffer.lines];
  const startLine = command.range === "whole-buffer" ? 0 : buffer.cursor.line;
  const endLine = command.range === "whole-buffer"
    ? buffer.lines.length - 1
    : buffer.cursor.line;
  const ranges: Array<VimCommandPreviewRange> = [];
  let lineOffset = lineStartOffset(buffer.lines, startLine);
  let matched = false;
  let firstChanged: VimPosition | undefined;

  for (let lineIndex = startLine; lineIndex <= endLine; lineIndex += 1) {
    const line = lines[lineIndex];

    if (line === undefined) {
      continue;
    }

    const result = applyTextSubstitution(line, command.substitution);
    matched = matched || result.matched;
    lines[lineIndex] = result.text;
    ranges.push(...result.ranges.map((range) => ({
      start: lineOffset + range.start,
      end: lineOffset + range.end,
      role: range.role,
    })));

    if (firstChanged === undefined && result.firstChangedOffset !== undefined) {
      firstChanged = { line: lineIndex, column: result.firstChangedOffset };
    }

    lineOffset += result.text.length + 1;
  }

  return { lines, matched, firstChanged, ranges };
}

function finishVimSubstitution(
  buffer: VimBuffer,
  status: VimStatus,
  search: VimSearch,
): VimBuffer {
  return {
    ...buffer,
    mode: VimMode.Normal,
    selection: { kind: "none" },
    search,
    commandEffect: { kind: "none" },
    pending: { kind: "none" },
    status,
    goalColumn: { kind: "none" },
  };
}

function executeVimSubstitution(
  buffer: VimBuffer,
  command: VimSubstitutionCommand,
): VimBuffer {
  const startLine = command.range === "whole-buffer" ? 0 : buffer.cursor.line;
  const endLine = command.range === "whole-buffer"
    ? buffer.lines.length - 1
    : buffer.cursor.line;
  const evaluation = evaluateVimSubstitution(buffer, command);

  const search: VimSearch = {
    kind: "active",
    query: command.substitution.pattern,
    direction: buffer.search.kind === "active" ? buffer.search.direction : "forward",
  };

  if (!evaluation.matched) {
    return finishVimSubstitution(
      buffer,
      { kind: "no-substitution-match", pattern: command.substitution.pattern },
      search,
    );
  }

  if (evaluation.firstChanged === undefined) {
    return finishVimSubstitution(buffer, { kind: "none" }, search);
  }

  const next = createTextState(
    evaluation.lines,
    evaluation.firstChanged,
    VimMode.Normal,
    { kind: "none" },
  );
  const committed = commitEdit(
    { ...buffer, mode: VimMode.Normal, selection: { kind: "none" } },
    next,
    buffer.register,
    lineEditIntervals(buffer, evaluation.lines, startLine, endLine),
  );

  return {
    ...committed,
    search,
    commandEffect: { kind: "none" },
  };
}

type VimSubstitutionSubmission =
  | Readonly<{ kind: "unrecognized" }>
  | Readonly<{ kind: "handled"; buffer: VimBuffer }>;

function submitVimSubstitution(
  buffer: VimBuffer,
  source: string,
): VimSubstitutionSubmission {
  const parsed = parseVimSubstitutionCommand(buffer, source);

  if (parsed.kind === "unrecognized") {
    return { kind: "unrecognized" };
  }

  if (parsed.kind === "invalid") {
    return {
      kind: "handled",
      buffer: finishVimSubstitution(
        buffer,
        { kind: "invalid-substitution", message: parsed.message },
        buffer.search,
      ),
    };
  }

  const capability = gateVimCapability(buffer, {
    kind: "text-mutation",
    source: ":" + source,
  });

  if (capability.kind === "handled") {
    return {
      kind: "handled",
      buffer: {
        ...capability.buffer,
        mode: VimMode.Normal,
        selection: { kind: "none" },
      },
    };
  }

  return { kind: "handled", buffer: executeVimSubstitution(buffer, parsed.command) };
}

export function vimCommandPreview(buffer: VimBuffer): VimCommandPreview {
  const source = vimBufferText(buffer);

  if (buffer.mode.kind === "search") {
    if (buffer.mode.input.length === 0) {
      return { source, ranges: [] };
    }

    const matches = searchMatches(source, buffer.mode.input);

    if (matches.kind === "invalid" || matches.values.length === 0) {
      return { source, ranges: [] };
    }

    const current = searchMatchForContext(
      matches.values,
      vimBufferCursorOffset(buffer),
      buffer.mode.direction,
      buffer.mode.context.count,
    );

    return {
      source,
      ranges: matches.values.flatMap((match) => match.start === match.end
        ? []
        : [{
            ...match,
            role: match === current ? "current-search" : "search",
          }]),
    };
  }

  if (buffer.mode.kind !== "command" || buffer.capability.kind === "read-only") {
    return { source, ranges: [] };
  }

  const parsed = parseVimSubstitutionCommand(buffer, buffer.mode.input);

  if (parsed.kind !== "parsed") {
    return { source, ranges: [] };
  }

  const evaluation = evaluateVimSubstitution(buffer, parsed.command);
  return evaluation.matched
    ? { source: joinLines(evaluation.lines), ranges: evaluation.ranges }
    : { source, ranges: [] };
}

export function parseVimCommand(source: string): VimCommandParseResult {
  switch (source.trim()) {
    case "w":
      return { kind: "recognized", command: { kind: "write" } };
    case "q":
      return { kind: "recognized", command: { kind: "quit" } };
    case "q!":
      return { kind: "recognized", command: { kind: "force-quit" } };
    case "history":
    case "history cmd":
      return {
        kind: "recognized",
        command: { kind: "show-history", history: "command" },
      };
    case "history search":
      return {
        kind: "recognized",
        command: { kind: "show-history", history: "search" },
      };
    case "messages":
      return { kind: "recognized", command: { kind: "show-messages" } };
    default:
      return { kind: "unrecognized", source };
  }
}

function writeCapabilityClassification(
  source: string,
): VimCapabilityOperation {
  switch (source.trim()) {
    case "w":
    case "w!":
    case "write":
    case "write!":
    case "wq":
    case "wq!":
    case "x":
    case "xit":
      return { kind: "write-effect", source: ":" + source };
    default:
      return { kind: "none" };
  }
}

export function submitVimCommand(buffer: VimBuffer): VimBuffer {
  if (buffer.mode.kind !== "command" && buffer.mode.kind !== "search") {
    return buffer;
  }

  if (buffer.mode.kind === "search") {
    const direction = buffer.mode.direction;
    const context = buffer.mode.context;

    if (buffer.mode.input.length === 0 && buffer.search.kind === "none") {
      return noPreviousSearchFailure(buffer, context);
    }

    const query = buffer.mode.input.length === 0 && buffer.search.kind === "active"
      ? buffer.search.query
      : buffer.mode.input;

    const matches = searchMatches(joinLines(buffer.lines), query);

    if (matches.kind === "invalid") {
      return searchFailure(buffer, query, "invalid-search", context);
    }

    if (context.kind === "operator") {
      const capability = gateVimCapability(
        buffer,
        operatorCapabilityOperation(context.operator, buffer.mode.prompt + query),
      );

      if (capability.kind === "handled") {
        return {
          ...capability.buffer,
          mode: VimMode.Normal,
          selection: { kind: "none" },
        };
      }
    }

    return moveToSearchMatch(
      {
        ...buffer,
        mode: context.kind === "visual-selection" ? context.mode : VimMode.Normal,
        selection: context.kind === "visual-selection"
          ? buffer.selection
          : { kind: "none" },
        search: { kind: "active", query, direction },
        pending: { kind: "none" },
      },
      direction,
      context,
    );
  }

  const substitution = submitVimSubstitution(buffer, buffer.mode.input);

  if (substitution.kind === "handled") {
    return substitution.buffer;
  }

  const parsed = parseVimCommand(buffer.mode.input);
  const classification = writeCapabilityClassification(buffer.mode.input);
  const capability = gateVimCapability(buffer, classification);

  if (capability.kind === "handled") {
    return {
      ...capability.buffer,
      mode: VimMode.Normal,
      selection: { kind: "none" },
    };
  }

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
      case "v":
        return { kind: "recognized", key: { kind: "enter-visual-block" } };
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
    case "Insert":
      return { kind: "recognized", key: { kind: "insert-key" } };
    default:
      return Array.from(key).length === 1
        ? { kind: "recognized", key: { kind: "literal", value: key } }
        : { kind: "unrecognized" };
  }
}
