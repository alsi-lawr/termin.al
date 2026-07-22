import assert from "node:assert/strict";
import test from "node:test";
import type { RpcMetadata } from "@protobuf-ts/runtime-rpc";
import {
  CacheMetadata,
  CacheState,
  CatalogEntry,
  CatalogEntryKind,
  CatalogResponse,
  ChangelogResponse,
  Commit,
  ContentSource,
  DocumentKind,
  DocumentResponse,
  NowResponse,
  Project,
  ProjectsResponse,
  Release,
} from "../generated/browser/browser.ts";
import {
  resolveVirtualPath,
  virtualHomeDirectory,
} from "../domain/filesystem/VirtualFilesystem.ts";
import { BrowserGrpcContext, csrfToken } from "./BrowserGrpcContext.ts";
import { HttpContentClient } from "./ContentClient.ts";

const cache = CacheMetadata.create({
  state: CacheState.FRESH,
  fetchedAt: "2026-07-15T00:00:00.000Z",
  freshUntil: "2026-07-15T00:05:00.000Z",
  staleUntil: "2026-07-15T01:05:00.000Z",
});
const source = ContentSource.create({
  repository: "example-owner/content",
  path: "content/catalog.json",
  revision: "main",
  url: "https://github.com/example-owner/content/blob/main/content/catalog.json",
});

function catalogResponse(): CatalogResponse {
  const entries = [
    [CatalogEntryKind.DIRECTORY, "home", "~", 0, ""],
    [CatalogEntryKind.DIRECTORY, "projects", "~/projects", 0, ""],
    [CatalogEntryKind.DIRECTORY, "blog", "~/blog", 0, ""],
    [CatalogEntryKind.FILE, "about-document", "~/about.md", 42, "about"],
    [CatalogEntryKind.FILE, "publication-document", "~/blog/validated-metadata.md", 128, "blog-validated-metadata"],
  ] as const;

  return CatalogResponse.create({
    source,
    cache,
    entries: entries.map(([kind, id, path, size, documentHandle], index) =>
      CatalogEntry.create({
        kind,
        id,
        path,
        updatedAt: `2026-07-15T00:00:0${index}.000Z`,
        size,
        documentHandle,
      })),
  });
}

function generatedClient(calls: Array<Readonly<{ method: string; meta: RpcMetadata; abort: AbortSignal }>>) {
  const call = <Value>(method: string, value: Value, options: Readonly<{ meta: RpcMetadata; abort: AbortSignal }>) => {
    calls.push({ method, meta: options.meta, abort: options.abort });
    return { response: Promise.resolve(value) };
  };

  return {
    readCatalog: (_request: Readonly<Record<string, never>>, options: Readonly<{ meta: RpcMetadata; abort: AbortSignal }>) =>
      call("catalog", catalogResponse(), options),
    readProjects: (_request: Readonly<Record<string, never>>, options: Readonly<{ meta: RpcMetadata; abort: AbortSignal }>) =>
      call("projects", ProjectsResponse.create({
        source: ContentSource.create({ ...source, path: "content/projects.json" }),
        cache,
        projects: [Project.create({
          id: "sample-project",
          slug: "sample-project",
          name: "Sample Project",
          summary: "A validated project fixture.",
          url: "https://github.com/example-owner/sample-project",
          repository: "example-owner/sample-project",
          collectionPath: "validated/core",
          updatedAt: "2026-07-15T00:00:03.000Z",
          tags: ["fsharp", "typescript"],
          readme: "# Sample Project README\n\nSupplied README.",
        })],
      }), options),
    readNow: (_request: Readonly<Record<string, never>>, options: Readonly<{ meta: RpcMetadata; abort: AbortSignal }>) =>
      call("now", NowResponse.create({
        title: "Now",
        body: "# Now\n\nCurrent status.",
        updatedAt: "2026-07-15T00:00:04.000Z",
        source: ContentSource.create({ ...source, path: "content/now.md" }),
        cache,
      }), options),
    readChangelog: (_request: Readonly<Record<string, never>>, options: Readonly<{ meta: RpcMetadata; abort: AbortSignal }>) =>
      call("changelog", ChangelogResponse.create({
        source: ContentSource.create({ ...source, repository: "example-owner/application", path: "releases" }),
        cache,
        unreleased: [Commit.create({ sha: "0123456789abcdef0123456789abcdef01234567", summary: "Add contracts" })],
        releases: [Release.create({
          tag: "v1.0.0",
          name: "1.0.0",
          publishedAt: "2026-07-14T09:30:00.000Z",
          body: "Initial release.",
          commits: [],
        })],
      }), options),
    readDocument: (request: Readonly<{ id: string }>, options: Readonly<{ meta: RpcMetadata; abort: AbortSignal }>) => {
      const publication = request.id === "blog-validated-metadata";
      return call("document", DocumentResponse.create({
        kind: publication ? DocumentKind.BLOG : DocumentKind.PAGE,
        id: request.id,
        slug: publication ? "validated-metadata" : "",
        path: publication ? "~/blog/validated-metadata.md" : "~/about.md",
        title: publication ? "Validated Metadata" : "About",
        summary: publication ? "The supplied publication summary." : "",
        updatedAt: publication ? "2026-07-15T00:00:04.000Z" : "2026-07-15T00:00:03.000Z",
        tags: publication ? ["fsharp", "content"] : [],
        body: publication ? "# Body Heading\n\nPublication body." : "# About\n\nShared content.",
        source: ContentSource.create({
          ...source,
          path: publication ? "blog/validated-metadata.md" : "content/about.md",
        }),
        cache,
      }), options);
    },
  };
}

test("loads every content slice through one narrow generated client", async () => {
  const controller = new AbortController();
  const context = new BrowserGrpcContext();
  const token = csrfToken("catalog-antiforgery-token");
  if (token === undefined) assert.fail("Expected valid antiforgery fixture.");
  context.recordCsrfToken(token);
  const calls: Array<Readonly<{ method: string; meta: RpcMetadata; abort: AbortSignal }>> = [];
  const client = new HttpContentClient(context, generatedClient(calls));
  const result = await client.loadCorpus(controller.signal);
  if (result.kind !== "available") assert.fail(`Expected corpus, received ${result.kind}.`);

  assert.deepEqual(calls.map((entry) => entry.method), ["catalog", "projects", "now", "changelog"]);
  assert.equal(calls.every((entry) => entry.abort === controller.signal), true);
  assert.equal(calls.every((entry) => entry.meta["X-CSRF-TOKEN"] === "catalog-antiforgery-token"), true);

  const publication = resolveVirtualPath(result.corpus.filesystem, virtualHomeDirectory(), "blog/validated-metadata.md");
  if (publication.kind !== "found" || publication.node.kind !== "file") assert.fail("Expected publication.");
  const document = await result.corpus.documents.read(publication.node.documentHandle, controller.signal);
  if (document.kind !== "available" || document.classification.kind !== "publication") assert.fail("Expected publication metadata.");
  assert.equal(document.classification.updatedAt, publication.node.updatedAt);
  assert.equal(calls.at(-1)?.method, "document");
});

test("rejects incomplete catalog source and cache metadata", async () => {
  const response = catalogResponse();
  response.source = ContentSource.create({ ...source, repository: "" });
  const base = generatedClient([]);
  const client = new HttpContentClient(new BrowserGrpcContext(), {
    ...base,
    readCatalog: () => ({ response: Promise.resolve(response) }),
  });
  const result = await client.loadCorpus(new AbortController().signal);
  assert.equal(result.kind, "failed");
});

test("rejects a changelog release without generated chronology metadata", async () => {
  const base = generatedClient([]);
  const client = new HttpContentClient(new BrowserGrpcContext(), {
    ...base,
    readChangelog: () => ({
      response: Promise.resolve(ChangelogResponse.create({
        source: ContentSource.create({ ...source, repository: "example-owner/application", path: "releases" }),
        cache,
        releases: [Release.create({ tag: "v1.0.0", name: "1.0.0", body: "Missing chronology." })],
      })),
    }),
  });

  const result = await client.loadCorpus(new AbortController().signal);
  assert.equal(result.kind, "failed");
});
