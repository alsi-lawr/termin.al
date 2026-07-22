import assert from "node:assert/strict";
import test from "node:test";
import type { RpcMetadata } from "@protobuf-ts/runtime-rpc";
import {
  resolveVirtualPath,
  virtualHomeDirectory,
} from "../domain/filesystem/VirtualFilesystem.ts";
import {
  CacheMetadata,
  CacheState,
  CatalogEntry,
  CatalogEntryKind,
  CatalogResponse,
} from "../generated/browser/browser.ts";
import { BrowserGrpcContext, csrfToken } from "./BrowserGrpcContext.ts";
import { HttpContentClient } from "./ContentClient.ts";

function catalogResponse(): CatalogResponse {
  const cache = CacheMetadata.create({
    state: CacheState.FRESH,
    fetchedAt: "2026-07-15T00:00:00.000Z",
    freshUntil: "2026-07-15T00:05:00.000Z",
    staleUntil: "2026-07-15T01:05:00.000Z",
  });

  const entries = [
    [CatalogEntryKind.DIRECTORY, "home", "~", 0, ""],
    [CatalogEntryKind.DIRECTORY, "projects", "~/projects", 0, ""],
    [CatalogEntryKind.DIRECTORY, "blog", "~/blog", 0, ""],
    [CatalogEntryKind.FILE, "about-document", "~/about.md", 42, "about"],
    [CatalogEntryKind.FILE, "publication-document", "~/blog/validated-metadata.md", 128, "blog-validated-metadata"],
  ] as const;

  const catalogEntries = entries.map(([kind, id, path, size, documentHandle], index) =>
    CatalogEntry.create({
      kind,
      id,
      path,
      updatedAt: `2026-07-15T00:00:0${index}.000Z`,
      size,
      documentHandle,
    }));

  return CatalogResponse.create({ entries: catalogEntries, cache });
}

function responseForPath(path: string): Response {
  switch (path) {
    case "/api/content/projects":
      return Response.json({"projects":[{"id":"sample-project","slug":"sample-project","name":"Sample Project","summary":"A validated project fixture.","url":"https://github.com/example-owner/sample-project","repository":"example-owner/sample-project","collectionPath":"validated/core","updatedAt":"2026-07-15T00:00:03.000Z","tags":["fsharp","typescript"],"readme":"# Sample Project README\n\nThis is the supplied README body, not the project summary."},{"id":"second-project","slug":"second-project","name":"Second Project","summary":"A second validated project fixture.","url":"https://github.com/example-owner/second-project","repository":"example-owner/second-project","collectionPath":"validated/examples","updatedAt":"2026-07-15T00:00:04.000Z","tags":["typescript"],"readme":"# Second Project README\n\nThis is a second supplied README body."}],"source":{"repository":"example-owner/content","path":"content/projects.json","revision":"main","url":"https://github.com/example-owner/content/blob/main/content/projects.json"},"cache":{"state":"fresh","fetchedAt":"2026-07-15T00:00:00.000Z","freshUntil":"2026-07-15T00:05:00.000Z","staleUntil":"2026-07-15T01:05:00.000Z"}});
    case "/api/content/now":
      return Response.json({"title":"Now","body":"# Now\n\nA validated current-status fixture.","updatedAt":"2026-07-15T00:00:04.000Z","source":{"repository":"example-owner/content","path":"content/now.md","revision":"main","url":"https://github.com/example-owner/content/blob/main/content/now.md"},"cache":{"state":"fresh","fetchedAt":"2026-07-15T00:00:00.000Z","freshUntil":"2026-07-15T00:05:00.000Z","staleUntil":"2026-07-15T01:05:00.000Z"}});
    case "/api/content/changelog":
      return Response.json({"unreleased":[{"sha":"0123456789abcdef0123456789abcdef01234567","summary":"Add validated content contracts","authoredAt":"2026-07-15T00:00:05.000Z","url":"https://github.com/example-owner/application/commit/0123456789abcdef0123456789abcdef01234567"}],"releases":[{"tag":"v1.0.0","name":"1.0.0","publishedAt":"2026-07-14T00:00:00.000Z","body":"Initial validated release.","url":"https://github.com/example-owner/application/releases/tag/v1.0.0","commits":[{"sha":"89abcdef0123456789abcdef0123456789abcdef","summary":"Initial release","authoredAt":"2026-07-14T00:00:00.000Z","url":"https://github.com/example-owner/application/commit/89abcdef0123456789abcdef0123456789abcdef"}]}],"source":{"repository":"example-owner/application","path":"releases","revision":"main","url":"https://github.com/example-owner/application/releases"},"cache":{"state":"fresh","fetchedAt":"2026-07-15T00:00:00.000Z","freshUntil":"2026-07-15T00:05:00.000Z","staleUntil":"2026-07-15T01:05:00.000Z"}});
    case "/api/content/document/about":
      return Response.json({"kind":"page","id":"about","path":"~/about.md","title":"About","updatedAt":"2026-07-15T00:00:03.000Z","body":"# About\n\nA validated shared content fixture.","source":{"repository":"example-owner/content","path":"content/about.md","revision":"main","url":"https://github.com/example-owner/content/blob/main/content/about.md"},"cache":{"state":"fresh","fetchedAt":"2026-07-15T00:00:00.000Z","freshUntil":"2026-07-15T00:05:00.000Z","staleUntil":"2026-07-15T01:05:00.000Z"}});
    case "/api/content/document/blog-validated-metadata":
      return Response.json({"kind":"blog","id":"blog-validated-metadata","slug":"validated-metadata","path":"~/blog/validated-metadata.md","title":"Validated Metadata","summary":"The supplied publication summary.","publishedAt":"2026-07-10T00:00:00.000Z","updatedAt":"2026-07-15T00:00:04.000Z","tags":["fsharp","content"],"body":"# Body Heading\n\nThis first body paragraph is not the supplied summary.","source":{"repository":"example-owner/content","path":"blog/validated-metadata.md","revision":"main","url":"https://github.com/example-owner/content/blob/main/blog/validated-metadata.md"},"cache":{"state":"fresh","fetchedAt":"2026-07-15T00:00:00.000Z","freshUntil":"2026-07-15T00:05:00.000Z","staleUntil":"2026-07-15T01:05:00.000Z"}});
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
    const grpcContext = new BrowserGrpcContext();
    const token = csrfToken("catalog-antiforgery-token");

    if (token === undefined) {
      assert.fail("Expected a valid catalog antiforgery fixture.");
    }

    grpcContext.recordCsrfToken(token);
    const grpcMetadata: RpcMetadata[] = [];
    const grpcSignals: Array<AbortSignal | undefined> = [];
    const client = new HttpContentClient(grpcContext, {
      readCatalog: (_request, options) => {
        grpcMetadata.push(options.meta);
        grpcSignals.push(options.abort);
        return { response: Promise.resolve(catalogResponse()) };
      },
    });
    const result = await client.loadCorpus(controller.signal);

    if (result.kind !== "available") {
      assert.fail(`Expected an available corpus, received ${result.kind}.`);
    }

    assert.deepEqual(new Set(paths), new Set([
      "/api/content/projects",
      "/api/content/now",
      "/api/content/changelog",
    ]));
    assert.equal(signals.every((signal) => signal === controller.signal), true);
    assert.deepEqual(grpcMetadata, [{ "X-CSRF-TOKEN": "catalog-antiforgery-token" }]);
    assert.deepEqual(grpcSignals, [controller.signal]);

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

    assert.equal(document.classification.kind, "page");
    assert.equal(document.document.text, "# About\n\nA validated shared content fixture.");
    assert.equal(paths.at(-1), "/api/content/document/about");

    const publication = resolveVirtualPath(
      result.corpus.filesystem,
      virtualHomeDirectory(),
      "blog/validated-metadata.md",
    );

    if (publication.kind !== "found" || publication.node.kind !== "file") {
      assert.fail("Expected the catalog's publication document.");
    }

    const publicationDocument = await result.corpus.documents.read(
      publication.node.documentHandle,
      controller.signal,
    );

    if (
      publicationDocument.kind !== "available" ||
      publicationDocument.classification.kind !== "publication"
    ) {
      assert.fail("Expected publication metadata from the content API.");
    }

    assert.equal(publication.node.updatedAt, "2026-07-15T00:00:04.000Z");
    assert.equal(
      publicationDocument.classification.publishedAt,
      "2026-07-10T00:00:00.000Z",
    );
    assert.equal(
      publicationDocument.classification.summary,
      "The supplied publication summary.",
    );
    assert.deepEqual(publicationDocument.classification.tags, ["fsharp", "content"]);
    assert.doesNotMatch(
      publicationDocument.document.text,
      /The supplied publication summary\./u,
    );
    assert.equal(paths.at(-1), "/api/content/document/blog-validated-metadata");

    const project = result.corpus.projectReadmes[0];

    assert.equal(project?.name, "Sample Project");
    assert.equal(project?.collectionPath, "validated/core");
    assert.equal(
      project?.document.text,
      "# Sample Project README\n\nThis is the supplied README body, not the project summary.",
    );
    assert.notEqual(project?.document.text, project?.summary);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
