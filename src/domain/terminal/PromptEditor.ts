import {
  backspacePromptBuffer,
  createEmptyPromptBuffer,
  createPromptBuffer,
  deletePromptBufferAtCursor,
  insertPromptText,
  replacePromptBuffer,
  type PromptBuffer,
  type PromptMode,
} from "./PromptBuffer.ts";

export type NormalPromptMotion =
  | "left"
  | "right"
  | "word-forward"
  | "word-backward"
  | "word-end"
  | "line-start"
  | "line-end";

export type NormalPromptOperator = "delete" | "change";

export type NormalPromptDigit = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export type NormalPromptKey =
  | Readonly<{
      kind: "digit";
      digit: NormalPromptDigit;
    }>
  | Readonly<{
      kind: "motion";
      motion: NormalPromptMotion;
    }>
  | Readonly<{
      kind: "operator";
      operator: NormalPromptOperator;
    }>
  | Readonly<{ kind: "delete-character" }>
  | Readonly<{ kind: "paste-after" }>
  | Readonly<{ kind: "paste-before" }>
  | Readonly<{ kind: "undo" }>
  | Readonly<{ kind: "redo" }>
  | Readonly<{ kind: "history-older" }>
  | Readonly<{ kind: "history-newer" }>
  | Readonly<{ kind: "insert-before" }>
  | Readonly<{ kind: "insert-after" }>
  | Readonly<{ kind: "insert-line-start" }>
  | Readonly<{ kind: "insert-line-end" }>
  | Readonly<{ kind: "escape" }>;

export type NormalPromptKeyMatch =
  | Readonly<{
      kind: "recognized";
      key: NormalPromptKey;
    }>
  | Readonly<{ kind: "unrecognized" }>;

type PromptCount =
  | Readonly<{ kind: "absent" }>
  | Readonly<{
      kind: "present";
      value: number;
    }>;

type NormalPromptPending =
  | Readonly<{ kind: "none" }>
  | Readonly<{
      kind: "count";
      count: number;
    }>
  | Readonly<{
      kind: "operator";
      operator: NormalPromptOperator;
      count: number;
      motionCount: PromptCount;
    }>;

export type PromptEditor = Readonly<{
  buffer: PromptBuffer;
  undoStack: ReadonlyArray<PromptBuffer>;
  redoStack: ReadonlyArray<PromptBuffer>;
  register: string;
  pending: NormalPromptPending;
}>;

export type CreatePromptEditorOptions = Readonly<{
  buffer: PromptBuffer;
  register: string;
}>;

type TextRange = Readonly<{
  start: number;
  end: number;
}>;

const wordCharacterPattern = /[\p{L}\p{N}_]/u;
const normalDigits = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

function createNormalBuffer(
  value: string,
  cursor: number,
): PromptBuffer {
  const safeCursor =
    value.length === 0
      ? 0
      : Math.max(0, Math.min(value.length - 1, cursor));

  return createPromptBuffer({
    value,
    cursor: safeCursor,
    mode: { kind: "normal" },
  });
}

function createInsertBuffer(
  value: string,
  cursor: number,
): PromptBuffer {
  return createPromptBuffer({
    value,
    cursor: Math.max(0, Math.min(value.length, cursor)),
    mode: { kind: "insert" },
  });
}

function sameBuffer(left: PromptBuffer, right: PromptBuffer): boolean {
  return (
    left.value === right.value &&
    left.cursor === right.cursor &&
    left.mode.kind === right.mode.kind
  );
}

function withPending(
  editor: PromptEditor,
  pending: NormalPromptPending,
): PromptEditor {
  return { ...editor, pending };
}

function withBuffer(
  editor: PromptEditor,
  buffer: PromptBuffer,
): PromptEditor {
  return { ...editor, buffer, pending: { kind: "none" } };
}

function commitEdit(
  editor: PromptEditor,
  buffer: PromptBuffer,
  register: string,
): PromptEditor {
  if (sameBuffer(editor.buffer, buffer) && editor.register === register) {
    return withPending(editor, { kind: "none" });
  }

  return {
    buffer,
    undoStack: [...editor.undoStack, editor.buffer],
    redoStack: [],
    register,
    pending: { kind: "none" },
  };
}

function resetPending(editor: PromptEditor): PromptEditor {
  return withPending(editor, { kind: "none" });
}

function pendingCount(pending: NormalPromptPending): number {
  if (pending.kind === "count") {
    return pending.count;
  }

  return 1;
}

function capCount(count: number, valueLength: number): number {
  return Math.max(1, Math.min(count, valueLength + 1));
}

function appendCount(
  existing: PromptCount,
  digit: NormalPromptDigit,
): PromptCount {
  const value =
    existing.kind === "present" ? existing.value * 10 + digit : digit;

  return {
    kind: "present",
    value: Math.min(value, Number.MAX_SAFE_INTEGER),
  };
}

function appendNormalCount(
  editor: PromptEditor,
  digit: NormalPromptDigit,
): PromptEditor {
  if (editor.pending.kind === "operator") {
    return withPending(editor, {
      ...editor.pending,
      motionCount: appendCount(editor.pending.motionCount, digit),
    });
  }

  if (editor.pending.kind === "count") {
    return withPending(editor, {
      kind: "count",
      count: Math.min(
        editor.pending.count * 10 + digit,
        Number.MAX_SAFE_INTEGER,
      ),
    });
  }

  return withPending(editor, { kind: "count", count: digit });
}

function characterAt(value: string, position: number): string {
  return value[position] ?? "";
}

function isWordCharacter(character: string): boolean {
  return wordCharacterPattern.test(character);
}

function wordForward(value: string, cursor: number, count: number): number {
  let position = cursor;
  const repetitions = capCount(count, value.length);

  for (let repetition = 0; repetition < repetitions; repetition += 1) {
    while (position < value.length && isWordCharacter(characterAt(value, position))) {
      position += 1;
    }

    while (
      position < value.length &&
      !isWordCharacter(characterAt(value, position))
    ) {
      position += 1;
    }
  }

  return Math.min(value.length, position);
}

function wordBackward(value: string, cursor: number, count: number): number {
  let position = Math.min(cursor, Math.max(0, value.length - 1));
  const repetitions = capCount(count, value.length);

  for (let repetition = 0; repetition < repetitions; repetition += 1) {
    if (position === 0) {
      return 0;
    }

    position -= 1;

    while (position > 0 && !isWordCharacter(characterAt(value, position))) {
      position -= 1;
    }

    while (position > 0 && isWordCharacter(characterAt(value, position - 1))) {
      position -= 1;
    }
  }

  return position;
}

function wordEnd(value: string, cursor: number, count: number): number {
  if (value.length === 0) {
    return 0;
  }

  let position = Math.min(cursor, value.length - 1);
  const repetitions = capCount(count, value.length);

  for (let repetition = 0; repetition < repetitions; repetition += 1) {
    while (
      position < value.length - 1 &&
      !isWordCharacter(characterAt(value, position))
    ) {
      position += 1;
    }

    while (
      position < value.length - 1 &&
      isWordCharacter(characterAt(value, position + 1))
    ) {
      position += 1;
    }

    if (repetition < repetitions - 1 && position < value.length - 1) {
      position += 1;
    }
  }

  return position;
}

function moveCursorForMotion(
  buffer: PromptBuffer,
  motion: NormalPromptMotion,
  count: number,
): PromptBuffer {
  const safeCount = capCount(count, buffer.value.length);
  const cursor = buffer.cursor;
  const value = buffer.value;

  switch (motion) {
    case "left":
      return createNormalBuffer(value, cursor - safeCount);
    case "right":
      return createNormalBuffer(value, cursor + safeCount);
    case "word-forward":
      return createNormalBuffer(value, wordForward(value, cursor, safeCount));
    case "word-backward":
      return createNormalBuffer(value, wordBackward(value, cursor, safeCount));
    case "word-end":
      return createNormalBuffer(value, wordEnd(value, cursor, safeCount));
    case "line-start":
      return createNormalBuffer(value, 0);
    case "line-end":
      return createNormalBuffer(value, value.length - 1);
  }
}

function rangeForMotion(
  buffer: PromptBuffer,
  motion: NormalPromptMotion,
  count: number,
): TextRange {
  const value = buffer.value;
  const cursor = buffer.cursor;
  const safeCount = capCount(count, value.length);

  switch (motion) {
    case "left":
      return { start: Math.max(0, cursor - safeCount), end: cursor };
    case "right":
      return { start: cursor, end: Math.min(value.length, cursor + safeCount) };
    case "word-forward":
      return { start: cursor, end: wordForward(value, cursor, safeCount) };
    case "word-backward":
      return {
        start: wordBackward(value, cursor, safeCount),
        end: cursor,
      };
    case "word-end":
      return {
        start: cursor,
        end: Math.min(value.length, wordEnd(value, cursor, safeCount) + 1),
      };
    case "line-start":
      return { start: 0, end: cursor };
    case "line-end":
      return { start: cursor, end: value.length };
  }
}

function deleteRange(
  editor: PromptEditor,
  range: TextRange,
  enterInsertMode: boolean,
): PromptEditor {
  const start = Math.max(0, Math.min(editor.buffer.value.length, range.start));
  const end = Math.max(start, Math.min(editor.buffer.value.length, range.end));
  const deleted = editor.buffer.value.slice(start, end);
  const value =
    editor.buffer.value.slice(0, start) + editor.buffer.value.slice(end);
  const buffer = enterInsertMode
    ? createInsertBuffer(value, start)
    : createNormalBuffer(value, start);

  if (deleted.length === 0) {
    return withBuffer(editor, buffer);
  }

  return commitEdit(editor, buffer, deleted);
}

function applyOperatorMotion(
  editor: PromptEditor,
  operator: NormalPromptOperator,
  count: number,
  motion: NormalPromptMotion,
): PromptEditor {
  return deleteRange(
    editor,
    rangeForMotion(editor.buffer, motion, count),
    operator === "change",
  );
}

function applyWholeLineOperator(
  editor: PromptEditor,
  operator: NormalPromptOperator,
): PromptEditor {
  return deleteRange(
    editor,
    { start: 0, end: editor.buffer.value.length },
    operator === "change",
  );
}

function enterInsertMode(
  editor: PromptEditor,
  cursor: number,
): PromptEditor {
  return withBuffer(editor, createInsertBuffer(editor.buffer.value, cursor));
}

function enterNormalMode(editor: PromptEditor): PromptEditor {
  return withBuffer(
    editor,
    createNormalBuffer(editor.buffer.value, editor.buffer.cursor),
  );
}

function undoPromptEdit(editor: PromptEditor): PromptEditor {
  const previous = editor.undoStack.at(-1);

  if (!previous) {
    return resetPending(editor);
  }

  return {
    buffer: previous,
    undoStack: editor.undoStack.slice(0, -1),
    redoStack: [editor.buffer, ...editor.redoStack],
    register: editor.register,
    pending: { kind: "none" },
  };
}

function redoPromptEdit(editor: PromptEditor): PromptEditor {
  const next = editor.redoStack[0];

  if (!next) {
    return resetPending(editor);
  }

  return {
    buffer: next,
    undoStack: [...editor.undoStack, editor.buffer],
    redoStack: editor.redoStack.slice(1),
    register: editor.register,
    pending: { kind: "none" },
  };
}

function pasteRegister(
  editor: PromptEditor,
  afterCursor: boolean,
): PromptEditor {
  if (editor.register.length === 0) {
    return resetPending(editor);
  }

  const insertionPoint = afterCursor
    ? Math.min(editor.buffer.value.length, editor.buffer.cursor + 1)
    : editor.buffer.cursor;
  const value =
    editor.buffer.value.slice(0, insertionPoint) +
    editor.register +
    editor.buffer.value.slice(insertionPoint);
  const buffer = createNormalBuffer(
    value,
    insertionPoint + editor.register.length - 1,
  );

  return commitEdit(editor, buffer, editor.register);
}

function handleOperator(
  editor: PromptEditor,
  operator: NormalPromptOperator,
): PromptEditor {
  if (editor.pending.kind === "operator") {
    if (editor.pending.operator === operator) {
      return applyWholeLineOperator(editor, operator);
    }

    return withPending(editor, {
      kind: "operator",
      operator,
      count: editor.pending.count,
      motionCount: { kind: "absent" },
    });
  }

  return withPending(editor, {
    kind: "operator",
    operator,
    count: pendingCount(editor.pending),
    motionCount: { kind: "absent" },
  });
}

function handleMotion(
  editor: PromptEditor,
  motion: NormalPromptMotion,
): PromptEditor {
  if (editor.pending.kind === "operator") {
    const motionCount =
      editor.pending.motionCount.kind === "present"
        ? editor.pending.motionCount.value
        : 1;
    const count = Math.min(
      editor.pending.count * motionCount,
      Number.MAX_SAFE_INTEGER,
    );

    return applyOperatorMotion(editor, editor.pending.operator, count, motion);
  }

  return withBuffer(
    editor,
    moveCursorForMotion(editor.buffer, motion, pendingCount(editor.pending)),
  );
}

function deleteCharacters(editor: PromptEditor): PromptEditor {
  return deleteRange(
    editor,
    {
      start: editor.buffer.cursor,
      end: editor.buffer.cursor + pendingCount(editor.pending),
    },
    false,
  );
}

function isLineStartKey(editor: PromptEditor, key: NormalPromptKey): boolean {
  if (key.kind !== "digit" || key.digit !== 0) {
    return false;
  }

  if (editor.pending.kind === "none") {
    return true;
  }

  return (
    editor.pending.kind === "operator" &&
    editor.pending.motionCount.kind === "absent"
  );
}

export function createPromptEditor({
  buffer,
  register,
}: CreatePromptEditorOptions): PromptEditor {
  return {
    buffer,
    undoStack: [],
    redoStack: [],
    register,
    pending: { kind: "none" },
  };
}

export function createEmptyPromptEditor(): PromptEditor {
  return createPromptEditor({ buffer: createEmptyPromptBuffer(), register: "" });
}

export function createPromptEditorForHistory(
  value: string,
  mode: PromptMode,
  register: string,
): PromptEditor {
  const cursor = mode.kind === "normal" ? value.length - 1 : value.length;

  return createPromptEditor({
    buffer:
      mode.kind === "normal"
        ? createNormalBuffer(value, cursor)
        : createInsertBuffer(value, cursor),
    register,
  });
}

export function replacePromptEditorValue(
  editor: PromptEditor,
  value: string,
  cursor: number,
): PromptEditor {
  return commitEdit(editor, replacePromptBuffer(editor.buffer, value, cursor), editor.register);
}

export function insertPromptEditorText(
  editor: PromptEditor,
  text: string,
): PromptEditor {
  return commitEdit(editor, insertPromptText(editor.buffer, text), editor.register);
}

export function backspacePromptEditor(editor: PromptEditor): PromptEditor {
  return commitEdit(
    editor,
    backspacePromptBuffer(editor.buffer),
    editor.register,
  );
}

export function deletePromptEditorAtCursor(
  editor: PromptEditor,
): PromptEditor {
  return commitEdit(
    editor,
    deletePromptBufferAtCursor(editor.buffer),
    editor.register,
  );
}

export function movePromptEditorCursor(
  editor: PromptEditor,
  cursor: number,
): PromptEditor {
  const buffer =
    editor.buffer.mode.kind === "normal"
      ? createNormalBuffer(editor.buffer.value, cursor)
      : createInsertBuffer(editor.buffer.value, cursor);

  return withBuffer(editor, buffer);
}

export function applyNormalPromptKey(
  editor: PromptEditor,
  key: NormalPromptKey,
): PromptEditor {
  if (isLineStartKey(editor, key)) {
    return handleMotion(editor, "line-start");
  }

  switch (key.kind) {
    case "digit":
      return appendNormalCount(editor, key.digit);
    case "motion":
      return handleMotion(editor, key.motion);
    case "operator":
      return handleOperator(editor, key.operator);
    case "delete-character":
      return deleteCharacters(editor);
    case "paste-after":
      return pasteRegister(editor, true);
    case "paste-before":
      return pasteRegister(editor, false);
    case "undo":
      return undoPromptEdit(editor);
    case "redo":
      return redoPromptEdit(editor);
    case "history-older":
    case "history-newer":
      return resetPending(editor);
    case "insert-before":
      return enterInsertMode(editor, editor.buffer.cursor);
    case "insert-after":
      return enterInsertMode(editor, editor.buffer.cursor + 1);
    case "insert-line-start":
      return enterInsertMode(editor, 0);
    case "insert-line-end":
      return enterInsertMode(editor, editor.buffer.value.length);
    case "escape":
      return enterNormalMode(editor);
  }
}

export function normalPromptKeyFromKeyboard(
  key: string,
  ctrlKey: boolean,
  metaKey: boolean,
): NormalPromptKeyMatch {
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
    case "$":
    case "End":
      return {
        kind: "recognized",
        key: { kind: "motion", motion: "line-end" },
      };
    case "Home":
      return {
        kind: "recognized",
        key: { kind: "motion", motion: "line-start" },
      };
    case "d":
      return { kind: "recognized", key: { kind: "operator", operator: "delete" } };
    case "c":
      return { kind: "recognized", key: { kind: "operator", operator: "change" } };
    case "x":
      return { kind: "recognized", key: { kind: "delete-character" } };
    case "p":
      return { kind: "recognized", key: { kind: "paste-after" } };
    case "P":
      return { kind: "recognized", key: { kind: "paste-before" } };
    case "u":
      return { kind: "recognized", key: { kind: "undo" } };
    case "j":
      return { kind: "recognized", key: { kind: "history-newer" } };
    case "k":
      return { kind: "recognized", key: { kind: "history-older" } };
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
