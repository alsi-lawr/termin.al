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
    case "g":
      return { kind: "handled", operation: { kind: "top" } };
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
