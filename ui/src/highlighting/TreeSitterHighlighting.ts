import { Language, Parser, Query } from "web-tree-sitter";
import type { HighlightingAssets } from "./HighlightingAssetLoader.ts";
import { maximumHighlightedCodeUnits, normalizedHighlightRanges, syntaxRole, type HighlightCandidate, type HighlightRange } from "./HighlightingTokens.ts";

type TreeAssets = Extract<HighlightingAssets, Readonly<{ kind: "tree-sitter" }>>;
type VariantRuntime = Readonly<{ language: Language; highlights: Query; injections: Query | undefined }>;
type TreeResult = Readonly<{
  ranges: ReadonlyArray<HighlightRange>;
  injections: ReadonlyArray<Readonly<{ language: string; start: number; end: number }>>;
}>;

let treeSitterInitialization: Promise<void> | undefined;
const runtimeLoads = new Map<string, Promise<VariantRuntime>>();

async function runtime(assets: TreeAssets): Promise<VariantRuntime> {
  const existing = runtimeLoads.get(assets.scope);
  if (existing !== undefined) return await existing;
  const producer = (async (): Promise<VariantRuntime> => {
    treeSitterInitialization ??= Parser.init({ wasmBinary: assets.runtimeWasm });
    await treeSitterInitialization;
    const language = await Language.load(assets.variant.wasm);
    return {
      language,
      highlights: new Query(language, assets.variant.highlights),
      injections: assets.variant.injections === undefined ? undefined : new Query(language, assets.variant.injections),
    };
  })();
  runtimeLoads.set(assets.scope, producer);
  try {
    return await producer;
  } catch (error: unknown) {
    if (runtimeLoads.get(assets.scope) === producer) runtimeLoads.delete(assets.scope);
    throw error;
  }
}

function injectionLanguage(
  captures: ReadonlyArray<Readonly<{ name: string; node: Readonly<{ text: string }> }>>,
  configured: string | null | undefined,
): string | undefined {
  if (configured !== undefined && configured !== null && configured.trim() !== "") return configured.trim();
  return captures.find((capture) => capture.name === "injection.language")?.node.text.trim() || undefined;
}

export async function treeSitterHighlightRanges(
  assets: TreeAssets,
  source: string,
  signal: AbortSignal,
): Promise<TreeResult | undefined> {
  if (source.length > maximumHighlightedCodeUnits) return undefined;
  const selected = await runtime(assets);
  signal.throwIfAborted();
  const parser = new Parser();
  try {
    parser.setLanguage(selected.language);
    const deadline = performance.now() + 50;
    const tree = parser.parse(source, null, {
      progressCallback: () => signal.aborted || performance.now() > deadline,
    });
    if (tree === null || signal.aborted) {
      tree?.delete();
      signal.throwIfAborted();
      return undefined;
    }
    try {
      const candidates: Array<HighlightCandidate> = [];
      for (const [sequence, capture] of selected.highlights.captures(tree.rootNode, { matchLimit: 20_000 }).entries()) {
        const role = syntaxRole(capture.name);
        if (role === undefined) continue;
        const configuredPriority = capture.setProperties?.priority;
        const parsedPriority = configuredPriority === undefined || configuredPriority === null ? 100 : Number(configuredPriority);
        candidates.push({ start: capture.node.startIndex, end: capture.node.endIndex, role, priority: Number.isFinite(parsedPriority) ? parsedPriority : 100, sequence });
      }
      const ranges = normalizedHighlightRanges(source.length, candidates);
      if (ranges === undefined) return undefined;
      const injections: Array<Readonly<{ language: string; start: number; end: number }>> = [];
      if (selected.injections !== undefined) {
        for (const match of selected.injections.matches(tree.rootNode, { matchLimit: 256 })) {
          const language = injectionLanguage(match.captures, match.setProperties?.["injection.language"]);
          if (language === undefined) continue;
          for (const capture of match.captures) {
            if (capture.name !== "injection.content") continue;
            const start = capture.node.startIndex;
            const end = capture.node.endIndex;
            if (start < end && end <= source.length) injections.push({ language, start, end });
            if (injections.length > 64) return undefined;
          }
        }
      }
      return { ranges, injections };
    } finally {
      tree.delete();
    }
  } finally {
    parser.delete();
  }
}
