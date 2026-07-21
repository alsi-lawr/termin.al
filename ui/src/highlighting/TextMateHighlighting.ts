import { createOnigScanner, createOnigString, loadWASM } from "vscode-oniguruma";
import { Registry, parseRawGrammar, type IGrammar, type IRawGrammar, type StateStack } from "vscode-textmate";
import type { HighlightingAssets } from "./HighlightingAssetLoader.ts";
import { maximumHighlightRanges, maximumHighlightedCodeUnits, syntaxRole, type HighlightRange } from "./HighlightingTokens.ts";

type TextMateAssets = Extract<HighlightingAssets, Readonly<{ kind: "textmate" }>>;

let onigurumaInitialization: Promise<void> | undefined;
const runtimeLoads = new Map<string, Promise<IGrammar>>();

async function runtime(assets: TextMateAssets): Promise<IGrammar> {
  const existing = runtimeLoads.get(assets.scope);
  if (existing !== undefined) return await existing;
  const producer = (async (): Promise<IGrammar> => {
    onigurumaInitialization ??= loadWASM(assets.onigWasm);
    await onigurumaInitialization;
    const grammars = new Map<string, IRawGrammar>();
    for (const grammarAsset of assets.grammars) {
      grammars.set(grammarAsset.scope, parseRawGrammar(grammarAsset.source, grammarAsset.path));
    }
    const registry = new Registry({
      onigLib: Promise.resolve({ createOnigScanner, createOnigString }),
      loadGrammar: (scopeName: string): Promise<IRawGrammar | null> => Promise.resolve(grammars.get(scopeName) ?? null),
    });
    const grammar = await registry.loadGrammar(assets.scope);
    if (grammar === null) {
      registry.dispose();
      throw new Error(`TextMate grammar ${assets.scope} did not load.`);
    }
    return grammar;
  })();
  runtimeLoads.set(assets.scope, producer);
  try {
    return await producer;
  } catch (error: unknown) {
    if (runtimeLoads.get(assets.scope) === producer) runtimeLoads.delete(assets.scope);
    throw error;
  }
}

export async function textMateHighlightRanges(
  assets: TextMateAssets,
  source: string,
  signal: AbortSignal,
): Promise<ReadonlyArray<HighlightRange> | undefined> {
  if (source.length > maximumHighlightedCodeUnits) return undefined;
  const grammar = await runtime(assets);
  const lines = source.split("\n");
  const ranges: Array<HighlightRange> = [];
  let state: StateStack | null = null;
  let offset = 0;
  for (const [lineIndex, line] of lines.entries()) {
    signal.throwIfAborted();
    const tokenized = grammar.tokenizeLine(line, state, 20);
    if (tokenized.stoppedEarly) return undefined;
    state = tokenized.ruleStack;
    for (const token of tokenized.tokens) {
      const role = syntaxRole(token.scopes.toReversed().join(" "));
      const end = Math.min(token.endIndex, line.length);
      if (role !== undefined && token.startIndex < end) {
        ranges.push({ start: offset + token.startIndex, end: offset + end, role });
        if (ranges.length > maximumHighlightRanges) return undefined;
      }
    }
    offset += line.length + (lineIndex < lines.length - 1 ? 1 : 0);
    if (lineIndex > 0 && lineIndex % 200 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return ranges;
}
