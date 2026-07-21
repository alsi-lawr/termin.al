import { HighlightingAssetLoader } from "./HighlightingAssetLoader.ts";
import { normalizedHighlightRanges, type HighlightCandidate, type HighlightRange } from "./HighlightingTokens.ts";

export type CompletedHighlight = Readonly<{
  language: string;
  source: string;
  ranges: ReadonlyArray<HighlightRange>;
}>;

export function fenceLanguageKey(infoString: string | undefined): string | undefined {
  const key = infoString?.trim().split(/\s+/u)[0];
  return key === undefined || key === "" ? undefined : key;
}

export function currentHighlightRanges(
  completed: CompletedHighlight | undefined,
  language: string | undefined,
  source: string,
): ReadonlyArray<HighlightRange> | undefined {
  return completed !== undefined && completed.language === language && completed.source === source
    ? completed.ranges
    : undefined;
}

export async function highlightFenceCode(
  loader: HighlightingAssetLoader,
  language: string,
  source: string,
  signal: AbortSignal,
  depth = 0,
): Promise<ReadonlyArray<HighlightRange> | undefined> {
  try {
    const assets = await loader.load(language, signal);
    if (assets.kind === "plain" || assets.kind === "failed") return undefined;
    if (assets.kind === "textmate") {
      const { textMateHighlightRanges } = await import("./TextMateHighlighting.ts");
      return await textMateHighlightRanges(assets, source, signal);
    }
    const { treeSitterHighlightRanges } = await import("./TreeSitterHighlighting.ts");
    const result = await treeSitterHighlightRanges(assets, source, signal);
    if (result === undefined || result.injections.length === 0 || depth >= 2) return result?.ranges;
    const candidates: Array<HighlightCandidate> = result.ranges.map((range, sequence) => ({
      ...range,
      priority: 100,
      sequence,
    }));
    let sequence = candidates.length;
    for (const injection of result.injections) {
      signal.throwIfAborted();
      const injected = await highlightFenceCode(
        loader,
        injection.language,
        source.slice(injection.start, injection.end),
        signal,
        depth + 1,
      );
      if (injected === undefined) continue;
      for (const range of injected) {
        candidates.push({
          start: injection.start + range.start,
          end: injection.start + range.end,
          role: range.role,
          priority: 1_000 + depth,
          sequence,
        });
        sequence += 1;
      }
    }
    return normalizedHighlightRanges(source.length, candidates);
  } catch (error: unknown) {
    if (signal.aborted) throw error;
    return undefined;
  }
}
