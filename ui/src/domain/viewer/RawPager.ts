export const RAW_PAGER_DEFAULT_PAGE_SIZE = 20;

export type RawPagerBounds = Readonly<{
  firstOffset: 0;
  lastOffset: number;
  lineCount: number;
}>;

export type RawPagerState = Readonly<{
  lineOffset: number;
  pageSize: number;
  bounds: RawPagerBounds;
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
    lineOffset: 0,
    pageSize,
    bounds: {
      firstOffset: 0,
      lastOffset: Math.max(0, lineCount - pageSize),
      lineCount,
    },
  };
}

function moveRawPager(
  state: RawPagerState,
  requestedOffset: number,
): RawPagerState {
  const lineOffset = Math.min(
    state.bounds.lastOffset,
    Math.max(state.bounds.firstOffset, requestedOffset),
  );

  return lineOffset === state.lineOffset
    ? state
    : { ...state, lineOffset };
}

export function applyRawPagerOperation(
  state: RawPagerState,
  operation: RawPagerOperation,
): RawPagerTransition {
  switch (operation.kind) {
    case "line-up":
      return {
        kind: "updated",
        state: moveRawPager(state, state.lineOffset - 1),
      };
    case "line-down":
      return {
        kind: "updated",
        state: moveRawPager(state, state.lineOffset + 1),
      };
    case "page-back":
      return {
        kind: "updated",
        state: moveRawPager(state, state.lineOffset - state.pageSize),
      };
    case "page-forward":
      return {
        kind: "updated",
        state: moveRawPager(state, state.lineOffset + state.pageSize),
      };
    case "start":
      return {
        kind: "updated",
        state: moveRawPager(state, state.bounds.firstOffset),
      };
    case "end":
      return {
        kind: "updated",
        state: moveRawPager(state, state.bounds.lastOffset),
      };
    case "quit":
      return { kind: "quit" };
  }
}

export function rawPagerStatus(state: RawPagerState): RawPagerStatus {
  if (state.bounds.lineCount === 0) {
    return { kind: "empty" };
  }

  return {
    kind: "range",
    firstLine: state.lineOffset + 1,
    lastLine: Math.min(
      state.lineOffset + state.pageSize,
      state.bounds.lineCount,
    ),
    totalLines: state.bounds.lineCount,
  };
}

export function rawPagerPageText(
  text: string,
  state: RawPagerState,
): string {
  return rawPagerLineChunks(text)
    .slice(state.lineOffset, state.lineOffset + state.pageSize)
    .join("");
}
