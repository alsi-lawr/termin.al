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
import { apiPathPrefix } from "./ApiPath.ts";
import {
  ContentId,
  type ContentValidation,
} from "./ContentContracts.ts";

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

type ContentCache = Readonly<{
  state: "fresh" | "stale";
  fetchedAt: string;
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
      publishedAt: string;
      tags: ReadonlyArray<string>;
    }>;

type ContentProblem = Readonly<{ title: string }>;

type ProjectCandidate = Readonly<{
  project: ContentProject;
  slug: string;
}>;

type DerivedDocument = Readonly<{
  handle: string;
  path: string;
  updatedAt: string;
  text: string;
}>;

const contentDocumentByteLimit = 1_048_576;
const contentPageItemLimit = 100;
const stableIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;
const pathSegmentPattern = /^[A-Za-z0-9._-]{1,128}$/u;
const tagPattern = /^[A-Za-z0-9._-]{1,128}$/u;
const slugPattern = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const commitShaPattern = /^[0-9a-f]{7,64}$/u;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function valid<Value>(value: Value): ContentValidation<Value> {
  return { kind: "valid", value };
}

function invalid<Value>(message: string): ContentValidation<Value> {
  return { kind: "invalid", message };
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function property(value: object, name: string): unknown {
  return Object.hasOwn(value, name) ? Reflect.get(value, name) : undefined;
}

function isStableIdentifier(value: unknown): value is string {
  return typeof value === "string" && stableIdentifierPattern.test(value);
}

function isVirtualPath(value: unknown): value is string {
  if (value === "~") {
    return true;
  }

  return typeof value === "string" &&
    value.startsWith("~/") &&
    value.length <= 512 &&
    !value.includes("\u0000") &&
    value.slice(2).split("/").every(
      (segment) => segment !== "." && segment !== ".." && pathSegmentPattern.test(segment),
    );
}

function isRelativePath(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    !value.startsWith("/") &&
    value.length <= 512 &&
    value.split("/").every(
      (segment) => segment !== "." && segment !== ".." && pathSegmentPattern.test(segment),
    );
}

function isRepositoryName(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const segments = value.split("/");
  const repositorySegmentPattern = /^[A-Za-z0-9._-]{1,100}$/u;

  return segments.length === 2 &&
    segments.every((segment) => repositorySegmentPattern.test(segment));
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username.length === 0 && url.password.length === 0;
  } catch {
    return false;
  }
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !timestampPattern.test(value)) {
    return false;
  }

  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function isSingleLine(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maximumLength &&
    !value.includes("\r") &&
    !value.includes("\n") &&
    !value.includes("\u0000");
}

function isSummary(value: unknown): value is string {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= 500 &&
    !value.includes("\u0000");
}

function isBody(value: unknown, required: boolean): value is string {
  return typeof value === "string" &&
    (!required || value.trim().length > 0) &&
    !value.includes("\u0000") &&
    new TextEncoder().encode(value).byteLength <= contentDocumentByteLimit;
}

function decodeTags(value: unknown, field: string): ContentValidation<ReadonlyArray<string>> {
  if (!Array.isArray(value)) {
    return invalid(`${field} must be an array.`);
  }

  const tags: string[] = [];
  const seen = new Set<string>();

  for (const candidate of value) {
    if (typeof candidate !== "string" || !tagPattern.test(candidate) || seen.has(candidate)) {
      return invalid(`${field} must contain unique bounded tags.`);
    }

    seen.add(candidate);
    tags.push(candidate);
  }

  return valid(tags);
}

function decodeCache(value: unknown): ContentValidation<ContentCache> {
  if (!isObject(value)) {
    return invalid("cache must be an object.");
  }

  const state = property(value, "state");
  const fetchedAt = property(value, "fetchedAt");

  if ((state !== "fresh" && state !== "stale") || !isTimestamp(fetchedAt)) {
    return invalid("cache fields are invalid.");
  }

  return valid({ state, fetchedAt });
}

function decodeCatalogEntry(value: unknown): ContentValidation<VirtualCorpusCatalogEntry> {
  if (!isObject(value)) {
    return invalid("catalog entry must be an object.");
  }

  const kind = property(value, "kind");
  const id = property(value, "id");
  const path = property(value, "path");
  const updatedAt = property(value, "updatedAt");
  const size = property(value, "size");

  if (
    (kind !== "directory" && kind !== "file" && kind !== "locked-file") ||
    !isStableIdentifier(id) ||
    !isVirtualPath(path) ||
    !isTimestamp(updatedAt) ||
    typeof size !== "number" ||
    !Number.isSafeInteger(size) ||
    size < 0 ||
    size > contentDocumentByteLimit
  ) {
    return invalid("catalog entry fields are invalid.");
  }

  if (kind !== "file") {
    return valid({ kind, id, path, updatedAt, size });
  }

  const documentHandle = property(value, "documentHandle");

  if (!isStableIdentifier(documentHandle)) {
    return invalid("catalog file document handle is invalid.");
  }

  return valid({ kind, id, path, updatedAt, size, documentHandle });
}

function parentPath(path: string): string | undefined {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? undefined : path.slice(0, slash);
}

function decodeContentCatalog(value: unknown): ContentValidation<ContentCatalog> {
  if (!isObject(value)) {
    return invalid("catalog must be an object.");
  }

  const entriesValue = property(value, "entries");
  const cache = decodeCache(property(value, "cache"));

  if (!Array.isArray(entriesValue) || entriesValue.length > contentPageItemLimit) {
    return invalid("catalog entries are invalid or exceed the page limit.");
  }

  if (cache.kind === "invalid") {
    return cache;
  }

  const entries: VirtualCorpusCatalogEntry[] = [];
  const ids = new Set<string>();
  const paths = new Set<string>();
  const documentHandles = new Set<string>();
  const directories = new Set<string>();

  for (const candidate of entriesValue) {
    const entry = decodeCatalogEntry(candidate);

    if (entry.kind === "invalid") {
      return entry;
    }

    if (ids.has(entry.value.id) || paths.has(entry.value.path)) {
      return invalid("catalog entries must have unique identifiers and paths.");
    }

    if (entry.value.kind === "file") {
      if (documentHandles.has(entry.value.documentHandle)) {
        return invalid("catalog file document handles must be unique.");
      }

      documentHandles.add(entry.value.documentHandle);
    }

    if (entry.value.kind === "directory") {
      directories.add(entry.value.path);
    }

    ids.add(entry.value.id);
    paths.add(entry.value.path);
    entries.push(entry.value);
  }

  if (!directories.has("~")) {
    return invalid("catalog must contain the virtual home directory.");
  }

  for (const entry of entries) {
    const parent = parentPath(entry.path);

    if (parent !== undefined && !directories.has(parent)) {
      return invalid("catalog entries must have directory parents.");
    }
  }

  return valid({ entries, cache: cache.value });
}

function decodeProject(value: unknown): ContentValidation<ProjectCandidate> {
  if (!isObject(value)) {
    return invalid("project must be an object.");
  }

  const id = property(value, "id");
  const slug = property(value, "slug");
  const name = property(value, "name");
  const summary = property(value, "summary");
  const url = property(value, "url");
  const repository = property(value, "repository");
  const collectionPath = property(value, "collectionPath");
  const tags = decodeTags(property(value, "tags"), "project.tags");
  const readme = property(value, "readme");

  if (
    !isStableIdentifier(id) ||
    typeof slug !== "string" ||
    !slugPattern.test(slug) ||
    !isSingleLine(name, 200) ||
    !isSummary(summary) ||
    !isHttpsUrl(url) ||
    !isRepositoryName(repository) ||
    !isRelativePath(collectionPath) ||
    tags.kind === "invalid" ||
    !isBody(readme, true)
  ) {
    return invalid("project fields are invalid.");
  }

  return valid({
    slug,
    project: {
      id,
      name: name.trim(),
      summary: summary.trim(),
      url,
      repository,
      collectionPath,
      tags: tags.value,
      readme,
    },
  });
}

function decodeContentProjects(value: unknown): ContentValidation<ContentProjects> {
  if (!isObject(value)) {
    return invalid("projects must be an object.");
  }

  const projectsValue = property(value, "projects");
  const cache = decodeCache(property(value, "cache"));

  if (!Array.isArray(projectsValue) || projectsValue.length > contentPageItemLimit) {
    return invalid("projects are invalid or exceed the page limit.");
  }

  if (cache.kind === "invalid") {
    return cache;
  }

  const projects: ContentProject[] = [];
  const ids = new Set<string>();
  const slugs = new Set<string>();
  const repositories = new Set<string>();

  for (const candidate of projectsValue) {
    const decoded = decodeProject(candidate);

    if (decoded.kind === "invalid") {
      return decoded;
    }

    const repositoryIdentity = decoded.value.project.repository.toLowerCase();

    if (
      ids.has(decoded.value.project.id) ||
      slugs.has(decoded.value.slug) ||
      repositories.has(repositoryIdentity)
    ) {
      return invalid("projects must have unique identifiers, slugs, and repositories.");
    }

    ids.add(decoded.value.project.id);
    slugs.add(decoded.value.slug);
    repositories.add(repositoryIdentity);
    projects.push(decoded.value.project);
  }

  return valid({ projects, cache: cache.value });
}

function decodeContentNow(value: unknown): ContentValidation<ContentNow> {
  if (!isObject(value)) {
    return invalid("now must be an object.");
  }

  const body = property(value, "body");
  const updatedAt = property(value, "updatedAt");
  const cache = decodeCache(property(value, "cache"));

  if (!isBody(body, true) || !isTimestamp(updatedAt) || cache.kind === "invalid") {
    return invalid("now fields are invalid.");
  }

  return valid({ body, updatedAt, cache: cache.value });
}

function decodeCommit(value: unknown): ContentValidation<ContentCommit> {
  if (!isObject(value)) {
    return invalid("commit must be an object.");
  }

  const sha = property(value, "sha");
  const summary = property(value, "summary");

  if (
    typeof sha !== "string" ||
    !commitShaPattern.test(sha) ||
    !isSingleLine(summary, 200)
  ) {
    return invalid("commit fields are invalid.");
  }

  return valid({ sha, summary: summary.trim() });
}

function decodeCommitList(
  value: unknown,
  field: string,
): ContentValidation<ReadonlyArray<ContentCommit>> {
  if (!Array.isArray(value) || value.length > contentPageItemLimit) {
    return invalid(`${field} is invalid or exceeds the page limit.`);
  }

  const commits: ContentCommit[] = [];
  const shas = new Set<string>();

  for (const candidate of value) {
    const commit = decodeCommit(candidate);

    if (commit.kind === "invalid") {
      return commit;
    }

    if (shas.has(commit.value.sha)) {
      return invalid(`${field} must have unique commit SHAs.`);
    }

    shas.add(commit.value.sha);
    commits.push(commit.value);
  }

  return valid(commits);
}

function decodeRelease(value: unknown): ContentValidation<ContentRelease> {
  if (!isObject(value)) {
    return invalid("release must be an object.");
  }

  const tag = property(value, "tag");
  const name = property(value, "name");
  const body = property(value, "body");
  const commits = decodeCommitList(property(value, "commits"), "release.commits");

  if (
    typeof tag !== "string" ||
    !tagPattern.test(tag) ||
    !isSingleLine(name, 200) ||
    !isBody(body, false) ||
    commits.kind === "invalid"
  ) {
    return invalid("release fields are invalid.");
  }

  return valid({ tag, name: name.trim(), body, commits: commits.value });
}

function decodeContentChangelog(value: unknown): ContentValidation<ContentChangelog> {
  if (!isObject(value)) {
    return invalid("changelog must be an object.");
  }

  const unreleased = decodeCommitList(property(value, "unreleased"), "changelog.unreleased");
  const releasesValue = property(value, "releases");
  const cache = decodeCache(property(value, "cache"));

  if (
    unreleased.kind === "invalid" ||
    !Array.isArray(releasesValue) ||
    releasesValue.length > contentPageItemLimit ||
    cache.kind === "invalid"
  ) {
    return invalid("changelog fields are invalid or exceed the page limit.");
  }

  const releases: ContentRelease[] = [];
  const tags = new Set<string>();

  for (const candidate of releasesValue) {
    const release = decodeRelease(candidate);

    if (release.kind === "invalid") {
      return release;
    }

    if (tags.has(release.value.tag)) {
      return invalid("changelog releases must have unique tags.");
    }

    tags.add(release.value.tag);
    releases.push(release.value);
  }

  return valid({ unreleased: unreleased.value, releases, cache: cache.value });
}

function sourcePath(value: object): ContentValidation<string> {
  const source = property(value, "source");

  if (!isObject(source)) {
    return invalid("document source must be an object.");
  }

  const path = property(source, "path");
  return isRelativePath(path)
    ? valid(path)
    : invalid("document source path is invalid.");
}

function decodeContentDocument(value: unknown): ContentValidation<ContentDocument> {
  if (!isObject(value)) {
    return invalid("document must be an object with a supported kind.");
  }

  const kind = property(value, "kind");
  const id = property(value, "id");
  const path = property(value, "path");
  const body = property(value, "body");
  const repositoryPath = sourcePath(value);

  if (
    (kind !== "page" && kind !== "blog" && kind !== "note") ||
    !isStableIdentifier(id) ||
    !isVirtualPath(path) ||
    !isBody(body, true) ||
    repositoryPath.kind === "invalid"
  ) {
    return invalid("document fields are invalid.");
  }

  if (kind === "page") {
    return repositoryPath.value.startsWith("blog/") || repositoryPath.value.startsWith("notes/")
      ? invalid("Publication paths must use publication document metadata.")
      : valid({ kind, path, body });
  }

  const slug = property(value, "slug");
  const title = property(value, "title");
  const summary = property(value, "summary");
  const publishedAt = property(value, "publishedAt");
  const tags = decodeTags(property(value, "tags"), "document.tags");

  if (
    typeof slug !== "string" ||
    !slugPattern.test(slug) ||
    !isSingleLine(title, 200) ||
    !isSummary(summary) ||
    !isTimestamp(publishedAt) ||
    tags.kind === "invalid"
  ) {
    return invalid("publication document fields are invalid.");
  }

  const directory = kind === "blog" ? "blog" : "notes";
  const expectedSuffix = `/${slug}.md`;

  if (
    !repositoryPath.value.startsWith(`${directory}/`) ||
    !repositoryPath.value.endsWith(expectedSuffix) ||
    path !== `~/${repositoryPath.value}`
  ) {
    return invalid("Publication kind and slug must match the document paths.");
  }

  return valid({
    kind,
    path,
    body,
    slug,
    title: title.trim(),
    summary: summary.trim(),
    publishedAt,
    tags: tags.value,
  });
}

function decodeContentProblem(value: unknown): ContentValidation<ContentProblem> {
  if (!isObject(value)) {
    return invalid("problem must be an object.");
  }

  const type = property(value, "type");
  const title = property(value, "title");
  const status = property(value, "status");
  const code = property(value, "code");
  const detail = property(value, "detail");
  const definitions = [
    { code: "invalid-request", status: 400, title: "The request is invalid." },
    { code: "not-found", status: 404, title: "The requested content was not found." },
    { code: "upstream-unavailable", status: 503, title: "Content is temporarily unavailable." },
    { code: "rate-limited", status: 429, title: "Content retrieval is rate limited." },
    { code: "configuration-invalid", status: 500, title: "Content is not configured." },
  ] as const;
  const definition = definitions.find((candidate) => candidate.code === code);

  if (
    definition === undefined ||
    type !== `https://termin.al/problems/${definition.code}` ||
    typeof title !== "string" ||
    title !== definition.title ||
    status !== definition.status ||
    typeof detail !== "string" ||
    detail.trim().length === 0 ||
    detail.length > 500
  ) {
    return invalid("problem does not match a stable content problem contract.");
  }

  return valid({ title });
}

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
      const problem = decodeContentProblem(payload);

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

export class HttpContentClient implements ContentClient {
  private async catalog(
    signal: AbortSignal,
  ): Promise<ContentEndpointResult<ContentCatalog>> {
    const response = await request(contentApiPath("catalog"), signal);

    switch (response.kind) {
      case "payload": {
        const validation = decodeContentCatalog(response.payload);

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
        const validation = decodeContentProjects(response.payload);

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
        const validation = decodeContentNow(response.payload);

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
        const validation = decodeContentChangelog(response.payload);

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
        const validation = decodeContentDocument(response.payload);

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
      const projectReadmes = createProjectReadmes(projects.value);
      const derived = derivedDocuments(now.value, changelog.value);
      const virtual = virtualCatalog(catalog.value, derived, projectReadmes);
      const filesystem = createVirtualFilesystem(virtual.catalog);
      const documents = this.documentSupplier(virtual.documentsByHandle);
      const corpus = { filesystem, documents, projectReadmes };

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
          return {
            kind: "available",
            document: local,
            classification: { kind: "page" },
          };
        }

        const id = ContentId.tryCreate(handle, "document handle");

        if (id.kind === "invalid") {
          return { kind: "missing", handle };
        }

        const result = await this.readDocument(id.value, signal);

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
                publishedAt: createVirtualTimestamp(result.value.publishedAt),
                tags: result.value.tags,
              },
            };
          }
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
