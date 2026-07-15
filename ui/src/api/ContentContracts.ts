export const contentDocumentByteLimit = 1_048_576;
export const contentPageItemLimit = 100;

export type ContentValidation<Value> =
  | Readonly<{ kind: "valid"; value: Value }>
  | Readonly<{ kind: "invalid"; message: string }>;

export class ContentId {
  readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  static tryCreate(value: string, field: string): ContentValidation<ContentId> {
    const stableIdentifier = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;

    return stableIdentifier.test(value)
      ? valid(new ContentId(value))
      : invalid(`${field} must be a stable identifier.`);
  }
}

export class CatalogId {
  readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  static tryCreate(value: string, field: string): ContentValidation<CatalogId> {
    const stableIdentifier = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;

    return stableIdentifier.test(value)
      ? valid(new CatalogId(value))
      : invalid(`${field} must be a stable identifier.`);
  }
}

export class VirtualPath {
  readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  static tryCreate(value: string, field: string): ContentValidation<VirtualPath> {
    const segment = /^[A-Za-z0-9._-]{1,128}$/u;

    if (value === "~") {
      return valid(new VirtualPath(value));
    }

    if (!value.startsWith("~/") || value.length > 512 || value.includes("\u0000")) {
      return invalid(`${field} must be a bounded virtual path.`);
    }

    const validSegments = value
      .slice(2)
      .split("/")
      .every(
        (candidate) =>
          candidate !== "." && candidate !== ".." && segment.test(candidate),
      );

    return validSegments
      ? valid(new VirtualPath(value))
      : invalid(`${field} must not contain traversal or invalid segments.`);
  }
}

export class RepositoryName {
  readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  static tryCreate(
    value: string,
    field: string,
  ): ContentValidation<RepositoryName> {
    const segment = /^[A-Za-z0-9._-]{1,100}$/u;
    const segments = value.split("/");

    return segments.length === 2 && segments.every((candidate) => segment.test(candidate))
      ? valid(new RepositoryName(value))
      : invalid(`${field} must be an owner/repository name.`);
  }
}

export class RepositoryPath {
  readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  static tryCreate(
    value: string,
    field: string,
  ): ContentValidation<RepositoryPath> {
    const segment = /^[A-Za-z0-9._-]{1,128}$/u;

    if (value.length === 0 || value.startsWith("/") || value.length > 512) {
      return invalid(`${field} must be a bounded relative path.`);
    }

    const validSegments = value.split("/").every(
      (candidate) =>
        candidate !== "." && candidate !== ".." && segment.test(candidate),
    );

    return validSegments
      ? valid(new RepositoryPath(value))
      : invalid(`${field} must not contain traversal or invalid segments.`);
  }
}

export class ContentRevision {
  readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  static tryCreate(
    value: string,
    field: string,
  ): ContentValidation<ContentRevision> {
    const reference = /^[A-Za-z0-9._/-]{1,128}$/u;

    return reference.test(value) && !value.startsWith("/") && !value.includes("..")
      ? valid(new ContentRevision(value))
      : invalid(`${field} must be a bounded revision without traversal.`);
  }
}

export class ContentUrl {
  readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  static tryCreate(value: string, field: string): ContentValidation<ContentUrl> {
    try {
      const url = new URL(value);

      return url.protocol === "https:" &&
        url.username.length === 0 &&
        url.password.length === 0
        ? valid(new ContentUrl(value))
        : invalid(`${field} must be an HTTPS URL without user information.`);
    } catch {
      return invalid(`${field} must be an HTTPS URL.`);
    }
  }
}

export class ContentTimestamp {
  readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  static tryCreate(
    value: string,
    field: string,
  ): ContentValidation<ContentTimestamp> {
    const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
    const parsed = new Date(value);

    return timestamp.test(value) &&
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString() === value
      ? valid(new ContentTimestamp(value))
      : invalid(`${field} must be an ISO-8601 UTC timestamp with millisecond precision.`);
  }

  milliseconds(): number {
    return Date.parse(this.value);
  }
}

export class ContentTag {
  readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  static tryCreate(value: string, field: string): ContentValidation<ContentTag> {
    const tag = /^[A-Za-z0-9._-]{1,128}$/u;

    return tag.test(value)
      ? valid(new ContentTag(value))
      : invalid(`${field} must be a bounded tag.`);
  }
}

export class ContentSlug {
  readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  static tryCreate(value: string, field: string): ContentValidation<ContentSlug> {
    const slug = /^[a-z0-9][a-z0-9-]{0,63}$/u;

    return slug.test(value)
      ? valid(new ContentSlug(value))
      : invalid(`${field} must be a lowercase stable slug.`);
  }
}

export class CommitSha {
  readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  static tryCreate(value: string, field: string): ContentValidation<CommitSha> {
    const sha = /^[0-9a-f]{7,64}$/u;

    return sha.test(value)
      ? valid(new CommitSha(value))
      : invalid(`${field} must be a lowercase hexadecimal commit SHA.`);
  }
}

export class ContentByteSize {
  readonly value: number;

  private constructor(value: number) {
    this.value = value;
  }

  static tryCreate(
    value: number,
    field: string,
  ): ContentValidation<ContentByteSize> {
    return Number.isSafeInteger(value) && value >= 0 && value <= contentDocumentByteLimit
      ? valid(new ContentByteSize(value))
      : invalid(`${field} must be between zero and the document byte limit.`);
  }
}

export type ContentSource = Readonly<{
  repository: RepositoryName;
  path: RepositoryPath;
  revision: ContentRevision;
  url: ContentUrl;
}>;

export type ContentCache = Readonly<{
  state: "fresh" | "stale";
  fetchedAt: ContentTimestamp;
  freshUntil: ContentTimestamp;
  staleUntil: ContentTimestamp;
}>;

export type ContentCatalogEntry =
  | Readonly<{
      kind: "directory";
      id: CatalogId;
      path: VirtualPath;
      updatedAt: ContentTimestamp;
      size: ContentByteSize;
    }>
  | Readonly<{
      kind: "file";
      id: CatalogId;
      path: VirtualPath;
      updatedAt: ContentTimestamp;
      size: ContentByteSize;
      documentHandle: ContentId;
    }>
  | Readonly<{
      kind: "locked-file";
      id: CatalogId;
      path: VirtualPath;
      updatedAt: ContentTimestamp;
      size: ContentByteSize;
    }>;

export type ContentCatalog = Readonly<{
  entries: ReadonlyArray<ContentCatalogEntry>;
  source: ContentSource;
  cache: ContentCache;
}>;

export type ContentDocument = Readonly<{
  id: ContentId;
  path: VirtualPath;
  title: string;
  updatedAt: ContentTimestamp;
  tags: ReadonlyArray<ContentTag>;
  body: string;
  source: ContentSource;
  cache: ContentCache;
}>;

export type ContentProject = Readonly<{
  id: ContentId;
  slug: ContentSlug;
  name: string;
  summary: string;
  url: ContentUrl;
  repository: RepositoryName;
  updatedAt: ContentTimestamp;
  tags: ReadonlyArray<ContentTag>;
}>;

export type ContentProjects = Readonly<{
  projects: ReadonlyArray<ContentProject>;
  source: ContentSource;
  cache: ContentCache;
}>;

export type ContentNow = Readonly<{
  title: string;
  body: string;
  updatedAt: ContentTimestamp;
  source: ContentSource;
  cache: ContentCache;
}>;

export type ContentCommit = Readonly<{
  sha: CommitSha;
  summary: string;
  authoredAt: ContentTimestamp;
  url: ContentUrl;
}>;

export type ContentRelease = Readonly<{
  tag: ContentTag;
  name: string;
  publishedAt: ContentTimestamp;
  body: string;
  url: ContentUrl;
  commits: ReadonlyArray<ContentCommit>;
}>;

export type ContentChangelog = Readonly<{
  unreleased: ReadonlyArray<ContentCommit>;
  releases: ReadonlyArray<ContentRelease>;
  source: ContentSource;
  cache: ContentCache;
}>;

export type ContentProblemCode =
  | "invalid-request"
  | "not-found"
  | "upstream-unavailable"
  | "rate-limited"
  | "configuration-invalid";

export type ContentProblem = Readonly<{
  type: string;
  title: string;
  status: number;
  code: ContentProblemCode;
  detail: string;
}>;

function valid<Value>(value: Value): ContentValidation<Value> {
  return { kind: "valid", value };
}

function invalid<Value>(message: string): ContentValidation<Value> {
  return { kind: "invalid", message };
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: object, keys: ReadonlyArray<string>): boolean {
  const actual = Object.keys(value);

  return (
    actual.length === keys.length &&
    actual.every((key) => keys.includes(key))
  );
}

function requireObject(
  value: unknown,
  keys: ReadonlyArray<string>,
  label: string,
): ContentValidation<object> {
  if (!isObject(value) || !hasExactKeys(value, keys)) {
    return invalid(`${label} must be an object with the expected fields.`);
  }

  return valid(value);
}

function requireString(
  value: object,
  field: string,
): ContentValidation<string> {
  const candidate = Reflect.get(value, field);

  return typeof candidate === "string"
    ? valid(candidate)
    : invalid(`${field} must be a string.`);
}

function requireArray(
  value: object,
  field: string,
): ContentValidation<ReadonlyArray<unknown>> {
  const candidate = Reflect.get(value, field);

  return Array.isArray(candidate)
    ? valid(candidate)
    : invalid(`${field} must be an array.`);
}

function requireInteger(
  value: object,
  field: string,
): ContentValidation<number> {
  const candidate = Reflect.get(value, field);

  return Number.isSafeInteger(candidate)
    ? valid(candidate)
    : invalid(`${field} must be a safe integer.`);
}

function validateContentId(value: string, field: string): ContentValidation<ContentId> {
  return ContentId.tryCreate(value, field);
}

function validateCatalogId(value: string, field: string): ContentValidation<CatalogId> {
  return CatalogId.tryCreate(value, field);
}

function validateVirtualPath(
  value: string,
  field: string,
): ContentValidation<VirtualPath> {
  return VirtualPath.tryCreate(value, field);
}

function validateRepositoryName(
  value: string,
  field: string,
): ContentValidation<RepositoryName> {
  return RepositoryName.tryCreate(value, field);
}

function validateRepositoryPath(
  value: string,
  field: string,
): ContentValidation<RepositoryPath> {
  return RepositoryPath.tryCreate(value, field);
}

function validateContentRevision(
  value: string,
  field: string,
): ContentValidation<ContentRevision> {
  return ContentRevision.tryCreate(value, field);
}

function validateContentUrl(value: string, field: string): ContentValidation<ContentUrl> {
  return ContentUrl.tryCreate(value, field);
}

function validateContentTimestamp(
  value: string,
  field: string,
): ContentValidation<ContentTimestamp> {
  return ContentTimestamp.tryCreate(value, field);
}

function validateContentTag(value: string, field: string): ContentValidation<ContentTag> {
  return ContentTag.tryCreate(value, field);
}

function validateCommitSha(value: string, field: string): ContentValidation<CommitSha> {
  return CommitSha.tryCreate(value, field);
}

function validateContentByteSize(
  value: number,
  field: string,
): ContentValidation<ContentByteSize> {
  return ContentByteSize.tryCreate(value, field);
}

function validateSingleLine(
  value: string,
  field: string,
  maximumLength: number,
): ContentValidation<string> {
  return value.trim().length > 0 &&
    value.length <= maximumLength &&
    !value.includes("\r") &&
    !value.includes("\n") &&
    !value.includes("\u0000")
    ? valid(value.trim())
    : invalid(`${field} must be a non-empty single line within its limit.`);
}

function validateBody(value: string, field: string, required: boolean): ContentValidation<string> {
  return (
    (!required || value.trim().length > 0) &&
    !value.includes("\u0000") &&
    new TextEncoder().encode(value).byteLength <= contentDocumentByteLimit
  )
    ? valid(value)
    : invalid(`${field} is invalid or exceeds the 1 MiB document limit.`);
}

function validateSummary(value: string, field: string): ContentValidation<string> {
  return value.trim().length > 0 &&
    value.length <= 500 &&
    !value.includes("\u0000")
    ? valid(value.trim())
    : invalid(`${field} must be a non-empty summary within 500 characters.`);
}

function validateTags(
  value: ReadonlyArray<unknown>,
  field: string,
): ContentValidation<ReadonlyArray<ContentTag>> {
  const tags: ContentTag[] = [];
  const seen = new Set<string>();

  for (const candidate of value) {
    if (typeof candidate !== "string") {
      return invalid(`${field} must contain strings.`);
    }

    const tag = validateContentTag(candidate, field);

    if (tag.kind === "invalid") {
      return tag;
    }

    if (seen.has(tag.value.value)) {
      return invalid(`${field} must not contain duplicates.`);
    }

    seen.add(tag.value.value);
    tags.push(tag.value);
  }

  return valid(tags);
}

export function validateContentSource(value: unknown): ContentValidation<ContentSource> {
  const object = requireObject(
    value,
    ["repository", "path", "revision", "url"],
    "source",
  );

  if (object.kind === "invalid") {
    return object;
  }

  const repositoryValue = requireString(object.value, "repository");
  const pathValue = requireString(object.value, "path");
  const revisionValue = requireString(object.value, "revision");
  const urlValue = requireString(object.value, "url");

  if (repositoryValue.kind === "invalid") {
    return repositoryValue;
  }

  if (pathValue.kind === "invalid") {
    return pathValue;
  }

  if (revisionValue.kind === "invalid") {
    return revisionValue;
  }

  if (urlValue.kind === "invalid") {
    return urlValue;
  }

  const repository = validateRepositoryName(repositoryValue.value, "source.repository");
  const path = validateRepositoryPath(pathValue.value, "source.path");
  const revision = validateContentRevision(revisionValue.value, "source.revision");
  const url = validateContentUrl(urlValue.value, "source.url");

  if (repository.kind === "invalid") {
    return repository;
  }

  if (path.kind === "invalid") {
    return path;
  }

  if (revision.kind === "invalid") {
    return revision;
  }

  if (url.kind === "invalid") {
    return url;
  }

  return valid({
    repository: repository.value,
    path: path.value,
    revision: revision.value,
    url: url.value,
  });
}

export function validateContentCache(value: unknown): ContentValidation<ContentCache> {
  const object = requireObject(
    value,
    ["state", "fetchedAt", "freshUntil", "staleUntil"],
    "cache",
  );

  if (object.kind === "invalid") {
    return object;
  }

  const state = requireString(object.value, "state");
  const fetchedAtValue = requireString(object.value, "fetchedAt");
  const freshUntilValue = requireString(object.value, "freshUntil");
  const staleUntilValue = requireString(object.value, "staleUntil");

  if (state.kind === "invalid") {
    return state;
  }

  if (fetchedAtValue.kind === "invalid") {
    return fetchedAtValue;
  }

  if (freshUntilValue.kind === "invalid") {
    return freshUntilValue;
  }

  if (staleUntilValue.kind === "invalid") {
    return staleUntilValue;
  }

  if (state.value !== "fresh" && state.value !== "stale") {
    return invalid("cache.state must be fresh or stale.");
  }

  const fetchedAt = validateContentTimestamp(fetchedAtValue.value, "cache.fetchedAt");
  const freshUntil = validateContentTimestamp(
    freshUntilValue.value,
    "cache.freshUntil",
  );
  const staleUntil = validateContentTimestamp(
    staleUntilValue.value,
    "cache.staleUntil",
  );

  if (fetchedAt.kind === "invalid") {
    return fetchedAt;
  }

  if (freshUntil.kind === "invalid") {
    return freshUntil;
  }

  if (staleUntil.kind === "invalid") {
    return staleUntil;
  }

  if (
    fetchedAt.value.milliseconds() > freshUntil.value.milliseconds() ||
    freshUntil.value.milliseconds() > staleUntil.value.milliseconds()
  ) {
    return invalid("cache timestamps must be in fetch, fresh, stale order.");
  }

  return valid({
    state: state.value,
    fetchedAt: fetchedAt.value,
    freshUntil: freshUntil.value,
    staleUntil: staleUntil.value,
  });
}

function validateCatalogEntry(
  value: unknown,
): ContentValidation<ContentCatalogEntry> {
  const object = isObject(value)
    ? valid(value)
    : invalid<object>("catalog entry must be an object.");

  if (object.kind === "invalid") {
    return object;
  }

  const kind = requireString(object.value, "kind");

  if (kind.kind === "invalid") {
    return kind;
  }

  const expectedKeys =
    kind.value === "file"
      ? ["kind", "id", "path", "updatedAt", "size", "documentHandle"]
      : ["kind", "id", "path", "updatedAt", "size"];

  if (
    (kind.value !== "directory" && kind.value !== "file" && kind.value !== "locked-file") ||
    !hasExactKeys(object.value, expectedKeys)
  ) {
    return invalid("catalog entry has an invalid discriminant or fields.");
  }

  const idValue = requireString(object.value, "id");
  const pathValue = requireString(object.value, "path");
  const updatedAtValue = requireString(object.value, "updatedAt");
  const sizeValue = requireInteger(object.value, "size");

  if (idValue.kind === "invalid") {
    return idValue;
  }

  if (pathValue.kind === "invalid") {
    return pathValue;
  }

  if (updatedAtValue.kind === "invalid") {
    return updatedAtValue;
  }

  if (sizeValue.kind === "invalid") {
    return sizeValue;
  }

  const id = validateCatalogId(idValue.value, "catalog entry.id");
  const path = validateVirtualPath(pathValue.value, "catalog entry.path");
  const updatedAt = validateContentTimestamp(updatedAtValue.value, "catalog entry.updatedAt");
  const size = validateContentByteSize(sizeValue.value, "catalog entry.size");

  if (id.kind === "invalid") {
    return id;
  }

  if (path.kind === "invalid") {
    return path;
  }

  if (updatedAt.kind === "invalid") {
    return updatedAt;
  }

  if (size.kind === "invalid") {
    return size;
  }

  if (kind.value === "directory") {
    return valid({
      kind: "directory",
      id: id.value,
      path: path.value,
      updatedAt: updatedAt.value,
      size: size.value,
    });
  }

  if (kind.value === "locked-file") {
    return valid({
      kind: "locked-file",
      id: id.value,
      path: path.value,
      updatedAt: updatedAt.value,
      size: size.value,
    });
  }

  const documentHandleValue = requireString(object.value, "documentHandle");

  if (documentHandleValue.kind === "invalid") {
    return documentHandleValue;
  }

  const documentHandle = validateContentId(
    documentHandleValue.value,
    "catalog entry.documentHandle",
  );

  if (documentHandle.kind === "invalid") {
    return documentHandle;
  }

  return valid({
    kind: "file",
    id: id.value,
    path: path.value,
    updatedAt: updatedAt.value,
    size: size.value,
    documentHandle: documentHandle.value,
  });
}

function parentPath(path: VirtualPath): string | undefined {
  const slash = path.value.lastIndexOf("/");

  return slash < 0 ? undefined : path.value.slice(0, slash);
}

export function validateContentCatalog(value: unknown): ContentValidation<ContentCatalog> {
  const object = requireObject(value, ["entries", "source", "cache"], "catalog");

  if (object.kind === "invalid") {
    return object;
  }

  const entriesValue = requireArray(object.value, "entries");
  const source = validateContentSource(Reflect.get(object.value, "source"));
  const cache = validateContentCache(Reflect.get(object.value, "cache"));

  if (entriesValue.kind === "invalid") {
    return entriesValue;
  }

  if (source.kind === "invalid") {
    return source;
  }

  if (cache.kind === "invalid") {
    return cache;
  }

  if (entriesValue.value.length > contentPageItemLimit) {
    return invalid("catalog.entries exceeds the page limit.");
  }

  const entries: ContentCatalogEntry[] = [];
  const ids = new Set<string>();
  const paths = new Set<string>();
  const documentHandles = new Set<string>();
  const directories = new Set<string>();

  for (const entryValue of entriesValue.value) {
    const entry = validateCatalogEntry(entryValue);

    if (entry.kind === "invalid") {
      return entry;
    }

    if (ids.has(entry.value.id.value) || paths.has(entry.value.path.value)) {
      return invalid("catalog entries must have unique identifiers and paths.");
    }

    if (entry.value.kind === "file") {
      if (documentHandles.has(entry.value.documentHandle.value)) {
        return invalid("catalog file document handles must be unique.");
      }

      documentHandles.add(entry.value.documentHandle.value);
    }

    if (entry.value.kind === "directory") {
      directories.add(entry.value.path.value);
    }

    ids.add(entry.value.id.value);
    paths.add(entry.value.path.value);
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

  return valid({ entries, source: source.value, cache: cache.value });
}

export function validateContentDocument(
  value: unknown,
): ContentValidation<ContentDocument> {
  const object = requireObject(
    value,
    ["id", "path", "title", "updatedAt", "tags", "body", "source", "cache"],
    "document",
  );

  if (object.kind === "invalid") {
    return object;
  }

  const idValue = requireString(object.value, "id");
  const pathValue = requireString(object.value, "path");
  const titleValue = requireString(object.value, "title");
  const updatedAtValue = requireString(object.value, "updatedAt");
  const tagsValue = requireArray(object.value, "tags");
  const bodyValue = requireString(object.value, "body");
  const source = validateContentSource(Reflect.get(object.value, "source"));
  const cache = validateContentCache(Reflect.get(object.value, "cache"));

  if (idValue.kind === "invalid") {
    return idValue;
  }

  if (pathValue.kind === "invalid") {
    return pathValue;
  }

  if (titleValue.kind === "invalid") {
    return titleValue;
  }

  if (updatedAtValue.kind === "invalid") {
    return updatedAtValue;
  }

  if (tagsValue.kind === "invalid") {
    return tagsValue;
  }

  if (bodyValue.kind === "invalid") {
    return bodyValue;
  }

  if (source.kind === "invalid") {
    return source;
  }

  if (cache.kind === "invalid") {
    return cache;
  }

  const id = validateContentId(idValue.value, "document.id");
  const path = validateVirtualPath(pathValue.value, "document.path");
  const title = validateSingleLine(titleValue.value, "document.title", 200);
  const updatedAt = validateContentTimestamp(updatedAtValue.value, "document.updatedAt");
  const tags = validateTags(tagsValue.value, "document.tags");
  const body = validateBody(bodyValue.value, "document.body", true);

  if (id.kind === "invalid") {
    return id;
  }

  if (path.kind === "invalid") {
    return path;
  }

  if (title.kind === "invalid") {
    return title;
  }

  if (updatedAt.kind === "invalid") {
    return updatedAt;
  }

  if (tags.kind === "invalid") {
    return tags;
  }

  if (body.kind === "invalid") {
    return body;
  }

  return valid({
    id: id.value,
    path: path.value,
    title: title.value,
    updatedAt: updatedAt.value,
    tags: tags.value,
    body: body.value,
    source: source.value,
    cache: cache.value,
  });
}

function validateContentProject(value: unknown): ContentValidation<ContentProject> {
  const object = requireObject(
    value,
    ["id", "slug", "name", "summary", "url", "repository", "updatedAt", "tags"],
    "project",
  );

  if (object.kind === "invalid") {
    return object;
  }

  const idValue = requireString(object.value, "id");
  const slugValue = requireString(object.value, "slug");
  const nameValue = requireString(object.value, "name");
  const summaryValue = requireString(object.value, "summary");
  const urlValue = requireString(object.value, "url");
  const repositoryValue = requireString(object.value, "repository");
  const updatedAtValue = requireString(object.value, "updatedAt");
  const tagsValue = requireArray(object.value, "tags");

  if (idValue.kind === "invalid") {
    return idValue;
  }

  if (slugValue.kind === "invalid") {
    return slugValue;
  }

  if (nameValue.kind === "invalid") {
    return nameValue;
  }

  if (summaryValue.kind === "invalid") {
    return summaryValue;
  }

  if (urlValue.kind === "invalid") {
    return urlValue;
  }

  if (repositoryValue.kind === "invalid") {
    return repositoryValue;
  }

  if (updatedAtValue.kind === "invalid") {
    return updatedAtValue;
  }

  if (tagsValue.kind === "invalid") {
    return tagsValue;
  }

  const id = validateContentId(idValue.value, "project.id");
  const slug = ContentSlug.tryCreate(slugValue.value, "project.slug");
  const name = validateSingleLine(nameValue.value, "project.name", 200);
  const summary = validateSummary(summaryValue.value, "project.summary");
  const url = validateContentUrl(urlValue.value, "project.url");
  const repository = validateRepositoryName(
    repositoryValue.value,
    "project.repository",
  );
  const updatedAt = validateContentTimestamp(updatedAtValue.value, "project.updatedAt");
  const tags = validateTags(tagsValue.value, "project.tags");

  if (id.kind === "invalid") {
    return id;
  }

  if (slug.kind === "invalid") {
    return slug;
  }

  if (name.kind === "invalid") {
    return name;
  }

  if (summary.kind === "invalid") {
    return summary;
  }

  if (url.kind === "invalid") {
    return url;
  }

  if (repository.kind === "invalid") {
    return repository;
  }

  if (updatedAt.kind === "invalid") {
    return updatedAt;
  }

  if (tags.kind === "invalid") {
    return tags;
  }

  return valid({
    id: id.value,
    slug: slug.value,
    name: name.value,
    summary: summary.value,
    url: url.value,
    repository: repository.value,
    updatedAt: updatedAt.value,
    tags: tags.value,
  });
}

export function validateContentProjects(
  value: unknown,
): ContentValidation<ContentProjects> {
  const object = requireObject(value, ["projects", "source", "cache"], "projects");

  if (object.kind === "invalid") {
    return object;
  }

  const projectsValue = requireArray(object.value, "projects");
  const source = validateContentSource(Reflect.get(object.value, "source"));
  const cache = validateContentCache(Reflect.get(object.value, "cache"));

  if (projectsValue.kind === "invalid") {
    return projectsValue;
  }

  if (source.kind === "invalid") {
    return source;
  }

  if (cache.kind === "invalid") {
    return cache;
  }

  if (projectsValue.value.length > contentPageItemLimit) {
    return invalid("projects exceeds the page limit.");
  }

  const projects: ContentProject[] = [];
  const ids = new Set<string>();
  const slugs = new Set<string>();
  const repositories = new Set<string>();

  for (const projectValue of projectsValue.value) {
    const project = validateContentProject(projectValue);

    if (project.kind === "invalid") {
      return project;
    }

    const repositoryIdentity = project.value.repository.value.toLowerCase();

    if (
      ids.has(project.value.id.value) ||
      slugs.has(project.value.slug.value) ||
      repositories.has(repositoryIdentity)
    ) {
      return invalid("projects must have unique identifiers, slugs, and repositories.");
    }

    ids.add(project.value.id.value);
    slugs.add(project.value.slug.value);
    repositories.add(repositoryIdentity);
    projects.push(project.value);
  }

  return valid({ projects, source: source.value, cache: cache.value });
}

export function validateContentNow(value: unknown): ContentValidation<ContentNow> {
  const object = requireObject(
    value,
    ["title", "body", "updatedAt", "source", "cache"],
    "now",
  );

  if (object.kind === "invalid") {
    return object;
  }

  const titleValue = requireString(object.value, "title");
  const bodyValue = requireString(object.value, "body");
  const updatedAtValue = requireString(object.value, "updatedAt");
  const source = validateContentSource(Reflect.get(object.value, "source"));
  const cache = validateContentCache(Reflect.get(object.value, "cache"));

  if (titleValue.kind === "invalid") {
    return titleValue;
  }

  if (bodyValue.kind === "invalid") {
    return bodyValue;
  }

  if (updatedAtValue.kind === "invalid") {
    return updatedAtValue;
  }

  if (source.kind === "invalid") {
    return source;
  }

  if (cache.kind === "invalid") {
    return cache;
  }

  const title = validateSingleLine(titleValue.value, "now.title", 200);
  const body = validateBody(bodyValue.value, "now.body", true);
  const updatedAt = validateContentTimestamp(updatedAtValue.value, "now.updatedAt");

  if (title.kind === "invalid") {
    return title;
  }

  if (body.kind === "invalid") {
    return body;
  }

  if (updatedAt.kind === "invalid") {
    return updatedAt;
  }

  return valid({
    title: title.value,
    body: body.value,
    updatedAt: updatedAt.value,
    source: source.value,
    cache: cache.value,
  });
}

function validateContentCommit(value: unknown): ContentValidation<ContentCommit> {
  const object = requireObject(value, ["sha", "summary", "authoredAt", "url"], "commit");

  if (object.kind === "invalid") {
    return object;
  }

  const shaValue = requireString(object.value, "sha");
  const summaryValue = requireString(object.value, "summary");
  const authoredAtValue = requireString(object.value, "authoredAt");
  const urlValue = requireString(object.value, "url");

  if (shaValue.kind === "invalid") {
    return shaValue;
  }

  if (summaryValue.kind === "invalid") {
    return summaryValue;
  }

  if (authoredAtValue.kind === "invalid") {
    return authoredAtValue;
  }

  if (urlValue.kind === "invalid") {
    return urlValue;
  }

  const sha = validateCommitSha(shaValue.value, "commit.sha");
  const summary = validateSingleLine(summaryValue.value, "commit.summary", 200);
  const authoredAt = validateContentTimestamp(authoredAtValue.value, "commit.authoredAt");
  const url = validateContentUrl(urlValue.value, "commit.url");

  if (sha.kind === "invalid") {
    return sha;
  }

  if (summary.kind === "invalid") {
    return summary;
  }

  if (authoredAt.kind === "invalid") {
    return authoredAt;
  }

  if (url.kind === "invalid") {
    return url;
  }

  return valid({
    sha: sha.value,
    summary: summary.value,
    authoredAt: authoredAt.value,
    url: url.value,
  });
}

function validateContentRelease(value: unknown): ContentValidation<ContentRelease> {
  const object = requireObject(
    value,
    ["tag", "name", "publishedAt", "body", "url", "commits"],
    "release",
  );

  if (object.kind === "invalid") {
    return object;
  }

  const tagValue = requireString(object.value, "tag");
  const nameValue = requireString(object.value, "name");
  const publishedAtValue = requireString(object.value, "publishedAt");
  const bodyValue = requireString(object.value, "body");
  const urlValue = requireString(object.value, "url");
  const commitsValue = requireArray(object.value, "commits");

  if (tagValue.kind === "invalid") {
    return tagValue;
  }

  if (nameValue.kind === "invalid") {
    return nameValue;
  }

  if (publishedAtValue.kind === "invalid") {
    return publishedAtValue;
  }

  if (bodyValue.kind === "invalid") {
    return bodyValue;
  }

  if (urlValue.kind === "invalid") {
    return urlValue;
  }

  if (commitsValue.kind === "invalid") {
    return commitsValue;
  }

  if (commitsValue.value.length > contentPageItemLimit) {
    return invalid("release.commits exceeds the page limit.");
  }

  const tag = validateContentTag(tagValue.value, "release.tag");
  const name = validateSingleLine(nameValue.value, "release.name", 200);
  const publishedAt = validateContentTimestamp(
    publishedAtValue.value,
    "release.publishedAt",
  );
  const body = validateBody(bodyValue.value, "release.body", false);
  const url = validateContentUrl(urlValue.value, "release.url");

  if (tag.kind === "invalid") {
    return tag;
  }

  if (name.kind === "invalid") {
    return name;
  }

  if (publishedAt.kind === "invalid") {
    return publishedAt;
  }

  if (body.kind === "invalid") {
    return body;
  }

  if (url.kind === "invalid") {
    return url;
  }

  const commits: ContentCommit[] = [];
  const shas = new Set<string>();

  for (const commitValue of commitsValue.value) {
    const commit = validateContentCommit(commitValue);

    if (commit.kind === "invalid") {
      return commit;
    }

    if (shas.has(commit.value.sha.value)) {
      return invalid("release commits must have unique SHAs.");
    }

    shas.add(commit.value.sha.value);
    commits.push(commit.value);
  }

  return valid({
    tag: tag.value,
    name: name.value,
    publishedAt: publishedAt.value,
    body: body.value,
    url: url.value,
    commits,
  });
}

function validateCommitList(
  values: ReadonlyArray<unknown>,
  field: string,
): ContentValidation<ReadonlyArray<ContentCommit>> {
  if (values.length > contentPageItemLimit) {
    return invalid(`${field} exceeds the page limit.`);
  }

  const commits: ContentCommit[] = [];
  const shas = new Set<string>();

  for (const value of values) {
    const commit = validateContentCommit(value);

    if (commit.kind === "invalid") {
      return commit;
    }

    if (shas.has(commit.value.sha.value)) {
      return invalid(`${field} must have unique commit SHAs.`);
    }

    shas.add(commit.value.sha.value);
    commits.push(commit.value);
  }

  return valid(commits);
}

export function validateContentChangelog(
  value: unknown,
): ContentValidation<ContentChangelog> {
  const object = requireObject(
    value,
    ["unreleased", "releases", "source", "cache"],
    "changelog",
  );

  if (object.kind === "invalid") {
    return object;
  }

  const unreleasedValue = requireArray(object.value, "unreleased");
  const releasesValue = requireArray(object.value, "releases");
  const source = validateContentSource(Reflect.get(object.value, "source"));
  const cache = validateContentCache(Reflect.get(object.value, "cache"));

  if (unreleasedValue.kind === "invalid") {
    return unreleasedValue;
  }

  if (releasesValue.kind === "invalid") {
    return releasesValue;
  }

  if (source.kind === "invalid") {
    return source;
  }

  if (cache.kind === "invalid") {
    return cache;
  }

  if (releasesValue.value.length > contentPageItemLimit) {
    return invalid("changelog.releases exceeds the page limit.");
  }

  const unreleased = validateCommitList(unreleasedValue.value, "changelog.unreleased");

  if (unreleased.kind === "invalid") {
    return unreleased;
  }

  const releases: ContentRelease[] = [];
  const tags = new Set<string>();

  for (const releaseValue of releasesValue.value) {
    const release = validateContentRelease(releaseValue);

    if (release.kind === "invalid") {
      return release;
    }

    if (tags.has(release.value.tag.value)) {
      return invalid("changelog releases must have unique tags.");
    }

    tags.add(release.value.tag.value);
    releases.push(release.value);
  }

  return valid({
    unreleased: unreleased.value,
    releases,
    source: source.value,
    cache: cache.value,
  });
}

export function validateContentProblem(value: unknown): ContentValidation<ContentProblem> {
  const object = requireObject(
    value,
    ["type", "title", "status", "code", "detail"],
    "problem",
  );

  if (object.kind === "invalid") {
    return object;
  }

  const type = requireString(object.value, "type");
  const title = requireString(object.value, "title");
  const status = requireInteger(object.value, "status");
  const code = requireString(object.value, "code");
  const detail = requireString(object.value, "detail");

  if (type.kind === "invalid") {
    return type;
  }

  if (title.kind === "invalid") {
    return title;
  }

  if (status.kind === "invalid") {
    return status;
  }

  if (code.kind === "invalid") {
    return code;
  }

  if (detail.kind === "invalid") {
    return detail;
  }

  const definitions: ReadonlyArray<
    Readonly<{ code: ContentProblemCode; status: number; title: string }>
  > = [
    { code: "invalid-request", status: 400, title: "The request is invalid." },
    {
      code: "not-found",
      status: 404,
      title: "The requested content was not found.",
    },
    {
      code: "upstream-unavailable",
      status: 503,
      title: "Content is temporarily unavailable.",
    },
    {
      code: "rate-limited",
      status: 429,
      title: "Content retrieval is rate limited.",
    },
    {
      code: "configuration-invalid",
      status: 500,
      title: "Content is not configured.",
    },
  ];
  const definition = definitions.find((candidate) => candidate.code === code.value);

  if (
    definition === undefined ||
    type.value !== `https://termin.al/problems/${definition.code}` ||
    title.value !== definition.title ||
    status.value !== definition.status ||
    detail.value.trim().length === 0 ||
    detail.value.length > 500
  ) {
    return invalid("problem does not match a stable content problem contract.");
  }

  return valid({
    type: type.value,
    title: title.value,
    status: status.value,
    code: definition.code,
    detail: detail.value,
  });
}
