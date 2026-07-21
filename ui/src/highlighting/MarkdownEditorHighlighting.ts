import { fenceLanguageKey, highlightFenceCode } from "./FenceHighlighting.ts";
import type { HighlightingAssetLoader } from "./HighlightingAssetLoader.ts";
import { maximumHighlightedCodeUnits, normalizedHighlightRanges, type HighlightCandidate, type HighlightRange } from "./HighlightingTokens.ts";
import { isMarkdownFenceClosing, markdownFenceOpening } from "../content/MarkdownFence.ts";

export type CompletedMarkdownEditorHighlight = Readonly<{
  source: string;
  ranges: ReadonlyArray<HighlightRange>;
}>;

type SourceLine = Readonly<{
  start: number;
  contentEnd: number;
  end: number;
}>;

type FencedSource = Readonly<{
  language: string;
  start: number;
  end: number;
}>;

function sourceLines(source: string): ReadonlyArray<SourceLine> {
  const lines: Array<SourceLine> = [];
  let start = 0;
  while (start < source.length) {
    const newline = source.indexOf("\n", start);
    const end = newline === -1 ? source.length : newline + 1;
    const contentEnd = newline === -1
      ? source.length
      : newline > start && source[newline - 1] === "\r"
        ? newline - 1
        : newline;
    lines.push({ start, contentEnd, end });
    start = end;
  }
  return lines;
}

function fencedSources(source: string): ReadonlyArray<FencedSource> {
  const lines = sourceLines(source);
  const fences: Array<FencedSource> = [];
  let lineIndex = 0;
  while (lineIndex < lines.length) {
    const openingLine = lines[lineIndex];
    if (openingLine === undefined) break;
    const opening = markdownFenceOpening(source.slice(openingLine.start, openingLine.contentEnd));
    if (opening === undefined) {
      lineIndex += 1;
      continue;
    }
    let closingIndex = lineIndex + 1;
    while (closingIndex < lines.length) {
      const candidate = lines[closingIndex];
      if (candidate === undefined) break;
      const text = source.slice(candidate.start, candidate.contentEnd);
      if (isMarkdownFenceClosing(text, opening)) break;
      closingIndex += 1;
    }
    const closingLine = lines[closingIndex];
    const language = fenceLanguageKey(opening.infoString);
    if (language !== undefined) {
      fences.push({
        language,
        start: openingLine.end,
        end: closingLine?.start ?? source.length,
      });
    }
    lineIndex = closingLine === undefined ? lines.length : closingIndex + 1;
  }
  return fences;
}

export function currentMarkdownEditorRanges(
  completed: CompletedMarkdownEditorHighlight | undefined,
  source: string,
): ReadonlyArray<HighlightRange> | undefined {
  return completed?.source === source ? completed.ranges : undefined;
}

export async function highlightMarkdownEditorSource(
  loader: HighlightingAssetLoader,
  source: string,
  signal: AbortSignal,
): Promise<ReadonlyArray<HighlightRange> | undefined> {
  if (source.length > maximumHighlightedCodeUnits) return undefined;
  const markdownRanges = await highlightFenceCode(loader, "markdown", source, signal);
  if (markdownRanges === undefined) return undefined;
  const highlightedFences = await Promise.all(fencedSources(source).map(async (fence) => ({
    fence,
    ranges: await highlightFenceCode(loader, fence.language, source.slice(fence.start, fence.end), signal),
  })));
  const candidates: Array<HighlightCandidate> = markdownRanges.map((range, sequence) => ({
    ...range,
    priority: 100,
    sequence,
  }));
  let sequence = candidates.length;
  for (const highlighted of highlightedFences) {
    if (highlighted.ranges === undefined) continue;
    for (const range of highlighted.ranges) {
      candidates.push({
        start: highlighted.fence.start + range.start,
        end: highlighted.fence.start + range.end,
        role: range.role,
        priority: 1_000,
        sequence,
      });
      sequence += 1;
    }
  }
  return normalizedHighlightRanges(source.length, candidates);
}
