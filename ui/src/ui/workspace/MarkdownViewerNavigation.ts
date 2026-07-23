export type MarkdownViewerOperation =
  | Readonly<{ kind: "line-up" }>
  | Readonly<{ kind: "line-down" }>
  | Readonly<{ kind: "page-up" }>
  | Readonly<{ kind: "page-down" }>
  | Readonly<{ kind: "top" }>
  | Readonly<{ kind: "bottom" }>
  | Readonly<{ kind: "search" }>
  | Readonly<{ kind: "search-next" }>
  | Readonly<{ kind: "search-previous" }>;

const markdownViewerPositionData: unique symbol = Symbol(
  "markdownViewerPositionData",
);

type MarkdownViewerPositionData = Readonly<{
  blockIndex: number;
  blockCount: number;
}>;

export type MarkdownViewerPosition = Readonly<{
  [markdownViewerPositionData]: MarkdownViewerPositionData;
}>;

export type MarkdownViewerPositionStatus =
  | Readonly<{ kind: "empty" }>
  | Readonly<{
      kind: "block";
      currentBlock: number;
      totalBlocks: number;
    }>;

export type MarkdownViewerMotion = Extract<
  MarkdownViewerOperation,
  Readonly<{
    kind: "line-up" | "line-down" | "page-up" | "page-down" | "top" | "bottom";
  }>
>;

export type MarkdownViewerKeyInput = Readonly<{
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
}>;

export type MarkdownViewerKeyResult =
  | Readonly<{
      kind: "handled";
      operation: MarkdownViewerOperation;
    }>
  | Readonly<{ kind: "ignored" }>;

export function createMarkdownViewerPosition(
  blockCount: number,
): MarkdownViewerPosition {
  if (!Number.isInteger(blockCount) || blockCount < 0) {
    throw new RangeError("Markdown block count must be a non-negative integer.");
  }

  return {
    [markdownViewerPositionData]: {
      blockIndex: 0,
      blockCount,
    },
  };
}

export function moveMarkdownViewerPosition(
  position: MarkdownViewerPosition,
  motion: MarkdownViewerMotion,
  pageBlockCount: number,
): MarkdownViewerPosition {
  if (!Number.isInteger(pageBlockCount) || pageBlockCount <= 0) {
    throw new RangeError("Markdown page block count must be a positive integer.");
  }

  const data = position[markdownViewerPositionData];
  const maximumBlockIndex = Math.max(0, data.blockCount - 1);
  const requestedBlockIndex = (() => {
    switch (motion.kind) {
      case "line-up":
        return data.blockIndex - 1;
      case "line-down":
        return data.blockIndex + 1;
      case "page-up":
        return data.blockIndex - pageBlockCount;
      case "page-down":
        return data.blockIndex + pageBlockCount;
      case "top":
        return 0;
      case "bottom":
        return maximumBlockIndex;
    }
  })();
  const blockIndex = Math.min(
    maximumBlockIndex,
    Math.max(0, requestedBlockIndex),
  );

  return blockIndex === data.blockIndex
    ? position
    : {
        [markdownViewerPositionData]: {
          ...data,
          blockIndex,
        },
      };
}

export function setMarkdownViewerPosition(
  position: MarkdownViewerPosition,
  blockIndex: number,
): MarkdownViewerPosition {
  if (!Number.isInteger(blockIndex)) {
    throw new RangeError("Markdown block index must be an integer.");
  }

  const data = position[markdownViewerPositionData];
  const maximumBlockIndex = Math.max(0, data.blockCount - 1);
  const nextBlockIndex = Math.min(maximumBlockIndex, Math.max(0, blockIndex));

  return nextBlockIndex === data.blockIndex
    ? position
    : {
        [markdownViewerPositionData]: {
          ...data,
          blockIndex: nextBlockIndex,
        },
      };
}

export function markdownViewerPositionStatus(
  position: MarkdownViewerPosition,
): MarkdownViewerPositionStatus {
  const data = position[markdownViewerPositionData];

  return data.blockCount === 0
    ? { kind: "empty" }
    : {
        kind: "block",
        currentBlock: data.blockIndex + 1,
        totalBlocks: data.blockCount,
      };
}

export function markdownViewerOperationFromKey(
  input: MarkdownViewerKeyInput,
): MarkdownViewerKeyResult {
  if (input.metaKey) {
    return { kind: "ignored" };
  }

  if (input.ctrlKey) {
    switch (input.key) {
      case "d":
        return { kind: "handled", operation: { kind: "page-down" } };
      case "f":
        return { kind: "handled", operation: { kind: "page-down" } };
      case "u":
        return { kind: "handled", operation: { kind: "page-up" } };
      default:
        return { kind: "ignored" };
    }
  }

  switch (input.key) {
    case "ArrowUp":
    case "k":
      return { kind: "handled", operation: { kind: "line-up" } };
    case "ArrowDown":
    case "j":
      return { kind: "handled", operation: { kind: "line-down" } };
    case "PageUp":
    case "b":
      return { kind: "handled", operation: { kind: "page-up" } };
    case "PageDown":
    case " ":
      return { kind: "handled", operation: { kind: "page-down" } };
    case "G":
      return { kind: "handled", operation: { kind: "bottom" } };
    case "/":
      return { kind: "handled", operation: { kind: "search" } };
    case "n":
      return { kind: "handled", operation: { kind: "search-next" } };
    case "N":
      return { kind: "handled", operation: { kind: "search-previous" } };
    default:
      return { kind: "ignored" };
  }
}
