import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { HighlightingAssetLoader, type HighlightingFetch } from "../highlighting/HighlightingAssetLoader.ts";
import { normalizedHighlightRanges, type HighlightRange } from "../highlighting/HighlightingTokens.ts";
import { currentHighlightRanges, fenceLanguageKey, highlightFenceCode, type CompletedHighlight } from "../highlighting/FenceHighlighting.ts";
import { currentMarkdownEditorRanges, highlightMarkdownEditorSource, type CompletedMarkdownEditorHighlight } from "../highlighting/MarkdownEditorHighlighting.ts";

const publicRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public");

function localFetch(requests: Array<string>): HighlightingFetch {
  return async (input, init) => {
    init.signal.throwIfAborted();
    requests.push(input);
    const content = await readFile(join(publicRoot, input.replace(/^\//u, ""))).catch(() => undefined);
    return {
      ok: content !== undefined,
      status: content === undefined ? 404 : 200,
      json: async (): Promise<unknown> => content === undefined ? {} : JSON.parse(content.toString("utf8")),
      text: async (): Promise<string> => content?.toString("utf8") ?? "",
      bytes: async (): Promise<Uint8Array> => content ?? new Uint8Array(),
    };
  };
}

function rebuiltSource(source: string, ranges: ReadonlyArray<HighlightRange>): string {
  let rebuilt = "";
  let offset = 0;
  for (const range of ranges) {
    assert.ok(range.start >= offset && range.end <= source.length && range.start < range.end);
    rebuilt += source.slice(offset, range.start) + source.slice(range.start, range.end);
    offset = range.end;
  }
  return rebuilt + source.slice(offset);
}

test("normalizes only the first GFM info-string key and rejects stale ranges", () => {
  assert.equal(fenceLanguageKey("  ql title=example.ql  "), "ql");
  assert.equal(fenceLanguageKey(undefined), undefined);
  const completed: CompletedHighlight = {
    language: "ql",
    source: "select 1",
    ranges: [{ start: 0, end: 6, role: "keyword" }],
  };
  assert.equal(currentHighlightRanges(completed, "ql", "select 2"), undefined);
  assert.equal(currentHighlightRanges(completed, "codeql", "select 1"), undefined);
  assert.deepEqual(currentHighlightRanges(completed, "ql", "select 1"), completed.ranges);
  assert.deepEqual(normalizedHighlightRanges(6, [
    { start: 0, end: 6, role: "comment", priority: 100, sequence: 0 },
    { start: 2, end: 4, role: "string", priority: 100, sequence: 1 },
  ]), [
    { start: 0, end: 2, role: "comment" },
    { start: 2, end: 4, role: "string" },
    { start: 4, end: 6, role: "comment" },
  ]);
});

test("highlights representative TextMate and Tree-sitter aliases without changing source", async () => {
  const requests: Array<string> = [];
  const loader = new HighlightingAssetLoader(localFetch(requests));
  const signal = new AbortController().signal;
  const codeQlSource = "from Function f\nselect f";
  const javascriptSource = "const label = \"🧪\"; // unicode";
  const codeQl = await highlightFenceCode(loader, "ql", codeQlSource, signal);
  const javascript = await highlightFenceCode(loader, "js", javascriptSource, signal);

  assert.ok(codeQl !== undefined && codeQl.length > 0);
  assert.ok(javascript !== undefined && javascript.length > 0);
  assert.equal(rebuiltSource(codeQlSource, codeQl), codeQlSource);
  assert.equal(rebuiltSource(javascriptSource, javascript), javascriptSource);
  for (const range of javascript) {
    const startCodeUnit = javascriptSource.charCodeAt(range.start);
    const endCodeUnit = javascriptSource.charCodeAt(range.end);
    assert.equal(startCodeUnit >= 0xdc00 && startCodeUnit <= 0xdfff, false);
    assert.equal(endCodeUnit >= 0xdc00 && endCodeUnit <= 0xdfff, false);
  }
  assert.ok(javascript.some((range) => javascriptSource.slice(range.start, range.end) === "// unicode"));
  assert.equal(requests.filter((request) => request.endsWith("manifest.json")).length, 1);
  assert.equal(requests.some((request) => request.includes("tree-sitter-ql")), false);
});

test("keeps unknown, Genshi, and failed loads plain while loading an HTML injection closure", async () => {
  const requests: Array<string> = [];
  const loader = new HighlightingAssetLoader(localFetch(requests));
  const signal = new AbortController().signal;
  assert.equal(await highlightFenceCode(loader, "unknown-language", "plain", signal), undefined);
  assert.equal(await highlightFenceCode(loader, "xml+kid", "<p>${plain}</p>", signal), undefined);
  const source = "<script>const answer = 42;</script>";
  const highlighted = await highlightFenceCode(loader, "html", source, signal);
  assert.ok(highlighted !== undefined && highlighted.length > 0);
  assert.equal(rebuiltSource(source, highlighted), source);
  assert.ok(requests.some((request) => request.includes("javascript")));

  const failedLoader = new HighlightingAssetLoader(async () => ({
    ok: false,
    status: 503,
    json: async (): Promise<unknown> => ({}),
    text: async (): Promise<string> => "",
    bytes: async (): Promise<Uint8Array> => new Uint8Array(),
  }));
  assert.equal(await highlightFenceCode(failedLoader, "ql", "select 1", signal), undefined);
});

test("uses the selected PHP and TypeScript parsers and highlights cold TSX", async () => {
  const requests: Array<string> = [];
  const loader = new HighlightingAssetLoader(localFetch(requests));
  const signal = new AbortController().signal;
  const phpSnippet = "echo $answer;";
  const taggedPhp = "<?php echo $answer; ?>";
  const typeScript = "const answer: number = 42;";
  const tsx = "const view = <section>{answer}</section>;";

  const phpRanges = await highlightFenceCode(loader, "php", phpSnippet, signal);
  const taggedPhpRanges = await highlightFenceCode(loader, "php", taggedPhp, signal);
  const typeScriptRanges = await highlightFenceCode(loader, "ts", typeScript, signal);
  const tsxRanges = await highlightFenceCode(loader, "tsx", tsx, signal);

  assert.ok(phpRanges !== undefined && phpRanges.length > 0);
  assert.ok(taggedPhpRanges !== undefined && taggedPhpRanges.length > 0);
  assert.ok(typeScriptRanges !== undefined && typeScriptRanges.length > 0);
  assert.ok(tsxRanges !== undefined && tsxRanges.length > 0);
  assert.equal(rebuiltSource(phpSnippet, phpRanges), phpSnippet);
  assert.equal(rebuiltSource(taggedPhp, taggedPhpRanges), taggedPhp);
  assert.equal(rebuiltSource(typeScript, typeScriptRanges), typeScript);
  assert.equal(rebuiltSource(tsx, tsxRanges), tsx);
  assert.equal(requests.some((request) => /trees\/php\.[^.]+\.wasm$/u.test(request)), false);
  assert.equal(requests.some((request) => /trees\/tsx\.[^.]+\.wasm$/u.test(request)), false);
  assert.equal(requests.some((request) => request.includes("php_only")), true);
  assert.equal(requests.some((request) => request.includes("typescript")), true);
  assert.equal(requests.some((request) => request.includes("source.tsx")), true);
});

test("publishes successful Markdown and sibling fences while failed fences stay plain", async () => {
  const requests: Array<string> = [];
  const fetchResource = localFetch(requests);
  const loader = new HighlightingAssetLoader(async (input, init) => {
    if (input.includes("source.abap")) {
      requests.push(input);
      return {
        ok: false,
        status: 503,
        json: async (): Promise<unknown> => ({}),
        text: async (): Promise<string> => "",
        bytes: async (): Promise<Uint8Array> => new Uint8Array(),
      };
    }
    return await fetchResource(input, init);
  });
  const source = [
    "# Mixed fences",
    "",
    "```ql title=example.ql",
    "from Function f",
    "select f",
    "  ````` \t",
    "",
    "```unknown-language",
    "unknown fallback text",
    "```",
    "",
    "```xml+kid",
    "genshi fallback text",
    "```",
    "",
    "```abap",
    "failed fallback text",
    "```",
  ].join("\n");
  const ranges = await highlightMarkdownEditorSource(loader, source, new AbortController().signal);

  assert.ok(ranges !== undefined && ranges.length > 0);
  assert.equal(rebuiltSource(source, ranges), source);
  assert.ok(ranges.some((range) => source.slice(range.start, range.end) === "#"));
  const qlStart = source.indexOf("from Function");
  const qlEnd = source.indexOf("  `````", qlStart);
  assert.ok(ranges.some((range) => range.start < qlEnd && range.end > qlStart));
  for (const plain of ["unknown fallback text", "genshi fallback text", "failed fallback text"]) {
    const start = source.indexOf(plain);
    const end = start + plain.length;
    assert.equal(ranges.some((range) => range.start < end && range.end > start), false);
  }
  assert.equal(requests.some((request) => request.includes("text.md")), true);
  assert.equal(requests.some((request) => request.includes("source.ql")), true);
  assert.equal(requests.some((request) => request.includes("source.abap")), true);

  const completed: CompletedMarkdownEditorHighlight = { source, ranges };
  assert.deepEqual(currentMarkdownEditorRanges(completed, source), ranges);
  assert.equal(currentMarkdownEditorRanges(completed, source + "\n"), undefined);

  const rootFetch = localFetch([]);
  const failedRootLoader = new HighlightingAssetLoader(async (input, init) => {
    if (input.includes("text.md")) {
      return {
        ok: false,
        status: 503,
        json: async (): Promise<unknown> => ({}),
        text: async (): Promise<string> => "",
        bytes: async (): Promise<Uint8Array> => new Uint8Array(),
      };
    }
    return await rootFetch(input, init);
  });
  assert.equal(await highlightMarkdownEditorSource(failedRootLoader, source, new AbortController().signal), undefined);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(highlightMarkdownEditorSource(loader, source, controller.signal), { name: "AbortError" });
});
