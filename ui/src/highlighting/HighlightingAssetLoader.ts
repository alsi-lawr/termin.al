type ManifestAsset = Readonly<{
  path: string;
}>;

type PlainLanguage = Readonly<{
  kind: "plain";
  reason: "excluded-unverifiable-source" | "upstream-no-grammar";
}>;

type TextMateLanguage = Readonly<{
  kind: "textmate";
  scope: string;
  closure: ReadonlyArray<string>;
}>;

type TreeVariant = Readonly<{
  name: string;
  wasm: string;
  highlights: string;
  injections: string | undefined;
}>;

type TreeLanguage = Readonly<{
  kind: "tree-sitter";
  scope: string;
  variant: TreeVariant;
}>;

type ManifestLanguage = PlainLanguage | TextMateLanguage | TreeLanguage;

type HighlightingManifest = Readonly<{
  aliases: ReadonlyMap<string, string>;
  languages: ReadonlyMap<string, ManifestLanguage>;
  textMateAssets: ReadonlyMap<string, string>;
  assets: ReadonlyMap<string, ManifestAsset>;
  onigWasm: string;
  treeRuntimeWasm: string;
}>;

export type LoadedTextMateGrammar = Readonly<{
  scope: string;
  path: string;
  source: string;
}>;

export type LoadedTreeVariant = Readonly<{
  name: string;
  wasm: Uint8Array;
  highlights: string;
  injections: string | undefined;
}>;

export type HighlightingAssets =
  | Readonly<{
      kind: "plain";
      canonical: string | undefined;
      reason: "excluded-unverifiable-source" | "unknown" | "upstream-no-grammar";
    }>
  | Readonly<{
      kind: "textmate";
      canonical: string;
      scope: string;
      onigWasm: Uint8Array;
      grammars: ReadonlyArray<LoadedTextMateGrammar>;
    }>
  | Readonly<{
      kind: "tree-sitter";
      canonical: string;
      scope: string;
      runtimeWasm: Uint8Array;
      variant: LoadedTreeVariant;
    }>
  | Readonly<{
      kind: "failed";
      canonical: string;
      error: Error;
    }>;

type FetchResponse = Readonly<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
  bytes(): Promise<Uint8Array>;
}>;

export type HighlightingFetch = (
  input: string,
  init: Readonly<{ signal: AbortSignal }>,
) => Promise<FetchResponse>;

type SharedLoadState = {
  activeCallers: number;
  abandoned: boolean;
  settled: boolean;
};

type SharedLoad<T> = Readonly<{
  controller: AbortController;
  promise: Promise<T>;
  state: SharedLoadState;
}>;

function isObjectValue(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function objectValue(value: unknown, description: string): Readonly<Record<string, unknown>> {
  if (!isObjectValue(value)) {
    throw new Error(`Expected ${description} to be an object.`);
  }
  return value;
}

function stringValue(value: unknown, description: string): string {
  if (typeof value !== "string") {
    throw new Error(`Expected ${description} to be a string.`);
  }
  return value;
}

function stringArray(value: unknown, description: string): ReadonlyArray<string> {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Expected ${description} to be a string array.`);
  }
  return value;
}

function optionalString(value: unknown, description: string): string | undefined {
  if (value === undefined) return undefined;
  return stringValue(value, description);
}

function manifestLanguage(value: unknown, canonical: string): ManifestLanguage {
  const record = objectValue(value, `language ${canonical}`);
  const kind = stringValue(record.kind, `${canonical}.kind`);
  if (kind === "plain") {
    const reason = stringValue(record.reason, `${canonical}.reason`);
    if (reason !== "excluded-unverifiable-source" && reason !== "upstream-no-grammar") {
      throw new Error(`Invalid plain-text reason for ${canonical}.`);
    }
    return { kind, reason };
  }
  if (kind === "textmate") {
    return {
      kind,
      scope: stringValue(record.scope, `${canonical}.scope`),
      closure: stringArray(record.closure, `${canonical}.closure`),
    };
  }
  if (kind === "tree-sitter") {
    const variant = objectValue(record.variant, `${canonical}.variant`);
    return {
      kind,
      scope: stringValue(record.scope, `${canonical}.scope`),
      variant: {
        name: stringValue(variant.name, `${canonical}.variant.name`),
        wasm: stringValue(variant.wasm, `${canonical}.variant.wasm`),
        highlights: stringValue(variant.highlights, `${canonical}.variant.highlights`),
        injections: optionalString(variant.injections, `${canonical}.variant.injections`),
      },
    };
  }
  throw new Error(`Unknown highlighting route ${kind} for ${canonical}.`);
}

function parseManifest(value: unknown): HighlightingManifest {
  const root = objectValue(value, "highlighting manifest");
  const counts = objectValue(root.counts, "manifest counts");
  if (counts.canonical !== 814 || counts.aliases !== 1237 || counts.plain !== 64 || counts.textmate !== 731 || counts.treeSitter !== 19 || counts.highlighted !== 750) {
    throw new Error("Highlighting manifest corpus counts are invalid.");
  }
  const aliasValues = objectValue(root.aliases, "manifest aliases");
  const aliases = new Map<string, string>();
  for (const [alias, canonical] of Object.entries(aliasValues)) aliases.set(alias, stringValue(canonical, `alias ${alias}`));
  const languageValues = objectValue(root.languages, "manifest languages");
  const languages = new Map<string, ManifestLanguage>();
  for (const [canonical, language] of Object.entries(languageValues)) languages.set(canonical, manifestLanguage(language, canonical));
  const scopeValues = objectValue(root.textmateScopes, "manifest TextMate scopes");
  const textMateAssets = new Map<string, string>();
  for (const [scope, value] of Object.entries(scopeValues)) {
    const record = objectValue(value, `scope ${scope}`);
    textMateAssets.set(scope, stringValue(record.asset, `${scope}.asset`));
  }
  const assetValues = objectValue(root.assets, "manifest assets");
  const assets = new Map<string, ManifestAsset>();
  for (const [key, value] of Object.entries(assetValues)) {
    const record = objectValue(value, `asset ${key}`);
    assets.set(key, { path: stringValue(record.path, `${key}.path`) });
  }
  const runtimes = objectValue(root.runtimes, "manifest runtimes");
  return {
    aliases,
    languages,
    textMateAssets,
    assets,
    onigWasm: stringValue(runtimes.onigWasm, "runtimes.onigWasm"),
    treeRuntimeWasm: stringValue(runtimes.treeRuntimeWasm, "runtimes.treeRuntimeWasm"),
  };
}

function normalizeFenceLanguage(value: string): string {
  return value.trim().toLowerCase();
}

export class HighlightingAssetLoader {
  readonly #basePath: string;
  readonly #fetch: HighlightingFetch;
  readonly #assetCache = new Map<string, Uint8Array | string>();
  readonly #byteLoads = new Map<string, SharedLoad<Uint8Array>>();
  readonly #textLoads = new Map<string, SharedLoad<string>>();
  #manifest: HighlightingManifest | undefined;
  #manifestLoad: SharedLoad<HighlightingManifest> | undefined;

  public constructor(fetchResource: HighlightingFetch, basePath = "/highlighting") {
    this.#fetch = fetchResource;
    this.#basePath = basePath.replace(/\/$/u, "");
  }

  async #response(path: string, signal: AbortSignal): Promise<FetchResponse> {
    const response = await this.#fetch(`${this.#basePath}/${path}`, { signal });
    if (!response.ok) throw new Error(`Highlighting asset ${path} returned HTTP ${response.status}.`);
    return response;
  }

  async #joinSharedLoad<T>(
    current: () => SharedLoad<T> | undefined,
    replace: (load: SharedLoad<T> | undefined) => void,
    produce: (signal: AbortSignal) => Promise<T>,
    retain: (value: T) => void,
    signal: AbortSignal,
  ): Promise<T> {
    signal.throwIfAborted();
    let load = current();
    if (load === undefined) {
      const controller = new AbortController();
      const state: SharedLoadState = { activeCallers: 0, abandoned: false, settled: false };
      const promise = produce(controller.signal).then(
        (value) => {
          state.settled = true;
          if (!state.abandoned) retain(value);
          return value;
        },
        (error: unknown) => {
          state.settled = true;
          throw error;
        },
      );
      load = { controller, promise, state };
      replace(load);
    }

    load.state.activeCallers += 1;
    let abortListener: (() => void) | undefined;
    const callerAbort = new Promise<never>((_resolve, reject) => {
      abortListener = () => {
        try {
          signal.throwIfAborted();
        } catch (error: unknown) {
          reject(error);
        }
      };
      signal.addEventListener("abort", abortListener, { once: true });
      if (signal.aborted) abortListener();
    });

    try {
      return await Promise.race([load.promise, callerAbort]);
    } finally {
      if (abortListener !== undefined) signal.removeEventListener("abort", abortListener);
      load.state.activeCallers -= 1;
      if (load.state.activeCallers === 0) {
        if (current() === load) replace(undefined);
        if (!load.state.settled) {
          load.state.abandoned = true;
          load.controller.abort();
        }
      }
    }
  }

  async #loadManifest(signal: AbortSignal): Promise<HighlightingManifest> {
    if (this.#manifest !== undefined) return this.#manifest;
    return await this.#joinSharedLoad(
      () => this.#manifestLoad,
      (load) => { this.#manifestLoad = load; },
      async (producerSignal) => parseManifest(await (await this.#response("manifest.json", producerSignal)).json()),
      (manifest) => { this.#manifest = manifest; },
      signal,
    );
  }

  async #bytes(manifest: HighlightingManifest, key: string, signal: AbortSignal): Promise<Uint8Array> {
    const cached = this.#assetCache.get(key);
    if (cached instanceof Uint8Array) return cached;
    const asset = manifest.assets.get(key);
    if (asset === undefined) throw new Error(`Manifest asset ${key} is missing.`);
    return await this.#joinSharedLoad(
      () => this.#byteLoads.get(key),
      (load) => {
        if (load === undefined) this.#byteLoads.delete(key);
        else this.#byteLoads.set(key, load);
      },
      async (producerSignal) => (await this.#response(asset.path, producerSignal)).bytes(),
      (bytes) => { this.#assetCache.set(key, bytes); },
      signal,
    );
  }

  async #text(manifest: HighlightingManifest, key: string, signal: AbortSignal): Promise<string> {
    const cached = this.#assetCache.get(key);
    if (typeof cached === "string") return cached;
    const asset = manifest.assets.get(key);
    if (asset === undefined) throw new Error(`Manifest asset ${key} is missing.`);
    return await this.#joinSharedLoad(
      () => this.#textLoads.get(key),
      (load) => {
        if (load === undefined) this.#textLoads.delete(key);
        else this.#textLoads.set(key, load);
      },
      async (producerSignal) => (await this.#response(asset.path, producerSignal)).text(),
      (text) => { this.#assetCache.set(key, text); },
      signal,
    );
  }

  public async load(fenceLanguage: string, signal: AbortSignal): Promise<HighlightingAssets> {
    const manifest = await this.#loadManifest(signal);
    const canonical = manifest.aliases.get(normalizeFenceLanguage(fenceLanguage));
    if (canonical === undefined) return { kind: "plain", canonical: undefined, reason: "unknown" };
    const language = manifest.languages.get(canonical);
    if (language === undefined) throw new Error(`Manifest language ${canonical} is missing.`);
    if (language.kind === "plain") return { kind: "plain", canonical, reason: language.reason };
    try {
      if (language.kind === "textmate") {
        const grammars = await Promise.all(language.closure.map(async (scope): Promise<LoadedTextMateGrammar> => {
          const asset = manifest.textMateAssets.get(scope);
          if (asset === undefined) throw new Error(`TextMate scope ${scope} is missing.`);
          const path = manifest.assets.get(asset)?.path;
          if (path === undefined) throw new Error(`TextMate asset ${asset} is missing.`);
          return { scope, path, source: await this.#text(manifest, asset, signal) };
        }));
        return {
          kind: "textmate",
          canonical,
          scope: language.scope,
          onigWasm: await this.#bytes(manifest, manifest.onigWasm, signal),
          grammars,
        };
      }
      const variant: LoadedTreeVariant = {
        name: language.variant.name,
        wasm: await this.#bytes(manifest, language.variant.wasm, signal),
        highlights: await this.#text(manifest, language.variant.highlights, signal),
        injections: language.variant.injections === undefined ? undefined : await this.#text(manifest, language.variant.injections, signal),
      };
      return {
        kind: "tree-sitter",
        canonical,
        scope: language.scope,
        runtimeWasm: await this.#bytes(manifest, manifest.treeRuntimeWasm, signal),
        variant,
      };
    } catch (error: unknown) {
      if (signal.aborted) throw error;
      const context = `Failed to load highlighting assets for ${canonical}.`;
      return {
        kind: "failed",
        canonical,
        error: error instanceof Error ? new Error(context, { cause: error }) : new Error(context),
      };
    }
  }
}
