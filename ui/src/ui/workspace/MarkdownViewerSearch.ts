export type MarkdownViewerSearch =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "editing"; query: string }>
  | Readonly<{
      kind: "active";
      query: string;
      matchIndex: number;
    }>;

export type MarkdownViewerSearchTransition = Readonly<{
  search: MarkdownViewerSearch;
  matchedBlockIndex: number | undefined;
}>;

export type MarkdownViewerSearchStatus = Readonly<{
  mode: "NORMAL" | "SEARCH";
  match: string;
}>;

export type MarkdownViewerSearchInputKeyResult =
  | Readonly<{ kind: "cancel" }>
  | Readonly<{ kind: "unhandled" }>;

export function createMarkdownViewerSearch(): MarkdownViewerSearch {
  return { kind: "idle" };
}

export function beginMarkdownViewerSearch(): MarkdownViewerSearch {
  return { kind: "editing", query: "" };
}

export function updateMarkdownViewerSearch(
  query: string,
): MarkdownViewerSearch {
  return { kind: "editing", query };
}

export function markdownViewerSearchInputOperationFromKey(
  key: string,
): MarkdownViewerSearchInputKeyResult {
  return key === "Escape" ? { kind: "cancel" } : { kind: "unhandled" };
}

export function submitMarkdownViewerSearch(
  search: MarkdownViewerSearch,
  matches: ReadonlyArray<number>,
): MarkdownViewerSearchTransition {
  if (search.kind !== "editing") {
    return { search, matchedBlockIndex: undefined };
  }

  const query = search.query.trim();

  return query === ""
    ? { search: createMarkdownViewerSearch(), matchedBlockIndex: undefined }
    : {
        search: { kind: "active", query, matchIndex: 0 },
        matchedBlockIndex: matches[0],
      };
}

export function cycleMarkdownViewerSearch(
  search: MarkdownViewerSearch,
  matches: ReadonlyArray<number>,
  direction: -1 | 1,
): MarkdownViewerSearchTransition {
  if (search.kind !== "active" || matches.length === 0) {
    return { search, matchedBlockIndex: undefined };
  }

  const matchIndex =
    (search.matchIndex + direction + matches.length) % matches.length;

  return {
    search: { ...search, matchIndex },
    matchedBlockIndex: matches[matchIndex],
  };
}

export function markdownViewerSearchStatus(
  search: MarkdownViewerSearch,
  matchCount: number,
): MarkdownViewerSearchStatus {
  switch (search.kind) {
    case "idle":
      return { mode: "NORMAL", match: "No search" };
    case "editing":
      return { mode: "SEARCH", match: "Enter search" };
    case "active":
      return {
        mode: "SEARCH",
        match: matchCount === 0
          ? `No matches for ${search.query}`
          : `/${search.query} ${search.matchIndex + 1}/${matchCount}`,
      };
  }
}
