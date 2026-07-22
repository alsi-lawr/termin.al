export type PublicationKind = "blog" | "note";

export type PublicationPath = Readonly<{
  kind: PublicationKind;
  repositoryPath: string;
  virtualPath: string;
  slug: string;
}>;

export type PublicationFrontMatter = Readonly<{
  title: string;
  summary: string;
  tags: ReadonlyArray<string>;
}>;

export type DraftBase =
  | Readonly<{
      kind: "existing";
      defaultBranch: string;
      headSha: string;
      blobSha: string;
    }>
  | Readonly<{
      kind: "new";
      defaultBranch: string;
      headSha: string;
    }>;

export type StagedAssetMetadata = Readonly<{
  destinationPath: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
}>;

export type PublicationDraft = Readonly<{
  schemaVersion: 1;
  recordRevision: number;
  kind: PublicationKind;
  repositoryPath: string;
  virtualPath: string;
  frontMatter: PublicationFrontMatter;
  source: string;
  base: DraftBase;
  dirty: boolean;
  unpublished: boolean;
  stagedAssets: ReadonlyArray<StagedAssetMetadata>;
}>;

export type DraftValidation<Value> =
  | Readonly<{ kind: "valid"; value: Value }>
  | Readonly<{ kind: "invalid"; message: string }>;

const segmentPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u;
const slugPattern = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const tagPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u;

export function publicationPathFromVirtualPath(value: string): DraftValidation<PublicationPath> {
  if (!value.startsWith("~/") || value.length > 512 || value.includes("\0")) {
    return { kind: "invalid", message: "edit requires a canonical blog or notes Markdown path." };
  }

  const repositoryPath = value.slice(2);
  const segments = repositoryPath.split("/");
  if (segments.length < 2 || segments.some((segment) => !segmentPattern.test(segment))) {
    return { kind: "invalid", message: "edit paths must be traversal-free canonical segments." };
  }

  const root = segments[0];
  const fileName = segments.at(-1) ?? "";
  const slug = fileName.endsWith(".md") ? fileName.slice(0, -3) : "";
  if ((root !== "blog" && root !== "notes") || !slugPattern.test(slug)) {
    return { kind: "invalid", message: "edit supports blog/**/<slug>.md and notes/**/<slug>.md." };
  }

  return {
    kind: "valid",
    value: {
      kind: root === "blog" ? "blog" : "note",
      repositoryPath,
      virtualPath: value,
      slug,
    },
  };
}

export function minimalPublicationSource(slug: string): string {
  const title = slug.split("-").map((part) => part.length === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
  return `---\ntitle = ${JSON.stringify(title)}\nsummary = ${JSON.stringify(`${title} summary.`)}\ntags = []\n---\n# ${title}\n`;
}

export function publicationSource(
  frontMatter: PublicationFrontMatter,
  body: string,
): string {
  return [
    "---",
    `title = ${JSON.stringify(frontMatter.title)}`,
    `summary = ${JSON.stringify(frontMatter.summary)}`,
    `tags = ${JSON.stringify(frontMatter.tags)}`,
    "---",
    body,
  ].join("\n");
}

export function validatePublicationSource(source: string): DraftValidation<PublicationFrontMatter> {
  if (source.length === 0 || new TextEncoder().encode(source).byteLength > 1_048_576 || source.includes("\0")) {
    return { kind: "invalid", message: "A document must be non-empty and at most 1 MiB." };
  }

  const normalized = source.replaceAll("\r\n", "\n");
  const lines = normalized.split("\n");
  const closing = lines.indexOf("---", 1);
  if (lines[0] !== "---" || closing < 2) {
    return { kind: "invalid", message: "A document must contain --- delimited front matter." };
  }

  const fields = new Map<string, unknown>();
  for (const line of lines.slice(1, closing)) {
    if (line.trim().length === 0) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) return { kind: "invalid", message: "Front matter fields must use key = value syntax." };
    const name = line.slice(0, separator).trim();
    if (!(["title", "summary", "tags"] as const).includes(name as "title" | "summary" | "tags") || fields.has(name)) {
      return { kind: "invalid", message: "Front matter fields must be unique title, summary, and tags fields." };
    }
    try {
      const parsedValue: unknown = JSON.parse(line.slice(separator + 1).trim());
      fields.set(name, parsedValue);
    } catch {
      return { kind: "invalid", message: `Front matter field '${name}' is invalid.` };
    }
  }

  const title = fields.get("title");
  const summary = fields.get("summary");
  const tags = fields.get("tags");
  const body = lines.slice(closing + 1).join("\n");
  if (
    typeof title !== "string" || title.trim().length === 0 || title.length > 200 ||
    title.includes("\r") || title.includes("\n") || title.includes("\0")
  ) {
    return { kind: "invalid", message: "Front matter title must be a non-empty single line of at most 200 characters." };
  }
  if (typeof summary !== "string" || summary.trim().length === 0 || summary.length > 500 || summary.includes("\0")) {
    return { kind: "invalid", message: "Front matter summary must be non-empty and at most 500 characters." };
  }
  if (!Array.isArray(tags)) {
    return { kind: "invalid", message: "Front matter tags must be unique canonical quoted strings." };
  }
  const validatedTags: string[] = [];
  for (const tag of tags) {
    if (typeof tag !== "string" || !tagPattern.test(tag) || validatedTags.includes(tag)) {
      return { kind: "invalid", message: "Front matter tags must be unique canonical quoted strings." };
    }
    validatedTags.push(tag);
  }
  if (body.trim().length === 0) return { kind: "invalid", message: "A document body is required." };

  return { kind: "valid", value: { title: title.trim(), summary: summary.trim(), tags: validatedTags } };
}

export function publicationBodyFromSource(source: string): string {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  const closing = lines.indexOf("---", 1);
  return closing < 0 ? source : lines.slice(closing + 1).join("\n");
}

function stringProperty(value: object, name: string): string | undefined {
  if (!(name in value)) return undefined;
  const candidate = Reflect.get(value, name);
  return typeof candidate === "string" ? candidate : undefined;
}

function numberProperty(value: object, name: string): number | undefined {
  if (!(name in value)) return undefined;
  const candidate = Reflect.get(value, name);
  return typeof candidate === "number" ? candidate : undefined;
}

function booleanProperty(value: object, name: string): boolean | undefined {
  if (!(name in value)) return undefined;
  const candidate = Reflect.get(value, name);
  return typeof candidate === "boolean" ? candidate : undefined;
}

export function publicationDraftFromStoredValue(value: unknown): PublicationDraft | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const repositoryPath = stringProperty(value, "repositoryPath");
  const virtualPath = stringProperty(value, "virtualPath");
  const source = stringProperty(value, "source");
  const revision = numberProperty(value, "recordRevision");
  const dirty = booleanProperty(value, "dirty");
  const unpublished = booleanProperty(value, "unpublished");
  const schemaVersion = numberProperty(value, "schemaVersion");
  if (
    repositoryPath === undefined || virtualPath === undefined || source === undefined ||
    revision === undefined || !Number.isSafeInteger(revision) || revision < 0 ||
    dirty === undefined || unpublished === undefined || schemaVersion !== 1
  ) return undefined;
  const path = publicationPathFromVirtualPath(virtualPath);
  const parsed = validatePublicationSource(source);
  if (path.kind === "invalid" || parsed.kind === "invalid" || path.value.repositoryPath !== repositoryPath) return undefined;
  if (!("base" in value) || typeof value.base !== "object" || value.base === null) return undefined;
  const baseKind = stringProperty(value.base, "kind");
  const defaultBranch = stringProperty(value.base, "defaultBranch");
  const headSha = stringProperty(value.base, "headSha");
  const blobSha = stringProperty(value.base, "blobSha");
  if (defaultBranch === undefined || headSha === undefined) return undefined;
  const base: DraftBase | undefined = baseKind === "new"
    ? { kind: "new", defaultBranch, headSha }
    : baseKind === "existing" && blobSha !== undefined
      ? { kind: "existing", defaultBranch, headSha, blobSha }
      : undefined;
  if (base === undefined || !("stagedAssets" in value) || !Array.isArray(value.stagedAssets) || value.stagedAssets.length !== 0) return undefined;
  return {
    schemaVersion: 1,
    recordRevision: revision,
    kind: path.value.kind,
    repositoryPath,
    virtualPath,
    frontMatter: parsed.value,
    source,
    base,
    dirty,
    unpublished,
    stagedAssets: [],
  };
}
