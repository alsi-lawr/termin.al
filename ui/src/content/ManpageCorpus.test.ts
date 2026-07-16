import assert from "node:assert/strict";
import test from "node:test";
import { createManpageCorpus } from "./ManpageCorpus.ts";

const text = "LS(1)\n";
const entry = {
  name: "ls",
  section: 1,
  usage: "ls [path]",
  summary: "List entries.",
  sourcePath: "man/ls.1",
  artifactPath: "ui/src/generated/manpages/ls.txt",
  byteCount: new TextEncoder().encode(text).byteLength,
  lineCount: 1,
  sha256: "a".repeat(64),
};

test("constructs a directly importable immutable manpage corpus", () => {
  const corpus = createManpageCorpus({
    manifest: { entries: [entry] },
    artifacts: new Map([["ls", text]]),
  });

  assert.deepEqual(corpus.entries, [entry]);
  assert.deepEqual(corpus.lookup("ls"), {
    kind: "found",
    manpage: { metadata: entry, text },
  });
  assert.deepEqual(corpus.lookup("dir"), {
    kind: "missing",
    canonicalName: "dir",
  });
});

test("rejects malformed, unsorted, missing, extra, and drifted corpus inputs", () => {
  const cases: ReadonlyArray<Readonly<{
    manifest: unknown;
    artifacts: ReadonlyMap<string, string>;
    message: RegExp;
  }>> = [
    {
      manifest: { entries: [{ ...entry, section: 2 }] },
      artifacts: new Map([["ls", text]]),
      message: /section 1/u,
    },
    {
      manifest: { entries: [entry, { ...entry, name: "cat" }] },
      artifacts: new Map([["ls", text], ["cat", text]]),
      message: /unique sorted names/u,
    },
    {
      manifest: { entries: [entry] },
      artifacts: new Map(),
      message: /missing for ls/u,
    },
    {
      manifest: { entries: [entry] },
      artifacts: new Map([["ls", text], ["cat", text]]),
      message: /Unexpected manpage artifact for cat/u,
    },
    {
      manifest: { entries: [{ ...entry, byteCount: 1 }] },
      artifacts: new Map([["ls", text]]),
      message: /byte count does not match/u,
    },
    {
      manifest: { entries: [{ ...entry, lineCount: 2 }] },
      artifacts: new Map([["ls", text]]),
      message: /line count does not match/u,
    },
  ];

  for (const invalid of cases) {
    assert.throws(
      () => createManpageCorpus(invalid),
      invalid.message,
    );
  }
});
