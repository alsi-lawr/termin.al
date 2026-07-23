import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const acceptedCanonicalNames: ReadonlyArray<string> = [
  "about",
  "blog",
  "cat",
  "cd",
  "changelog",
  "clear",
  "cv",
  "echo",
  "edit",
  "find",
  "grep",
  "head",
  "help",
  "history",
  "less",
  "login",
  "logout",
  "ls",
  "man",
  "notes",
  "now",
  "open",
  "pane",
  "projects",
  "pwd",
  "rm",
  "sed",
  "skills",
  "stats",
  "tail",
  "theme",
  "tools",
  "tree",
  "whoami",
];

export type ManpageGenerationMode = "generate" | "check";

export type ManpageGenerationOptions = Readonly<{
  repositoryRoot: string;
  mode: ManpageGenerationMode;
  groffExecutable?: string;
}>;

export type GeneratedManpageManifestEntry = Readonly<{
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

export type GeneratedManpageManifest = Readonly<{
  entries: ReadonlyArray<GeneratedManpageManifestEntry>;
}>;

type SourceMarkers = Readonly<{
  name: string;
  usage: string;
  summary: string;
}>;

type GeneratedManpage = Readonly<{
  name: string;
  artifact: Buffer;
  entry: GeneratedManpageManifestEntry;
}>;

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const markerNames: ReadonlyArray<keyof SourceMarkers> = [
  "name",
  "usage",
  "summary",
];

function sorted(values: ReadonlyArray<string>): ReadonlyArray<string> {
  return [...values].sort();
}

function normalizedRepositoryPath(repositoryRoot: string, path: string): string {
  return relative(repositoryRoot, path).split("\\").join("/");
}

function decodeUtf8(bytes: Buffer, path: string): string {
  try {
    return utf8Decoder.decode(bytes);
  } catch (error: unknown) {
    throw new Error(`${path} is not valid UTF-8.`, { cause: error });
  }
}

function validateSafeText(text: string, path: string): void {
  for (const character of text) {
    const codePoint = character.codePointAt(0);

    if (codePoint === undefined) {
      throw new Error(`${path} contains an unreadable character.`);
    }

    const permittedLineEnding = codePoint === 0x0a || codePoint === 0x0d;
    const unsafeAsciiControl = codePoint < 0x20 && !permittedLineEnding;
    const unsafeControl = unsafeAsciiControl || codePoint === 0x7f ||
      (codePoint >= 0x80 && codePoint <= 0x9f);

    if (unsafeControl) {
      throw new Error(
        `${path} contains unsafe control character U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}.`,
      );
    }
  }
}

function normalizeGeneratedText(text: string): string {
  const lfText = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  return `${lfText.replace(/\n*$/u, "")}\n`;
}

function sourceMarkers(source: string, sourcePath: string): SourceMarkers {
  const values = new Map<string, string>();

  for (const line of source.split("\n")) {
    const match = /^\.\\" termin\.al-(name|usage|summary): (.+)$/u.exec(line);

    if (match === null) {
      continue;
    }

    const markerName = match[1];
    const markerValue = match[2];

    if (markerName === undefined || markerValue === undefined) {
      throw new Error(`${sourcePath} contains a malformed termin.al marker.`);
    }

    if (values.has(markerName)) {
      throw new Error(`${sourcePath} repeats the termin.al-${markerName} marker.`);
    }

    values.set(markerName, markerValue);
  }

  for (const markerName of markerNames) {
    if (!values.has(markerName)) {
      throw new Error(`${sourcePath} is missing the termin.al-${markerName} marker.`);
    }
  }

  const name = values.get("name");
  const usage = values.get("usage");
  const summary = values.get("summary");

  if (name === undefined || usage === undefined || summary === undefined) {
    throw new Error(`${sourcePath} has incomplete termin.al markers.`);
  }

  return { name, usage, summary };
}

function validateSource(
  source: string,
  sourcePath: string,
  canonicalName: string,
): SourceMarkers {
  validateSafeText(source, sourcePath);

  if (source.includes("\r")) {
    throw new Error(`${sourcePath} must use LF line endings.`);
  }

  if (!source.endsWith("\n")) {
    throw new Error(`${sourcePath} must end with one newline.`);
  }

  const escapedName = canonicalName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const titlePattern = new RegExp(
    `^\\.TH ${escapedName.toUpperCase()} 1(?: |$)`,
    "mu",
  );
  const titleLines = source.split("\n").filter((line) => line.startsWith(".TH "));

  if (titleLines.length !== 1) {
    throw new Error(`${sourcePath} must contain exactly one .TH declaration.`);
  }

  if (!titlePattern.test(source)) {
    throw new Error(`${sourcePath} must contain .TH ${canonicalName.toUpperCase()} 1.`);
  }

  const markers = sourceMarkers(source, sourcePath);

  if (markers.name !== canonicalName) {
    throw new Error(
      `${sourcePath} declares canonical name '${markers.name}', expected '${canonicalName}'.`,
    );
  }

  return markers;
}

function renderWithGroff(
  sourcePath: string,
  groffExecutable: string,
): Buffer {
  const result = spawnSync(
    groffExecutable,
    ["-Tutf8", "-man", "-P-c", "-P-u", sourcePath],
    {
      encoding: "buffer",
      env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
      maxBuffer: 16 * 1024 * 1024,
    },
  );

  if (result.error !== undefined) {
    throw new Error(`Failed to execute groff for ${sourcePath}.`, {
      cause: result.error,
    });
  }

  const stderr = decodeUtf8(result.stderr, `${sourcePath} groff stderr`).trim();

  if (result.status !== 0 || stderr.length > 0) {
    const detail = stderr.length === 0 ? `exit status ${result.status ?? "unknown"}` : stderr;
    throw new Error(`groff failed for ${sourcePath}: ${detail}`);
  }

  return result.stdout;
}

function generatedManpage(
  repositoryRoot: string,
  canonicalName: string,
  groffExecutable: string,
): GeneratedManpage {
  const sourcePath = join(repositoryRoot, "man", `${canonicalName}.1`);
  const artifactPath = join(
    repositoryRoot,
    "ui",
    "src",
    "generated",
    "manpages",
    `${canonicalName}.txt`,
  );
  const sourceBytes = readFileSync(sourcePath);
  const source = decodeUtf8(sourceBytes, normalizedRepositoryPath(repositoryRoot, sourcePath));
  const markers = validateSource(
    source,
    normalizedRepositoryPath(repositoryRoot, sourcePath),
    canonicalName,
  );
  const rendered = decodeUtf8(
    renderWithGroff(sourcePath, groffExecutable),
    normalizedRepositoryPath(repositoryRoot, artifactPath),
  );
  validateSafeText(rendered, normalizedRepositoryPath(repositoryRoot, artifactPath));
  const artifact = Buffer.from(normalizeGeneratedText(rendered), "utf8");
  const artifactText = decodeUtf8(
    artifact,
    normalizedRepositoryPath(repositoryRoot, artifactPath),
  );
  validateSafeText(artifactText, normalizedRepositoryPath(repositoryRoot, artifactPath));

  return {
    name: canonicalName,
    artifact,
    entry: {
      name: canonicalName,
      section: 1,
      usage: markers.usage,
      summary: markers.summary,
      sourcePath: normalizedRepositoryPath(repositoryRoot, sourcePath),
      artifactPath: normalizedRepositoryPath(repositoryRoot, artifactPath),
      byteCount: artifact.byteLength,
      lineCount: artifactText.split("\n").length - 1,
      sha256: createHash("sha256").update(artifact).digest("hex"),
    },
  };
}

function exactBasenames(directory: string, extension: string): ReadonlyArray<string> {
  try {
    return sorted(
      readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
        .map((entry) => entry.name.slice(0, -extension.length)),
    );
  } catch (error: unknown) {
    throw new Error(`Unable to enumerate ${directory}.`, { cause: error });
  }
}

function requireExactNames(
  actualNames: ReadonlyArray<string>,
  expectedNames: ReadonlyArray<string>,
  label: string,
): void {
  const actual = sorted(actualNames);
  const expected = sorted(expectedNames);

  if (actual.join("\n") === expected.join("\n")) {
    return;
  }

  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = expected.filter((name) => !actualSet.has(name));
  const extra = actual.filter((name) => !expectedSet.has(name));
  throw new Error(
    `${label} coverage mismatch; missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"}.`,
  );
}

function manifestBytes(entries: ReadonlyArray<GeneratedManpageManifestEntry>): Buffer {
  const manifest: GeneratedManpageManifest = { entries };
  return Buffer.from(`${JSON.stringify(manifest, undefined, 2)}\n`, "utf8");
}

function verifyExactFile(path: string, expected: Buffer, label: string): void {
  let actual: Buffer;

  try {
    actual = readFileSync(path);
  } catch (error: unknown) {
    throw new Error(`${label} is missing: ${path}.`, { cause: error });
  }

  if (!actual.equals(expected)) {
    throw new Error(`${label} is stale or manually modified: ${path}.`);
  }
}

export function runManpageGeneration({
  repositoryRoot,
  mode,
  groffExecutable = "groff",
}: ManpageGenerationOptions): GeneratedManpageManifest {
  const root = resolve(repositoryRoot);
  const sourceDirectory = join(root, "man");
  const artifactDirectory = join(root, "ui", "src", "generated", "manpages");
  const manifestPath = join(root, "ui", "src", "generated", "manpages-manifest.json");
  const canonicalNames = sorted(acceptedCanonicalNames);
  requireExactNames(
    exactBasenames(sourceDirectory, ".1"),
    canonicalNames,
    "Roff source",
  );

  const generated = canonicalNames.map((name) =>
    generatedManpage(root, name, groffExecutable)
  );
  const entries = generated.map(({ entry }) => entry);
  const expectedManifest = manifestBytes(entries);

  if (mode === "generate") {
    mkdirSync(artifactDirectory, { recursive: true });

    for (const entry of readdirSync(artifactDirectory, { withFileTypes: true })) {
      const path = join(artifactDirectory, entry.name);

      if (entry.isFile() && entry.name.endsWith(".txt")) {
        rmSync(path);
      }
    }

    for (const page of generated) {
      writeFileSync(join(artifactDirectory, `${page.name}.txt`), page.artifact);
    }

    mkdirSync(dirname(manifestPath), { recursive: true });
    writeFileSync(manifestPath, expectedManifest);
  } else {
    const artifactNames = exactBasenames(artifactDirectory, ".txt");
    requireExactNames(artifactNames, canonicalNames, "Generated artifact");

    for (const page of generated) {
      const path = join(artifactDirectory, `${page.name}.txt`);
      verifyExactFile(path, page.artifact, `Generated artifact for ${page.name}`);
    }

    verifyExactFile(manifestPath, expectedManifest, "Generated manifest");
  }

  return { entries };
}

function generationMode(argumentsList: ReadonlyArray<string>): ManpageGenerationMode {
  if (argumentsList.length === 0) {
    return "generate";
  }

  if (argumentsList.length === 1 && argumentsList[0] === "--check") {
    return "check";
  }

  throw new Error("Usage: generate-manpages.ts [--check]");
}

function main(): void {
  const scriptPath = fileURLToPath(import.meta.url);
  const repositoryRoot = resolve(dirname(scriptPath), "..");
  const argumentsList = process.argv.slice(2);
  const mode = generationMode(argumentsList);
  const manifest = runManpageGeneration({ repositoryRoot, mode });
  process.stdout.write(
    `${mode === "check" ? "Verified" : "Generated"} ${manifest.entries.length} manpages.\n`,
  );
}

const executedPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);

if (executedPath === fileURLToPath(import.meta.url)) {
  main();
}
