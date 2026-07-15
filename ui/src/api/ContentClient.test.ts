import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  resolveVirtualPath,
  virtualHomeDirectory,
} from "../domain/filesystem/VirtualFilesystem.ts";
import { HttpContentClient } from "./ContentClient.ts";

function fixture(name: string): unknown {
  const path = new URL(`../../../contracts/fixtures/${name}`, import.meta.url);

  return JSON.parse(readFileSync(path, "utf8"));
}

function responseForPath(path: string): Response {
  switch (path) {
    case "/api/content/catalog":
      return Response.json(fixture("catalog.json"));
    case "/api/content/projects":
      return Response.json(fixture("projects.json"));
    case "/api/content/now":
      return Response.json(fixture("now.json"));
    case "/api/content/changelog":
      return Response.json(fixture("changelog.json"));
    case "/api/content/document/about":
      return Response.json(fixture("document-about.json"));
    default:
      throw new Error(`Unexpected content API request: ${path}`);
  }
}

function requestPath(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.pathname;
  }

  return new URL(input.url).pathname;
}

test("loads the same-origin content corpus and forwards cancellation", async () => {
  const originalFetch = globalThis.fetch;
  const paths: string[] = [];
  const signals: Array<AbortSignal | null> = [];
  const fetchContent: typeof fetch = async (input, init) => {
    const path = requestPath(input);
    paths.push(path);
    signals.push(init?.signal ?? null);

    return responseForPath(path);
  };
  globalThis.fetch = fetchContent;

  try {
    const controller = new AbortController();
    const client = new HttpContentClient();
    const result = await client.loadCorpus(controller.signal);

    if (result.kind !== "available") {
      assert.fail(`Expected an available corpus, received ${result.kind}.`);
    }

    assert.deepEqual(new Set(paths), new Set([
      "/api/content/catalog",
      "/api/content/projects",
      "/api/content/now",
      "/api/content/changelog",
    ]));
    assert.equal(signals.every((signal) => signal === controller.signal), true);

    const about = resolveVirtualPath(
      result.corpus.filesystem,
      virtualHomeDirectory(),
      "about.md",
    );

    if (about.kind !== "found" || about.node.kind !== "file") {
      assert.fail("Expected the catalog's about document.");
    }

    const document = await result.corpus.documents.read(
      about.node.documentHandle,
      controller.signal,
    );

    if (document.kind !== "available") {
      assert.fail("Expected the about document from the content API.");
    }

    assert.equal(document.document.text, "# About\n\nA validated shared content fixture.");
    assert.equal(paths.at(-1), "/api/content/document/about");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
