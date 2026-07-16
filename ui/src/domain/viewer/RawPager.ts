export const RAW_PAGER_DEFAULT_PAGE_SIZE = 20;

const rawPagerStateData: unique symbol = Symbol("rawPagerStateData");

type RawPagerStateData = Readonly<{
  lineOffset: number;
  currentLineIndex: number;
  pageSize: number;
  lineCount: number;
}>;

export type RawPagerState = Readonly<{
  [rawPagerStateData]: RawPagerStateData;
}>;

export type RawPagerStatus =
  | Readonly<{ kind: "empty" }>
  | Readonly<{
      kind: "range";
      firstLine: number;
      lastLine: number;
      currentLine: number;
      totalLines: number;
    }>;

export type RawPagerPageLine = Readonly<{
  lineNumber: number;
  text: string;
  isCurrent: boolean;
}>;

export type RawPagerOperation =
  | Readonly<{ kind: "line-up" }>
  | Readonly<{ kind: "line-down" }>
  | Readonly<{ kind: "page-back" }>
  | Readonly<{ kind: "page-forward" }>
  | Readonly<{ kind: "start" }>
  | Readonly<{ kind: "end" }>
  | Readonly<{ kind: "quit" }>;

export type RawPagerKeyInput = Readonly<{
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}>;

export type RawPagerKeyResult =
  | Readonly<{ kind: "ignored" }>
  | Readonly<{ kind: "operation"; operation: RawPagerOperation }>;

export type RawPagerTransition =
  | Readonly<{ kind: "updated"; state: RawPagerState }>
  | Readonly<{ kind: "quit" }>;

function rawPagerLineChunks(text: string): ReadonlyArray<string> {
  if (text.length === 0) {
    return [];
  }

  const lines: Array<string> = [];
  let lineStart = 0;

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") {
      lines.push(text.slice(lineStart, index + 1));
      lineStart = index + 1;
    }
  }

  if (lineStart < text.length) {
    lines.push(text.slice(lineStart));
  }

  return lines;
}

export function createRawPagerState(
  text: string,
  maximumPageSize = RAW_PAGER_DEFAULT_PAGE_SIZE,
): RawPagerState {
  if (!Number.isInteger(maximumPageSize) || maximumPageSize <= 0) {
    throw new RangeError("Raw pager page size must be a positive integer.");
  }

  const lineCount = rawPagerLineChunks(text).length;
  const pageSize = Math.min(maximumPageSize, lineCount);

  return {
    [rawPagerStateData]: {
      lineOffset: 0,
      currentLineIndex: 0,
      pageSize,
      lineCount,
    },
  };
}

function rawPagerMaximumOffset(data: RawPagerStateData): number {
  return Math.max(0, data.lineCount - data.pageSize);
}

function moveRawPager(
  state: RawPagerState,
  requestedCurrentLineIndex: number,
): RawPagerState {
  const data = state[rawPagerStateData];
  const currentLineIndex = Math.min(
    Math.max(0, data.lineCount - 1),
    Math.max(0, requestedCurrentLineIndex),
  );
  const lineOffset = currentLineIndex < data.lineOffset
    ? currentLineIndex
    : Math.min(
        rawPagerMaximumOffset(data),
        Math.max(data.lineOffset, currentLineIndex - data.pageSize + 1),
      );

  return lineOffset === data.lineOffset &&
      currentLineIndex === data.currentLineIndex
    ? state
    : {
        [rawPagerStateData]: {
          ...data,
          lineOffset,
          currentLineIndex,
        },
      };
}

function moveRawPagerPage(
  state: RawPagerState,
  direction: -1 | 1,
): RawPagerState {
  const data = state[rawPagerStateData];
  const moved = moveRawPager(
    state,
    data.currentLineIndex + direction * data.pageSize,
  );
  const movedData = moved[rawPagerStateData];
  const lineOffset = Math.min(
    rawPagerMaximumOffset(data),
    Math.max(0, data.lineOffset + direction * data.pageSize),
  );

  return lineOffset === movedData.lineOffset
    ? moved
    : {
        [rawPagerStateData]: {
          ...movedData,
          lineOffset,
        },
      };
}

export function applyRawPagerOperation(
  state: RawPagerState,
  operation: RawPagerOperation,
): RawPagerTransition {
  const data = state[rawPagerStateData];

  switch (operation.kind) {
    case "line-up":
      return {
        kind: "updated",
        state: moveRawPager(state, data.currentLineIndex - 1),
      };
    case "line-down":
      return {
        kind: "updated",
        state: moveRawPager(state, data.currentLineIndex + 1),
      };
    case "page-back":
      return {
        kind: "updated",
        state: moveRawPagerPage(state, -1),
      };
    case "page-forward":
      return {
        kind: "updated",
        state: moveRawPagerPage(state, 1),
      };
    case "start":
      return {
        kind: "updated",
        state: moveRawPager(state, 0),
      };
    case "end":
      return {
        kind: "updated",
        state: moveRawPager(state, data.lineCount - 1),
      };
    case "quit":
      return { kind: "quit" };
  }
}

export function rawPagerOperationFromKey(
  input: RawPagerKeyInput,
): RawPagerKeyResult {
  if (input.ctrlKey && !input.altKey && !input.metaKey && input.key === "f") {
    return { kind: "operation", operation: { kind: "page-forward" } };
  }

  if (input.altKey || input.ctrlKey || input.metaKey) {
    return { kind: "ignored" };
  }

  switch (input.key) {
    case "ArrowUp":
    case "k":
      return { kind: "operation", operation: { kind: "line-up" } };
    case "ArrowDown":
    case "j":
      return { kind: "operation", operation: { kind: "line-down" } };
    case "PageDown":
    case " ":
      return { kind: "operation", operation: { kind: "page-forward" } };
    case "PageUp":
    case "b":
      return { kind: "operation", operation: { kind: "page-back" } };
    case "g":
      return { kind: "operation", operation: { kind: "start" } };
    case "G":
      return { kind: "operation", operation: { kind: "end" } };
    case "Escape":
    case "q":
      return { kind: "operation", operation: { kind: "quit" } };
    default:
      return { kind: "ignored" };
  }
}

export function rawPagerStatus(state: RawPagerState): RawPagerStatus {
  const data = state[rawPagerStateData];

  if (data.lineCount === 0) {
    return { kind: "empty" };
  }

  return {
    kind: "range",
    firstLine: data.lineOffset + 1,
    lastLine: Math.min(data.lineOffset + data.pageSize, data.lineCount),
    currentLine: data.currentLineIndex + 1,
    totalLines: data.lineCount,
  };
}

export function rawPagerPageLines(
  text: string,
  state: RawPagerState,
): ReadonlyArray<RawPagerPageLine> {
  const data = state[rawPagerStateData];

  return rawPagerLineChunks(text)
    .slice(data.lineOffset, data.lineOffset + data.pageSize)
    .map((line, index) => {
      const lineIndex = data.lineOffset + index;

      return {
        lineNumber: lineIndex + 1,
        text: line,
        isCurrent: lineIndex === data.currentLineIndex,
      };
    });
}
