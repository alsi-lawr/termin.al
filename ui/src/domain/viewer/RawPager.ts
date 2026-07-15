export const RAW_PAGER_DEFAULT_PAGE_SIZE = 20;

const rawPagerStateData: unique symbol = Symbol("rawPagerStateData");

type RawPagerStateData = Readonly<{
  lineOffset: number;
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
      totalLines: number;
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
  requestedOffset: number,
): RawPagerState {
  const data = state[rawPagerStateData];
  const lineOffset = Math.min(
    rawPagerMaximumOffset(data),
    Math.max(0, requestedOffset),
  );

  return lineOffset === data.lineOffset
    ? state
    : {
        [rawPagerStateData]: {
          ...data,
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
        state: moveRawPager(state, data.lineOffset - 1),
      };
    case "line-down":
      return {
        kind: "updated",
        state: moveRawPager(state, data.lineOffset + 1),
      };
    case "page-back":
      return {
        kind: "updated",
        state: moveRawPager(state, data.lineOffset - data.pageSize),
      };
    case "page-forward":
      return {
        kind: "updated",
        state: moveRawPager(state, data.lineOffset + data.pageSize),
      };
    case "start":
      return {
        kind: "updated",
        state: moveRawPager(state, 0),
      };
    case "end":
      return {
        kind: "updated",
        state: moveRawPager(state, rawPagerMaximumOffset(data)),
      };
    case "quit":
      return { kind: "quit" };
  }
}

export function rawPagerOperationFromKey(
  input: RawPagerKeyInput,
): RawPagerKeyResult {
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
    totalLines: data.lineCount,
  };
}

export function rawPagerPageText(
  text: string,
  state: RawPagerState,
): string {
  const data = state[rawPagerStateData];

  return rawPagerLineChunks(text)
    .slice(data.lineOffset, data.lineOffset + data.pageSize)
    .join("");
}
