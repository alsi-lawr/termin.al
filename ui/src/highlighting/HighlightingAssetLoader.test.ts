import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HighlightingAssetLoader,
  type HighlightingFetch,
} from "./HighlightingAssetLoader.ts";
import {
  textMateHighlightRanges,
} from "./TextMateHighlighting.ts";
import { treeSitterHighlightRanges } from "./TreeSitterHighlighting.ts";

const publicRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public");

function localFetch(
  requests: Array<string>,
  beforeRead?: (input: string, signal: AbortSignal) => Promise<void>,
): HighlightingFetch {
  return async (input, init) => {
    init.signal.throwIfAborted();
    requests.push(input);
    if (beforeRead !== undefined) await beforeRead(input, init.signal);
    init.signal.throwIfAborted();
    const path = join(publicRoot, input.replace(/^\//u, ""));
    const content = await readFile(path).catch(() => undefined);
    const exists = content !== undefined;
    return {
      ok: exists,
      status: exists ? 200 : 404,
      json: async (): Promise<unknown> => content === undefined ? {} : JSON.parse(content.toString("utf8")),
      text: async (): Promise<string> => content?.toString("utf8") ?? "",
      bytes: async (): Promise<Uint8Array> => content ?? new Uint8Array(),
    };
  };
}

test("keeps unknown and owner-excluded Linguist aliases exact plain without grammar payload", async () => {
  const requests: Array<string> = [];
  const loader = new HighlightingAssetLoader(localFetch(requests));
  const signal = new AbortController().signal;

  const unknown = await loader.load("not-a-linguist-alias", signal);
  const genshi = await loader.load("xml+kid", signal);

  assert.deepEqual(unknown, { kind: "plain", canonical: undefined, reason: "unknown" });
  assert.deepEqual(genshi, { kind: "plain", canonical: "Genshi", reason: "excluded-unverifiable-source" });
  assert.deepEqual(requests, ["/highlighting/manifest.json"]);
});

test("routes both CodeQL aliases through one cached TextMate closure", async () => {
  const requests: Array<string> = [];
  const loader = new HighlightingAssetLoader(localFetch(requests));
  const signal = new AbortController().signal;

  const [codeQl, alias] = await Promise.all([
    loader.load("codeql", signal),
    loader.load("ql", signal),
  ]);

  assert.equal(codeQl.kind, "textmate");
  assert.equal(alias.kind, "textmate");
  if (codeQl.kind !== "textmate" || alias.kind !== "textmate") assert.fail("Expected CodeQL TextMate assets.");
  assert.equal(codeQl.scope, "source.ql");
  assert.deepEqual(codeQl.grammars.map((grammar) => grammar.scope), ["source.ql"]);
  assert.equal(requests.filter((request) => request.endsWith("manifest.json")).length, 1);
  assert.equal(requests.filter((request) => request.includes("source.ql")).length, 1);
  assert.equal(requests.filter((request) => request.endsWith(".wasm")).length, 1);
  assert.equal(requests.some((request) => request.includes("tree-sitter-ql")), false);

  const ranges = await textMateHighlightRanges(codeQl, "from Function f select f", signal);
  assert.ok(ranges !== undefined && ranges.length > 0);
});

test("isolates caller aborts while sharing the CodeQL asset producers", async () => {
  const requests: Array<string> = [];
  let releaseManifest: (() => void) | undefined;
  const manifestGate = new Promise<void>((resolve) => { releaseManifest = resolve; });
  const loader = new HighlightingAssetLoader(localFetch(requests, async (input) => {
    if (input.endsWith("manifest.json")) await manifestGate;
  }));
  const firstController = new AbortController();
  const secondController = new AbortController();

  const first = loader.load("codeql", firstController.signal);
  const second = loader.load("ql", secondController.signal);
  firstController.abort();

  await assert.rejects(first, { name: "AbortError" });
  if (releaseManifest === undefined) assert.fail("Expected the manifest request to start.");
  releaseManifest();
  const loaded = await second;

  assert.equal(loaded.kind, "textmate");
  assert.equal(secondController.signal.aborted, false);
  assert.equal(requests.filter((request) => request.endsWith("manifest.json")).length, 1);
  assert.equal(requests.filter((request) => request.includes("source.ql")).length, 1);
  assert.equal(requests.filter((request) => request.endsWith(".wasm")).length, 1);
});

test("loads only the pinned TypeScript closure and highlights its primary variant", async () => {
  const requests: Array<string> = [];
  const loader = new HighlightingAssetLoader(localFetch(requests));
  const loaded = await loader.load("ts", new AbortController().signal);

  assert.equal(loaded.kind, "tree-sitter");
  if (loaded.kind !== "tree-sitter") assert.fail("Expected TypeScript Tree-sitter assets.");
  assert.deepEqual(loaded.variants.map((variant) => variant.name), ["typescript", "tsx"]);
  assert.equal(requests.filter((request) => request.endsWith(".wasm")).length, 3);
  assert.equal(requests.some((request) => request.includes("tree-sitter-ql")), false);
  assert.equal(requests.some((request) => request.includes("grammars/")), false);

  const result = await treeSitterHighlightRanges(loaded, "const answer: number = 42;", new AbortController().signal);
  assert.ok(result !== undefined && result.ranges.length > 0);
});

test("returns a typed failure and retries a failed known grammar asset", async () => {
  const requests: Array<string> = [];
  const fetchResource = localFetch(requests);
  const failingFetch: HighlightingFetch = async (input, init) => {
    if (input.includes("source.ql")) {
      requests.push(input);
      return {
        ok: false,
        status: 503,
        json: async (): Promise<unknown> => ({}),
        text: async (): Promise<string> => "",
        bytes: async (): Promise<Uint8Array> => new Uint8Array(),
      };
    }
    return fetchResource(input, init);
  };
  const loader = new HighlightingAssetLoader(failingFetch);
  const first = await loader.load("ql", new AbortController().signal);
  const second = await loader.load("ql", new AbortController().signal);

  assert.equal(first.kind, "failed");
  assert.equal(second.kind, "failed");
  if (first.kind !== "failed" || second.kind !== "failed") assert.fail("Expected typed loader failures.");
  assert.equal(first.canonical, "CodeQL");
  assert.match(first.error.message, /Failed to load highlighting assets for CodeQL/u);
  assert.equal(requests.filter((request) => request.includes("source.ql")).length, 2);
});
