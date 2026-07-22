import type { MarkdownDocument } from "../content/MarkdownDocument.ts";
import {
  createVirtualTimestamp,
  createVirtualFilesystem,
  type VirtualCorpusCatalog,
  type VirtualCorpusCatalogEntry,
  type VirtualDocumentReadResult,
  type VirtualDocumentSupplier,
  type VirtualFilesystem,
} from "../domain/filesystem/VirtualFilesystem.ts";
import {
  CacheState,
  CatalogEntryKind,
  DocumentKind,
  type CacheMetadata as GrpcCacheMetadata,
  type CatalogEntry as GrpcCatalogEntry,
  type ChangelogResponse,
  type Commit as GrpcCommit,
  type CatalogResponse,
  type DocumentResponse,
  type NowResponse,
  type Project as GrpcProject,
  type ProjectsResponse,
  type RepositoryBaseResponse,
  type Release as GrpcRelease,
} from "../generated/browser/browser.ts";
import { ContentApiClient } from "../generated/browser/browser.client.ts";
import type { RpcMetadata } from "@protobuf-ts/runtime-rpc";
import { BrowserGrpcContext, createBrowserGrpcTransport } from "./BrowserGrpcContext.ts";
import { ContentId } from "./ContentContracts.ts";

export type ProjectReadme = Readonly<{
  id: string;
  name: string;
  summary: string;
  repository: string;
  collectionPath: string;
  repositoryUrl: string;
  tags: ReadonlyArray<string>;
  document: MarkdownDocument;
}>;

export type ContentCorpus = Readonly<{
  filesystem: VirtualFilesystem;
  documents: VirtualDocumentSupplier;
  projectReadmes: ReadonlyArray<ProjectReadme>;
  repositoryBase:
    | Readonly<{
        kind: "available";
        read: (signal: AbortSignal) => Promise<ContentEndpointResult<Readonly<{ defaultBranch: string; headSha: string }>>>;
      }>
    | Readonly<{ kind: "unavailable" }>;
}>;

export type ContentCorpusLoadResult =
  | Readonly<{ kind: "available"; corpus: ContentCorpus }>
  | Readonly<{ kind: "stale"; corpus: ContentCorpus }>
  | Readonly<{ kind: "empty" }>
  | Readonly<{ kind: "cancelled" }>
  | Readonly<{ kind: "failed"; message: string }>;

export type ContentClient = Readonly<{
  loadCorpus: (signal: AbortSignal) => Promise<ContentCorpusLoadResult>;
}>;

type ContentEndpointResult<Value> =
  | Readonly<{ kind: "available"; value: Value }>
  | Readonly<{ kind: "cancelled" }>
  | Readonly<{ kind: "failed"; message: string }>;

type ContentCache = Readonly<{
  state: "fresh" | "stale";
  fetchedAt: string;
  freshUntil: string;
  staleUntil: string;
}>;

type ContentCatalog = Readonly<{
  entries: ReadonlyArray<VirtualCorpusCatalogEntry>;
  cache: ContentCache;
}>;

type ContentProject = Readonly<{
  id: string;
  name: string;
  summary: string;
  repository: string;
  collectionPath: string;
  url: string;
  tags: ReadonlyArray<string>;
  readme: string;
}>;

type ContentProjects = Readonly<{
  projects: ReadonlyArray<ContentProject>;
  cache: ContentCache;
}>;

type ContentNow = Readonly<{
  body: string;
  updatedAt: string;
  cache: ContentCache;
}>;

type ContentCommit = Readonly<{
  sha: string;
  summary: string;
}>;

type ContentRelease = Readonly<{
  tag: string;
  name: string;
  publishedAt: string;
  body: string;
  commits: ReadonlyArray<ContentCommit>;
}>;

type ContentChangelog = Readonly<{
  unreleased: ReadonlyArray<ContentCommit>;
  releases: ReadonlyArray<ContentRelease>;
  cache: ContentCache;
}>;

type ContentDocument =
  | Readonly<{ kind: "page"; path: string; body: string }>
  | Readonly<{
      kind: "blog" | "note";
      path: string;
      body: string;
      slug: string;
      title: string;
      summary: string;
      updatedAt: string;
      tags: ReadonlyArray<string>;
      base: Readonly<{
        defaultBranch: string;
        headSha: string;
        blobSha: string;
        repositoryPath: string;
        virtualPath: string;
      }>;
    }>;

type DerivedDocument = Readonly<{
  handle: string;
  path: string;
  updatedAt: string;
  text: string;
}>;

type ContentRpcClient = Readonly<{
  readRepositoryBase: (
    request: Readonly<Record<string, never>>,
    options: Readonly<{ meta: RpcMetadata; abort: AbortSignal }>,
  ) => Readonly<{ response: Promise<RepositoryBaseResponse> }>;
  readCatalog: (
    request: Readonly<Record<string, never>>,
    options: Readonly<{ meta: RpcMetadata; abort: AbortSignal }>,
  ) => Readonly<{ response: Promise<CatalogResponse> }>;
  readDocument: (
    request: Readonly<{ id: string }>,
    options: Readonly<{ meta: RpcMetadata; abort: AbortSignal }>,
  ) => Readonly<{ response: Promise<DocumentResponse> }>;
  readProjects: (
    request: Readonly<Record<string, never>>,
    options: Readonly<{ meta: RpcMetadata; abort: AbortSignal }>,
  ) => Readonly<{ response: Promise<ProjectsResponse> }>;
  readNow: (
    request: Readonly<Record<string, never>>,
    options: Readonly<{ meta: RpcMetadata; abort: AbortSignal }>,
  ) => Readonly<{ response: Promise<NowResponse> }>;
  readChangelog: (
    request: Readonly<Record<string, never>>,
    options: Readonly<{ meta: RpcMetadata; abort: AbortSignal }>,
  ) => Readonly<{ response: Promise<ChangelogResponse> }>;
}>;

function grpcCatalogEntryKind(kind: CatalogEntryKind): "directory" | "file" | "locked-file" {
  switch (kind) {
    case CatalogEntryKind.DIRECTORY:
      return "directory";
    case CatalogEntryKind.FILE:
      return "file";
    case CatalogEntryKind.LOCKED_FILE:
      return "locked-file";
    case CatalogEntryKind.UNSPECIFIED:
    default:
      throw new Error("The generated catalog entry kind is unsupported.");
  }
}

function grpcCacheState(state: CacheState): "fresh" | "stale" {
  switch (state) {
    case CacheState.FRESH:
      return "fresh";
    case CacheState.STALE:
      return "stale";
    case CacheState.UNSPECIFIED:
    default:
      throw new Error("The generated cache state is unsupported.");
  }
}

function mapCache(value: GrpcCacheMetadata): ContentCache {
  return {
    state: grpcCacheState(value.state),
    fetchedAt: value.fetchedAt,
    freshUntil: value.freshUntil,
    staleUntil: value.staleUntil,
  };
}

function mapCatalogEntry(entry: GrpcCatalogEntry): VirtualCorpusCatalogEntry {
  const kind = grpcCatalogEntryKind(entry.kind);

  if (kind === "file") {
    return {
      kind,
      id: entry.id,
      path: entry.path,
      updatedAt: entry.updatedAt,
      size: entry.size,
      documentHandle: entry.documentHandle,
    };
  }

  return {
    kind,
    id: entry.id,
    path: entry.path,
    updatedAt: entry.updatedAt,
    size: entry.size,
  };
}

function mapProject(value: GrpcProject): ContentProject {
  return {
    id: value.id,
    name: value.name,
    summary: value.summary,
    repository: value.repository,
    collectionPath: value.collectionPath,
    url: value.url,
    tags: value.tags,
    readme: value.readme,
  };
}

function mapCommit(value: GrpcCommit): ContentCommit {
  return { sha: value.sha, summary: value.summary };
}

function mapRelease(value: GrpcRelease): ContentRelease {
  return {
    tag: value.tag,
    name: value.name,
    publishedAt: value.publishedAt,
    body: value.body,
    commits: value.commits.map(mapCommit),
  };
}

function mapDocument(value: DocumentResponse): ContentDocument {
  switch (value.kind) {
    case DocumentKind.PAGE:
      return { kind: "page", path: value.path, body: value.body };
    case DocumentKind.BLOG:
    case DocumentKind.NOTE:
      return {
        kind: value.kind === DocumentKind.BLOG ? "blog" : "note",
        path: value.path,
        body: value.body,
        slug: value.slug,
        title: value.title,
        summary: value.summary,
        updatedAt: value.updatedAt,
        tags: value.tags,
        base: value.base!,
      };
    case DocumentKind.UNSPECIFIED:
    default:
      throw new Error("The generated document kind is unsupported.");
  }
}

function isAbortError(value: unknown): boolean {
  return value instanceof Error && value.name === "AbortError";
}

function byteSize(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function changelogDocumentText(changelog: ContentChangelog): string {
  const lines = ["# Changelog", "", "## Unreleased"];

  for (const commit of changelog.unreleased) {
    lines.push(`- ${commit.summary} (${commit.sha.slice(0, 7)})`);
  }

  for (const release of changelog.releases) {
    lines.push("", `## ${release.name} (${release.tag})`);

    if (release.body.length > 0) {
      lines.push("", release.body);
    }

    for (const commit of release.commits) {
      lines.push(`- ${commit.summary} (${commit.sha.slice(0, 7)})`);
    }
  }

  return lines.join("\n");
}

function derivedDocuments(
  now: ContentNow,
  changelog: ContentChangelog,
): ReadonlyArray<DerivedDocument> {
  return [
    {
      handle: "now-api",
      path: "~/now.md",
      updatedAt: now.updatedAt,
      text: now.body,
    },
    {
      handle: "changelog-api",
      path: "~/changelog.md",
      updatedAt: changelog.cache.fetchedAt,
      text: changelogDocumentText(changelog),
    },
  ];
}

function createProjectReadmes(
  projects: ContentProjects,
): ReadonlyArray<ProjectReadme> {
  return projects.projects.map((project) => ({
    id: project.id,
    name: project.name,
    summary: project.summary,
    repository: project.repository,
    collectionPath: project.collectionPath,
    repositoryUrl: project.url,
    tags: project.tags,
    document: {
      text: project.readme,
      source: { path: project.url },
    },
  }));
}

function virtualCatalog(
  catalog: ContentCatalog,
  documents: ReadonlyArray<DerivedDocument>,
  projectReadmes: ReadonlyArray<ProjectReadme>,
): Readonly<{
  catalog: VirtualCorpusCatalog;
  documentsByHandle: ReadonlyMap<string, MarkdownDocument>;
}> {
  const entries = [...catalog.entries];
  const paths = new Set(entries.map((entry) => entry.path));
  const ids = new Set(entries.map((entry) => entry.id));
  const handles = new Set(
    entries.flatMap((entry) =>
      entry.kind === "file" ? [entry.documentHandle] : [],
    ),
  );
  const documentsByHandle = new Map<string, MarkdownDocument>();

  if (projectReadmes.length > 0 && !paths.has("~/projects")) {
    entries.push({
      kind: "directory",
      id: "projects-api-directory",
      path: "~/projects",
      updatedAt: catalog.cache.fetchedAt,
      size: 0,
    });
    paths.add("~/projects");
    ids.add("projects-api-directory");
  }

  for (const document of documents) {
    const identifier = `${document.handle}-document`;

    if (
      paths.has(document.path) ||
      ids.has(identifier) ||
      handles.has(document.handle)
    ) {
      continue;
    }

    entries.push({
      kind: "file",
      id: identifier,
      path: document.path,
      updatedAt: document.updatedAt,
      size: byteSize(document.text),
      documentHandle: document.handle,
    });
    paths.add(document.path);
    ids.add(identifier);
    handles.add(document.handle);
    documentsByHandle.set(document.handle, {
      text: document.text,
      source: { path: document.path },
    });
  }

  return { catalog: { entries }, documentsByHandle };
}

function freshness(
  catalog: ContentCatalog,
  projects: ContentProjects,
  now: ContentNow,
  changelog: ContentChangelog,
): "fresh" | "stale" {
  return catalog.cache.state === "stale" ||
    projects.cache.state === "stale" ||
    now.cache.state === "stale" ||
    changelog.cache.state === "stale"
    ? "stale"
    : "fresh";
}

export class GrpcContentClient implements ContentClient {
  private readonly context: BrowserGrpcContext;
  private readonly client: ContentRpcClient;

  constructor(
    context: BrowserGrpcContext = new BrowserGrpcContext(),
    client: ContentRpcClient = new ContentApiClient(createBrowserGrpcTransport()),
  ) {
    this.context = context;
    this.client = client;
  }

  private async catalog(
    signal: AbortSignal,
  ): Promise<ContentEndpointResult<ContentCatalog>> {
    let response: CatalogResponse;

    try {
      response = await this.client.readCatalog(
        {},
        { meta: this.context.metadata(), abort: signal },
      ).response;
    } catch (error: unknown) {
      if (signal.aborted || isAbortError(error)) {
        return { kind: "cancelled" };
      }

      return { kind: "failed", message: "The content API could not be reached." };
    }

    return {
      kind: "available",
      value: {
        entries: response.entries.map(mapCatalogEntry),
        cache: mapCache(response.cache!),
      },
    };
  }

  private async repositoryBase(signal: AbortSignal): Promise<ContentEndpointResult<Readonly<{ defaultBranch: string; headSha: string }>>> {
    try {
      const response = await this.client.readRepositoryBase({}, { meta: this.context.metadata(), abort: signal }).response;
      return { kind: "available", value: response };
    } catch (error: unknown) {
      return signal.aborted || isAbortError(error)
        ? { kind: "cancelled" }
        : { kind: "failed", message: "The content API could not be reached." };
    }
  }

  private async projects(
    signal: AbortSignal,
  ): Promise<ContentEndpointResult<ContentProjects>> {
    let response: ProjectsResponse;

    try {
      response = await this.client.readProjects(
        {},
        { meta: this.context.metadata(), abort: signal },
      ).response;
    } catch (error: unknown) {
      return signal.aborted || isAbortError(error)
        ? { kind: "cancelled" }
        : { kind: "failed", message: "The content API could not be reached." };
    }

    return {
      kind: "available",
      value: {
        projects: response.projects.map(mapProject),
        cache: mapCache(response.cache!),
      },
    };
  }

  private async now(
    signal: AbortSignal,
  ): Promise<ContentEndpointResult<ContentNow>> {
    let response: NowResponse;

    try {
      response = await this.client.readNow(
        {},
        { meta: this.context.metadata(), abort: signal },
      ).response;
    } catch (error: unknown) {
      return signal.aborted || isAbortError(error)
        ? { kind: "cancelled" }
        : { kind: "failed", message: "The content API could not be reached." };
    }

    return {
      kind: "available",
      value: {
        body: response.body,
        updatedAt: response.updatedAt,
        cache: mapCache(response.cache!),
      },
    };
  }

  private async changelog(
    signal: AbortSignal,
  ): Promise<ContentEndpointResult<ContentChangelog>> {
    let response: ChangelogResponse;

    try {
      response = await this.client.readChangelog(
        {},
        { meta: this.context.metadata(), abort: signal },
      ).response;
    } catch (error: unknown) {
      return signal.aborted || isAbortError(error)
        ? { kind: "cancelled" }
        : { kind: "failed", message: "The content API could not be reached." };
    }

    return {
      kind: "available",
      value: {
        unreleased: response.unreleased.map(mapCommit),
        releases: response.releases.map(mapRelease),
        cache: mapCache(response.cache!),
      },
    };
  }

  private async readDocument(
    id: ContentId,
    signal: AbortSignal,
  ): Promise<ContentEndpointResult<ContentDocument>> {
    let response: DocumentResponse;

    try {
      response = await this.client.readDocument(
        { id: id.value },
        { meta: this.context.metadata(), abort: signal },
      ).response;
    } catch (error: unknown) {
      return signal.aborted || isAbortError(error)
        ? { kind: "cancelled" }
        : { kind: "failed", message: "The content API could not be reached." };
    }

    return { kind: "available", value: mapDocument(response) };
  }

  async loadCorpus(signal: AbortSignal): Promise<ContentCorpusLoadResult> {
    const [catalog, projects, now, changelog] = await Promise.all([
      this.catalog(signal),
      this.projects(signal),
      this.now(signal),
      this.changelog(signal),
    ]);

    if (
      catalog.kind === "cancelled" ||
      projects.kind === "cancelled" ||
      now.kind === "cancelled" ||
      changelog.kind === "cancelled"
    ) {
      return { kind: "cancelled" };
    }

    if (catalog.kind === "failed") {
      return catalog;
    }

    if (projects.kind === "failed") {
      return projects;
    }

    if (now.kind === "failed") {
      return now;
    }

    if (changelog.kind === "failed") {
      return changelog;
    }

    const projectReadmes = createProjectReadmes(projects.value);
    const derived = derivedDocuments(now.value, changelog.value);
    const virtual = virtualCatalog(catalog.value, derived, projectReadmes);
    const filesystem = createVirtualFilesystem(virtual.catalog);
    const documents = this.documentSupplier(virtual.documentsByHandle);
    const corpus = {
      filesystem,
      documents,
      projectReadmes,
      repositoryBase: { kind: "available", read: (readSignal: AbortSignal) => this.repositoryBase(readSignal) },
    } as const;

    if (virtual.catalog.entries.length === 1) {
      return { kind: "empty" };
    }

    return freshness(catalog.value, projects.value, now.value, changelog.value) ===
      "stale"
      ? { kind: "stale", corpus }
      : { kind: "available", corpus };
  }

  private documentSupplier(
    localDocuments: ReadonlyMap<string, MarkdownDocument>,
  ): VirtualDocumentSupplier {
    return {
      read: async (
        handle,
        signal,
      ): Promise<VirtualDocumentReadResult> => {
        if (signal.aborted) {
          return { kind: "cancelled" };
        }

        const local = localDocuments.get(handle);

        if (local !== undefined) {
          return {
            kind: "available",
            document: local,
            classification: { kind: "page" },
          };
        }

        const result = await this.readDocument(ContentId.fromGenerated(handle), signal);

        switch (result.kind) {
          case "available": {
            const document = {
              text: result.value.body,
              source: { path: result.value.path },
            };

            if (result.value.kind === "page") {
              return {
                kind: "available",
                document,
                classification: { kind: "page" },
              };
            }

            return {
              kind: "available",
              document,
              classification: {
                kind: "publication",
                publicationKind: result.value.kind,
                slug: result.value.slug,
                title: result.value.title,
                summary: result.value.summary,
                updatedAt: createVirtualTimestamp(result.value.updatedAt),
                tags: result.value.tags,
                repositorySource: {
                  kind: "authoring-base",
                  repositoryPath: result.value.base.repositoryPath,
                  virtualPath: result.value.base.virtualPath,
                  defaultBranch: result.value.base.defaultBranch,
                  headSha: result.value.base.headSha,
                  blobSha: result.value.base.blobSha,
                },
              },
            };
          }
          case "cancelled":
            return { kind: "cancelled" };
          case "failed":
            return { kind: "missing", handle };
        }
      },
    };
  }
}
