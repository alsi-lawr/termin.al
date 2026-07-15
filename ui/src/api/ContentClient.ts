import type { MarkdownDocument } from "../content/MarkdownDocument.ts";
import {
  createVirtualFilesystem,
  type VirtualCorpusCatalog,
  type VirtualCorpusCatalogEntry,
  type VirtualDocumentReadResult,
  type VirtualDocumentSupplier,
  type VirtualFilesystem,
} from "../domain/filesystem/VirtualFilesystem.ts";
import { apiPathPrefix } from "./ApiPath.ts";
import {
  ContentId,
  type ContentCatalog,
  type ContentCatalogEntry,
  type ContentChangelog,
  type ContentDocument,
  type ContentNow,
  type ContentProblem,
  type ContentProjects,
  validateContentCatalog,
  validateContentChangelog,
  validateContentDocument,
  validateContentNow,
  validateContentProblem,
  validateContentProjects,
} from "./ContentContracts.ts";

export type ContentCorpus = Readonly<{
  filesystem: VirtualFilesystem;
  documents: VirtualDocumentSupplier;
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

type ContentRequestResult =
  | Readonly<{ kind: "payload"; payload: unknown }>
  | Readonly<{ kind: "problem"; problem: ContentProblem }>
  | Readonly<{ kind: "cancelled" }>
  | Readonly<{ kind: "failed"; message: string }>;

type ContentEndpointResult<Value> =
  | Readonly<{ kind: "available"; value: Value }>
  | Readonly<{ kind: "problem"; problem: ContentProblem }>
  | Readonly<{ kind: "cancelled" }>
  | Readonly<{ kind: "failed"; message: string }>;

type DerivedDocument = Readonly<{
  handle: string;
  path: string;
  updatedAt: string;
  text: string;
}>;

function isAbortError(value: unknown): boolean {
  return value instanceof Error && value.name === "AbortError";
}

function contentApiPath(path: string): string {
  return `${apiPathPrefix}/content/${path}`;
}

async function request(
  path: string,
  signal: AbortSignal,
): Promise<ContentRequestResult> {
  try {
    const response = await fetch(path, {
      signal,
      headers: { Accept: "application/json" },
    });
    const payload: unknown = await response.json();

    if (!response.ok) {
      const problem = validateContentProblem(payload);

      return problem.kind === "valid"
        ? { kind: "problem", problem: problem.value }
        : { kind: "failed", message: "The content API returned an invalid error response." };
    }

    return { kind: "payload", payload };
  } catch (error: unknown) {
    if (signal.aborted || isAbortError(error)) {
      return { kind: "cancelled" };
    }

    return { kind: "failed", message: "The content API could not be reached." };
  }
}

function catalogEntry(entry: ContentCatalogEntry): VirtualCorpusCatalogEntry {
  switch (entry.kind) {
    case "directory":
      return {
        kind: "directory",
        id: entry.id.value,
        path: entry.path.value,
        updatedAt: entry.updatedAt.value,
        size: entry.size.value,
      };
    case "locked-file":
      return {
        kind: "locked-file",
        id: entry.id.value,
        path: entry.path.value,
        updatedAt: entry.updatedAt.value,
        size: entry.size.value,
      };
    case "file":
      return {
        kind: "file",
        id: entry.id.value,
        path: entry.path.value,
        updatedAt: entry.updatedAt.value,
        size: entry.size.value,
        documentHandle: entry.documentHandle.value,
      };
  }
}

function byteSize(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function projectDocumentText(project: ContentProjects["projects"][number]): string {
  const tags = project.tags.map((tag) => `#${tag.value}`).join(" ");

  return [
    `# ${project.name}`,
    "",
    project.summary,
    "",
    `Repository: ${project.url.value}`,
    tags.length === 0 ? "" : `Tags: ${tags}`,
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

function changelogDocumentText(changelog: ContentChangelog): string {
  const lines = ["# Changelog", "", "## Unreleased"];

  for (const commit of changelog.unreleased) {
    lines.push(`- ${commit.summary} (${commit.sha.value.slice(0, 7)})`);
  }

  for (const release of changelog.releases) {
    lines.push("", `## ${release.name} (${release.tag.value})`);

    if (release.body.length > 0) {
      lines.push("", release.body);
    }

    for (const commit of release.commits) {
      lines.push(`- ${commit.summary} (${commit.sha.value.slice(0, 7)})`);
    }
  }

  return lines.join("\n");
}

function derivedDocuments(
  projects: ContentProjects,
  now: ContentNow,
  changelog: ContentChangelog,
): ReadonlyArray<DerivedDocument> {
  const documents: DerivedDocument[] = [
    {
      handle: "now-api",
      path: "~/now.md",
      updatedAt: now.updatedAt.value,
      text: now.body,
    },
    {
      handle: "changelog-api",
      path: "~/changelog.md",
      updatedAt: changelog.cache.fetchedAt.value,
      text: changelogDocumentText(changelog),
    },
  ];

  for (const project of projects.projects) {
    documents.push({
      handle: `project-${project.slug.value}`,
      path: `~/projects/${project.slug.value}.md`,
      updatedAt: project.updatedAt.value,
      text: projectDocumentText(project),
    });
  }

  return documents;
}

function virtualCatalog(
  catalog: ContentCatalog,
  documents: ReadonlyArray<DerivedDocument>,
): Readonly<{
  catalog: VirtualCorpusCatalog;
  documentsByHandle: ReadonlyMap<string, MarkdownDocument>;
}> {
  const entries = catalog.entries.map(catalogEntry);
  const paths = new Set(entries.map((entry) => entry.path));
  const ids = new Set(entries.map((entry) => entry.id));
  const handles = new Set(
    entries.flatMap((entry) =>
      entry.kind === "file" ? [entry.documentHandle] : [],
    ),
  );
  const documentsByHandle = new Map<string, MarkdownDocument>();

  const projectsDocument = documents.some((document) =>
    document.path.startsWith("~/projects/"),
  );

  if (projectsDocument && !paths.has("~/projects")) {
    entries.push({
      kind: "directory",
      id: "projects-api-directory",
      path: "~/projects",
      updatedAt: catalog.cache.fetchedAt.value,
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

export class HttpContentClient implements ContentClient {
  private async catalog(
    signal: AbortSignal,
  ): Promise<ContentEndpointResult<ContentCatalog>> {
    const response = await request(contentApiPath("catalog"), signal);

    switch (response.kind) {
      case "payload": {
        const validation = validateContentCatalog(response.payload);

        return validation.kind === "valid"
          ? { kind: "available", value: validation.value }
          : { kind: "failed", message: "The catalog response is invalid." };
      }
      case "problem":
      case "cancelled":
      case "failed":
        return response;
    }
  }

  private async projects(
    signal: AbortSignal,
  ): Promise<ContentEndpointResult<ContentProjects>> {
    const response = await request(contentApiPath("projects"), signal);

    switch (response.kind) {
      case "payload": {
        const validation = validateContentProjects(response.payload);

        return validation.kind === "valid"
          ? { kind: "available", value: validation.value }
          : { kind: "failed", message: "The projects response is invalid." };
      }
      case "problem":
      case "cancelled":
      case "failed":
        return response;
    }
  }

  private async now(
    signal: AbortSignal,
  ): Promise<ContentEndpointResult<ContentNow>> {
    const response = await request(contentApiPath("now"), signal);

    switch (response.kind) {
      case "payload": {
        const validation = validateContentNow(response.payload);

        return validation.kind === "valid"
          ? { kind: "available", value: validation.value }
          : { kind: "failed", message: "The Now response is invalid." };
      }
      case "problem":
      case "cancelled":
      case "failed":
        return response;
    }
  }

  private async changelog(
    signal: AbortSignal,
  ): Promise<ContentEndpointResult<ContentChangelog>> {
    const response = await request(contentApiPath("changelog"), signal);

    switch (response.kind) {
      case "payload": {
        const validation = validateContentChangelog(response.payload);

        return validation.kind === "valid"
          ? { kind: "available", value: validation.value }
          : { kind: "failed", message: "The changelog response is invalid." };
      }
      case "problem":
      case "cancelled":
      case "failed":
        return response;
    }
  }

  private async readDocument(
    id: ContentId,
    signal: AbortSignal,
  ): Promise<ContentEndpointResult<ContentDocument>> {
    const response = await request(
      contentApiPath(`document/${encodeURIComponent(id.value)}`),
      signal,
    );

    switch (response.kind) {
      case "payload": {
        const validation = validateContentDocument(response.payload);

        return validation.kind === "valid"
          ? { kind: "available", value: validation.value }
          : { kind: "failed", message: "The document response is invalid." };
      }
      case "problem":
      case "cancelled":
      case "failed":
        return response;
    }
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

    const problem = [catalog, projects, now, changelog].find(
      (result) => result.kind === "problem",
    );

    if (problem !== undefined && problem.kind === "problem") {
      return { kind: "failed", message: problem.problem.title };
    }

    const failure = [catalog, projects, now, changelog].find(
      (result) => result.kind === "failed",
    );

    if (failure !== undefined && failure.kind === "failed") {
      return { kind: "failed", message: failure.message };
    }

    if (
      catalog.kind !== "available" ||
      projects.kind !== "available" ||
      now.kind !== "available" ||
      changelog.kind !== "available"
    ) {
      return { kind: "failed", message: "The content API returned an incomplete response." };
    }

    try {
      const derived = derivedDocuments(
        projects.value,
        now.value,
        changelog.value,
      );
      const virtual = virtualCatalog(catalog.value, derived);
      const filesystem = createVirtualFilesystem(virtual.catalog);
      const documents = this.documentSupplier(virtual.documentsByHandle);
      const corpus = { filesystem, documents };

      if (virtual.catalog.entries.length === 1) {
        return { kind: "empty" };
      }

      return freshness(catalog.value, projects.value, now.value, changelog.value) ===
        "stale"
        ? { kind: "stale", corpus }
        : { kind: "available", corpus };
    } catch (error: unknown) {
      if (signal.aborted || isAbortError(error)) {
        return { kind: "cancelled" };
      }

      return { kind: "failed", message: "The content corpus could not be assembled." };
    }
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
          return { kind: "available", document: local };
        }

        const id = ContentId.tryCreate(handle, "document handle");

        if (id.kind === "invalid") {
          return { kind: "missing", handle };
        }

        const result = await this.readDocument(id.value, signal);

        switch (result.kind) {
          case "available":
            return {
              kind: "available",
              document: {
                text: result.value.body,
                source: { path: result.value.path.value },
              },
            };
          case "cancelled":
            return { kind: "cancelled" };
          case "problem":
          case "failed":
            return { kind: "missing", handle };
        }
      },
    };
  }
}
