export type ManpageManifestEntry = Readonly<{
  name: string;
  section: 1;
  usage: string;
  summary: string;
  sourcePath: string;
  artifactPath: string;
  byteCount: number;
  lineCount: number;
  sha256: string;
}>;

export type Manpage = Readonly<{
  metadata: ManpageManifestEntry;
  text: string;
}>;

export type ManpageLookup =
  | Readonly<{ kind: "found"; manpage: Manpage }>
  | Readonly<{ kind: "missing"; canonicalName: string }>;

export type ManpageCorpus = Readonly<{
  entries: ReadonlyArray<ManpageManifestEntry>;
  lookup: (canonicalName: string) => ManpageLookup;
}>;

export type CreateManpageCorpusOptions = Readonly<{
  manifest: unknown;
  artifacts: ReadonlyMap<string, string>;
}>;

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function property(value: object, name: string): unknown {
  return name in value ? Reflect.get(value, name) : undefined;
}

function requiredString(value: object, name: string, context: string): string {
  const candidate = property(value, name);

  if (typeof candidate !== "string" || candidate.length === 0) {
    throw new Error(`${context} requires a non-empty ${name}.`);
  }

  return candidate;
}

function requiredNonNegativeInteger(
  value: object,
  name: string,
  context: string,
): number {
  const candidate = property(value, name);

  if (
    typeof candidate !== "number" ||
    !Number.isSafeInteger(candidate) ||
    candidate < 0
  ) {
    throw new Error(`${context} requires a non-negative integer ${name}.`);
  }

  return candidate;
}

function parseManifestEntry(value: unknown, index: number): ManpageManifestEntry {
  const context = `Manpage manifest entry ${index + 1}`;

  if (!isObject(value)) {
    throw new Error(`${context} must be an object.`);
  }

  const section = property(value, "section");

  if (section !== 1) {
    throw new Error(`${context} must use section 1.`);
  }

  const sha256 = requiredString(value, "sha256", context);

  if (!/^[0-9a-f]{64}$/u.test(sha256)) {
    throw new Error(`${context} requires a lowercase SHA-256 checksum.`);
  }

  return {
    name: requiredString(value, "name", context),
    section,
    usage: requiredString(value, "usage", context),
    summary: requiredString(value, "summary", context),
    sourcePath: requiredString(value, "sourcePath", context),
    artifactPath: requiredString(value, "artifactPath", context),
    byteCount: requiredNonNegativeInteger(value, "byteCount", context),
    lineCount: requiredNonNegativeInteger(value, "lineCount", context),
    sha256,
  };
}

function parseManifest(manifest: unknown): ReadonlyArray<ManpageManifestEntry> {
  if (!isObject(manifest)) {
    throw new Error("Manpage manifest must be an object.");
  }

  const entries = property(manifest, "entries");

  if (!Array.isArray(entries)) {
    throw new Error("Manpage manifest requires an entries array.");
  }

  return entries.map(parseManifestEntry);
}

function artifactLineCount(text: string): number {
  return text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
}

export function createManpageCorpus({
  manifest,
  artifacts,
}: CreateManpageCorpusOptions): ManpageCorpus {
  const entries = parseManifest(manifest);
  const pages = new Map<string, Manpage>();
  let priorName = "";

  for (const entry of entries) {
    if (entry.name <= priorName) {
      throw new Error("Manpage manifest entries must have unique sorted names.");
    }

    const text = artifacts.get(entry.name);

    if (text === undefined) {
      throw new Error(`Manpage artifact is missing for ${entry.name}.`);
    }

    if (new TextEncoder().encode(text).byteLength !== entry.byteCount) {
      throw new Error(`Manpage artifact byte count does not match for ${entry.name}.`);
    }

    if (artifactLineCount(text) !== entry.lineCount) {
      throw new Error(`Manpage artifact line count does not match for ${entry.name}.`);
    }

    pages.set(entry.name, { metadata: entry, text });
    priorName = entry.name;
  }

  for (const name of artifacts.keys()) {
    if (!pages.has(name)) {
      throw new Error(`Unexpected manpage artifact for ${name}.`);
    }
  }

  return {
    entries: [...entries],
    lookup: (canonicalName): ManpageLookup => {
      const manpage = pages.get(canonicalName);
      return manpage === undefined
        ? { kind: "missing", canonicalName }
        : { kind: "found", manpage };
    },
  };
}
