import {
  createOnigScanner,
  createOnigString,
  loadWASM,
} from "vscode-oniguruma";
import {
  Registry,
  parseRawGrammar,
  type IGrammar,
  type IRawGrammar,
} from "vscode-textmate";
import {
  Language,
  Parser,
  Query,
} from "web-tree-sitter";
import type {
  HighlightingAssets,
  LoadedTreeVariant,
} from "./HighlightingAssetLoader.ts";

export type TextMateHighlightingRuntime = Readonly<{
  kind: "textmate";
  grammar: IGrammar;
}>;

export type TreeSitterVariantRuntime = Readonly<{
  name: string;
  language: Language;
  highlights: Query;
  injections: Query | undefined;
}>;

export type TreeSitterHighlightingRuntime = Readonly<{
  kind: "tree-sitter";
  variants: ReadonlyArray<TreeSitterVariantRuntime>;
}>;

let onigurumaInitialization: Promise<void> | undefined;
let treeSitterInitialization: Promise<void> | undefined;

function initializeOniguruma(wasm: Uint8Array): Promise<void> {
  onigurumaInitialization ??= loadWASM(wasm);
  return onigurumaInitialization;
}

function initializeTreeSitter(wasm: Uint8Array): Promise<void> {
  treeSitterInitialization ??= Parser.init({ wasmBinary: wasm });
  return treeSitterInitialization;
}

function grammarMap(assets: Extract<HighlightingAssets, Readonly<{ kind: "textmate" }>>): ReadonlyMap<string, IRawGrammar> {
  const grammars = new Map<string, IRawGrammar>();
  for (const grammar of assets.grammars) {
    grammars.set(grammar.scope, parseRawGrammar(grammar.source, grammar.path));
  }
  return grammars;
}

export async function createTextMateRuntime(
  assets: Extract<HighlightingAssets, Readonly<{ kind: "textmate" }>>,
): Promise<TextMateHighlightingRuntime> {
  await initializeOniguruma(assets.onigWasm);
  const grammars = grammarMap(assets);
  const registry = new Registry({
    onigLib: Promise.resolve({ createOnigScanner, createOnigString }),
    loadGrammar: (scopeName: string): Promise<IRawGrammar | null> => Promise.resolve(grammars.get(scopeName) ?? null),
  });
  const grammar = await registry.loadGrammar(assets.scope);
  if (grammar === null) throw new Error(`TextMate grammar ${assets.scope} did not load.`);
  return { kind: "textmate", grammar };
}

async function createTreeVariant(variant: LoadedTreeVariant): Promise<TreeSitterVariantRuntime> {
  const language = await Language.load(variant.wasm);
  const parser = new Parser();
  try {
    parser.setLanguage(language);
  } finally {
    parser.delete();
  }
  return {
    name: variant.name,
    language,
    highlights: new Query(language, variant.highlights),
    injections: variant.injections === undefined ? undefined : new Query(language, variant.injections),
  };
}

export async function createTreeSitterRuntime(
  assets: Extract<HighlightingAssets, Readonly<{ kind: "tree-sitter" }>>,
): Promise<TreeSitterHighlightingRuntime> {
  await initializeTreeSitter(assets.runtimeWasm);
  return {
    kind: "tree-sitter",
    variants: await Promise.all(assets.variants.map(createTreeVariant)),
  };
}
