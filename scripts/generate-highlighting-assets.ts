import { mkdir, readdir, rm } from "node:fs/promises";
import { basename, join, relative } from "node:path";

type JsonObject = Readonly<Record<string, unknown>>;

type LanguageSource = Readonly<{
  aliases: ReadonlyArray<string>;
  tmScope: string;
}>;

type Asset = Readonly<{
  path: string;
  sha256: string;
  bytes: number;
  gzipBytes: number;
  kind: "grammar" | "notice" | "query" | "runtime-wasm" | "tree-wasm";
}>;

type TreeVariantSource = Readonly<{
  name: string;
  wasm: string;
  highlights: ReadonlyArray<string>;
  injections: ReadonlyArray<string>;
}>;

type TreeRouteSource = Readonly<{
  canonical: string;
  repository: string;
  tag: string;
  commit: string;
  directory: string;
  variants: ReadonlyArray<TreeVariantSource>;
}>;

const linguistCommit = "1d7ac7ed569bd6edef5d0cfc73feea2573cb0e03";
const linguistVersion = "9.6.0";
const codeQlCommit = "a6266bbcc88702619ceb580253a65e8f83333c1b";
const codeQlSourceSha256 = "ec0006acda3dbc2aaaf546d2ff7d170b9ea2ee29033ba9a886c5dd8caad6e779";
const codeQlLicenseSha256 = "30f92d61bc8e9ae50a61fec695de14028363adb2ad7b8808816895ff7b230402";
const excludedCanonical = "Genshi";
const expectedCatalogueRecords = 814;
const expectedAliases = 1237;
const expectedPlainRecords = 64;
const expectedTextMateRecords = 731;
const expectedTreeRecords = 19;

const treeRoutes: ReadonlyArray<TreeRouteSource> = [
  { canonical: "C", repository: "tree-sitter/tree-sitter-c", tag: "v0.24.2", commit: "b780e47fc780ddc8da13afa35a3f4ed5c157823d", directory: "tree-sitter-c-b780e47fc780ddc8da13afa35a3f4ed5c157823d", variants: [{ name: "c", wasm: "tree-sitter-c.wasm", highlights: ["queries/highlights.scm"], injections: [] }] },
  { canonical: "C#", repository: "tree-sitter/tree-sitter-c-sharp", tag: "v0.23.5", commit: "cac6d5fb595f5811a076336682d5d595ac1c9e85", directory: "tree-sitter-c-sharp-cac6d5fb595f5811a076336682d5d595ac1c9e85", variants: [{ name: "c_sharp", wasm: "tree-sitter-c_sharp.wasm", highlights: ["queries/highlights.scm"], injections: [] }] },
  { canonical: "CSS", repository: "tree-sitter/tree-sitter-css", tag: "v0.25.0", commit: "dda5cfc5722c429eaba1c910ca32c2c0c5bb1a3f", directory: "tree-sitter-css-dda5cfc5722c429eaba1c910ca32c2c0c5bb1a3f", variants: [{ name: "css", wasm: "tree-sitter-css.wasm", highlights: ["queries/highlights.scm"], injections: [] }] },
  { canonical: "EJS", repository: "tree-sitter/tree-sitter-embedded-template", tag: "v0.25.0", commit: "c70c1de07dedd532089c0c90835c8ed9fa694f5c", directory: "tree-sitter-embedded-template-c70c1de07dedd532089c0c90835c8ed9fa694f5c", variants: [{ name: "embedded_template", wasm: "tree-sitter-embedded_template.wasm", highlights: ["queries/highlights.scm"], injections: ["queries/injections-ejs.scm"] }] },
  { canonical: "Elixir", repository: "elixir-lang/tree-sitter-elixir", tag: "v0.3.5", commit: "e2d9e6e0e76b0c436fa48a0b8c32a031d0cbdf49", directory: "tree-sitter-elixir-e2d9e6e0e76b0c436fa48a0b8c32a031d0cbdf49", variants: [{ name: "elixir", wasm: "tree-sitter-elixir.wasm", highlights: ["queries/highlights.scm"], injections: [] }] },
  { canonical: "Gleam", repository: "gleam-lang/tree-sitter-gleam", tag: "v1.1.0", commit: "dae1551a9911b24f41d876c23f2ab05ece0a9d4c", directory: "tree-sitter-gleam-dae1551a9911b24f41d876c23f2ab05ece0a9d4c", variants: [{ name: "gleam", wasm: "tree-sitter-gleam.wasm", highlights: ["queries/highlights.scm"], injections: ["queries/injections.scm"] }] },
  { canonical: "Go", repository: "tree-sitter/tree-sitter-go", tag: "v0.25.0", commit: "1547678a9da59885853f5f5cc8a99cc203fa2e2c", directory: "tree-sitter-go-1547678a9da59885853f5f5cc8a99cc203fa2e2c", variants: [{ name: "go", wasm: "tree-sitter-go.wasm", highlights: ["queries/highlights.scm"], injections: [] }] },
  { canonical: "HTML", repository: "tree-sitter/tree-sitter-html", tag: "v0.23.2", commit: "5a5ca8551a179998360b4a4ca2c0f366a35acc03", directory: "tree-sitter-html-5a5ca8551a179998360b4a4ca2c0f366a35acc03", variants: [{ name: "html", wasm: "tree-sitter-html.wasm", highlights: ["queries/highlights.scm"], injections: ["queries/injections.scm"] }] },
  { canonical: "Java", repository: "tree-sitter/tree-sitter-java", tag: "v0.23.5", commit: "94703d5a6bed02b98e438d7cad1136c01a60ba2c", directory: "tree-sitter-java-94703d5a6bed02b98e438d7cad1136c01a60ba2c", variants: [{ name: "java", wasm: "tree-sitter-java.wasm", highlights: ["queries/highlights.scm"], injections: [] }] },
  { canonical: "JavaScript", repository: "tree-sitter/tree-sitter-javascript", tag: "v0.25.0", commit: "44c892e0be055ac465d5eeddae6d3e194424e7de", directory: "tree-sitter-javascript-44c892e0be055ac465d5eeddae6d3e194424e7de", variants: [{ name: "javascript", wasm: "tree-sitter-javascript.wasm", highlights: ["queries/highlights.scm", "queries/highlights-jsx.scm", "queries/highlights-params.scm"], injections: [] }] },
  { canonical: "Nix", repository: "nix-community/tree-sitter-nix", tag: "v0.3.0", commit: "ea1d87f7996be1329ef6555dcacfa63a69bd55c6", directory: "tree-sitter-nix-ea1d87f7996be1329ef6555dcacfa63a69bd55c6", variants: [{ name: "nix", wasm: "tree-sitter-nix.wasm", highlights: ["queries/highlights.scm"], injections: [] }] },
  { canonical: "PHP", repository: "tree-sitter/tree-sitter-php", tag: "v0.24.2", commit: "5b5627faaa290d89eb3d01b9bf47c3bb9e797dea", directory: "tree-sitter-php-5b5627faaa290d89eb3d01b9bf47c3bb9e797dea", variants: [
    { name: "php_only", wasm: "tree-sitter-php_only.wasm", highlights: ["queries/highlights.scm"], injections: ["queries/injections.scm"] },
  ] },
  { canonical: "Python", repository: "tree-sitter/tree-sitter-python", tag: "v0.25.0", commit: "293fdc02038ee2bf0e2e206711b69c90ac0d413f", directory: "tree-sitter-python-293fdc02038ee2bf0e2e206711b69c90ac0d413f", variants: [{ name: "python", wasm: "tree-sitter-python.wasm", highlights: ["queries/highlights.scm"], injections: [] }] },
  { canonical: "Regular Expression", repository: "tree-sitter/tree-sitter-regex", tag: "v1.0.0", commit: "17a3293714312c691ef14217f60593a3d093381c", directory: "tree-sitter-regex-17a3293714312c691ef14217f60593a3d093381c", variants: [{ name: "regex", wasm: "tree-sitter-regex.wasm", highlights: ["queries/highlights.scm"], injections: [] }] },
  { canonical: "Ruby", repository: "tree-sitter/tree-sitter-ruby", tag: "v0.23.1", commit: "71bd32fb7607035768799732addba884a37a6210", directory: "tree-sitter-ruby-71bd32fb7607035768799732addba884a37a6210", variants: [{ name: "ruby", wasm: "tree-sitter-ruby.wasm", highlights: ["queries/highlights.scm"], injections: [] }] },
  { canonical: "Rust", repository: "tree-sitter/tree-sitter-rust", tag: "v0.24.2", commit: "77a3747266f4d621d0757825e6b11edcbf991ca5", directory: "tree-sitter-rust-77a3747266f4d621d0757825e6b11edcbf991ca5", variants: [{ name: "rust", wasm: "tree-sitter-rust.wasm", highlights: ["queries/highlights.scm"], injections: ["queries/injections.scm"] }] },
  { canonical: "Swift", repository: "alex-pinkus/tree-sitter-swift", tag: "0.7.3", commit: "b8b22bffbb3441780e6471665bacfb263741c86a", directory: "tree-sitter-swift-b8b22bffbb3441780e6471665bacfb263741c86a", variants: [{ name: "swift", wasm: "tree-sitter-swift.wasm", highlights: ["queries/highlights.scm"], injections: ["queries/injections.scm"] }] },
  { canonical: "TLA", repository: "tlaplus-community/tree-sitter-tlaplus", tag: "v1.2.4", commit: "c10ad7e82aa4d77fcb5c4aaec193c9f2dfd3afcb", directory: "tree-sitter-tlaplus-c10ad7e82aa4d77fcb5c4aaec193c9f2dfd3afcb", variants: [{ name: "tlaplus", wasm: "tree-sitter-tlaplus.wasm", highlights: ["queries/highlights.scm"], injections: [] }] },
  { canonical: "TypeScript", repository: "tree-sitter/tree-sitter-typescript", tag: "v0.23.2", commit: "f975a621f4e7f532fe322e13c4f79495e0a7b2e7", directory: "tree-sitter-typescript-f975a621f4e7f532fe322e13c4f79495e0a7b2e7", variants: [
    { name: "typescript", wasm: "tree-sitter-typescript.wasm", highlights: ["queries/highlights.scm", "@javascript/queries/highlights.scm"], injections: ["@javascript/queries/injections.scm"] },
  ] },
];

function objectValue(value: unknown, description: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected ${description} to be an object.`);
  }
  return value;
}

function stringValue(value: unknown, description: string): string {
  if (typeof value !== "string") {
    throw new Error(`Expected ${description} to be a string.`);
  }
  return value;
}

function stringArray(value: unknown, description: string): ReadonlyArray<string> {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Expected ${description} to be a string array.`);
  }
  return value;
}

function defaultAlias(name: string): string {
  return name.toLowerCase().replaceAll(/\s/gu, "-");
}

function externalIncludes(value: unknown, includes: Set<string>): void {
  if (Array.isArray(value)) {
    for (const child of value) externalIncludes(child, includes);
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (key === "include" && typeof child === "string") {
      const scope = child.split("#", 1)[0] ?? "";
      if (scope !== "" && !scope.startsWith("#") && scope !== "$base" && scope !== "$self") {
        includes.add(scope);
      }
    }
    externalIncludes(child, includes);
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

function safeName(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9._-]/gu, "_");
}

async function writeAsset(
  output: string,
  assets: Map<string, Asset>,
  logicalName: string,
  directory: string,
  extension: string,
  kind: Asset["kind"],
  bytes: Uint8Array,
): Promise<string> {
  const hash = await sha256(bytes);
  const path = `${directory}/${safeName(logicalName)}.${hash.slice(0, 16)}.${extension}`;
  await mkdir(join(output, directory), { recursive: true });
  await Bun.write(join(output, path), bytes);
  assets.set(path, {
    path,
    sha256: hash,
    bytes: bytes.byteLength,
    gzipBytes: Bun.gzipSync(bytes, { level: 9 }).byteLength,
    kind,
  });
  return path;
}

async function filesRecursively(directory: string): Promise<ReadonlyArray<string>> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: Array<string> = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesRecursively(path));
    if (entry.isFile()) files.push(path);
  }
  return files.sort();
}

function parseGitmodules(text: string): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  const sections = text.split(/^\[submodule /gmu).slice(1);
  for (const section of sections) {
    const path = /^\s*path\s*=\s*(.+)$/mu.exec(section)?.[1]?.trim();
    const url = /^\s*url\s*=\s*(.+)$/mu.exec(section)?.[1]?.trim().replace(/\.git$/u, "");
    if (path !== undefined && url !== undefined) result.set(path, url);
  }
  return result;
}

async function generate(auditRoot: string, output: string, uiRoot: string): Promise<void> {
  const languagesYaml = objectValue(Bun.YAML.parse(await Bun.file(join(auditRoot, "languages.yml")).text()), "languages.yml");
  const languages = new Map<string, LanguageSource>();
  for (const [name, value] of Object.entries(languagesYaml)) {
    const record = objectValue(value, `language ${name}`);
    languages.set(name, {
      aliases: record.aliases === undefined ? [] : stringArray(record.aliases, `${name}.aliases`),
      tmScope: record.tm_scope === undefined ? "none" : stringValue(record.tm_scope, `${name}.tm_scope`),
    });
  }
  if (languages.size !== expectedCatalogueRecords) throw new Error(`Expected ${expectedCatalogueRecords} language records, found ${languages.size}.`);

  const aliases: Record<string, string> = {};
  for (const [canonical, language] of languages) {
    for (const alias of [defaultAlias(canonical), ...language.aliases]) {
      const key = alias.toLowerCase();
      const existing = aliases[key];
      if (existing !== undefined && existing !== canonical) throw new Error(`Alias collision for ${key}: ${existing}, ${canonical}.`);
      aliases[key] = canonical;
    }
  }
  if (Object.keys(aliases).length !== expectedAliases) throw new Error(`Expected ${expectedAliases} aliases.`);

  const treeByCanonical = new Map(treeRoutes.map((route) => [route.canonical, route]));
  if (treeByCanonical.has("CodeQL")) throw new Error("CodeQL must not have a Tree-sitter route.");

  const grammarDirectory = join(auditRoot, "linguist-grammars");
  const grammarByScope = new Map<string, Readonly<{ bytes: Uint8Array; dependencies: ReadonlyArray<string> }>>();
  for (const file of (await readdir(grammarDirectory)).filter((name) => name.endsWith(".json")).sort()) {
    const bytes = await Bun.file(join(grammarDirectory, file)).bytes();
    const grammar = objectValue(JSON.parse(new TextDecoder().decode(bytes)), file);
    const scope = stringValue(grammar.scopeName, `${file}.scopeName`);
    const dependencies = new Set<string>();
    externalIncludes(grammar, dependencies);
    grammarByScope.set(scope, { bytes, dependencies: [...dependencies].sort() });
  }

  const grammarSourceYaml = objectValue(Bun.YAML.parse(await Bun.file(join(auditRoot, "linguist-source", "grammars.yml")).text()), "grammars.yml");
  const sourceByScope = new Map<string, string>();
  for (const [sourcePath, scopes] of Object.entries(grammarSourceYaml)) {
    for (const scope of stringArray(scopes, `grammars.yml ${sourcePath}`)) sourceByScope.set(scope, sourcePath);
  }

  const gitTree = objectValue(await Bun.file(join(auditRoot, "linguist-git-tree.json")).json(), "Linguist git tree");
  if (!Array.isArray(gitTree.tree)) throw new Error("Expected Linguist git tree entries.");
  const gitlinks: Array<Readonly<{ path: string; sha: string }>> = [];
  for (const value of gitTree.tree) {
    const entry = objectValue(value, "git tree entry");
    if (entry.mode === "160000" && typeof entry.path === "string" && typeof entry.sha === "string") {
      gitlinks.push({ path: entry.path, sha: entry.sha });
    }
  }
  gitlinks.sort((left, right) => right.path.length - left.path.length);
  const moduleUrls = parseGitmodules(await Bun.file(join(auditRoot, "linguist-source", ".gitmodules")).text());

  const licenseFiles = (await filesRecursively(join(auditRoot, "linguist-source", "vendor", "licenses"))).filter((path) => path !== join(auditRoot, "linguist-source", "vendor", "licenses", "config.yml"));
  const licenseByVersion = new Map<string, Readonly<{ id: string; path: string }>>();
  for (const path of licenseFiles) {
    const text = await Bun.file(path).text();
    const yaml = path.endsWith(".txt") ? text.split("---", 3)[1] : text;
    if (yaml === undefined) throw new Error(`Missing licence front matter in ${path}.`);
    const record = objectValue(Bun.YAML.parse(yaml), `licence ${path}`);
    if (typeof record.version === "string" && typeof record.license === "string") {
      licenseByVersion.set(record.version, { id: record.license, path });
    }
  }

  const languageEntries: Record<string, unknown> = {};
  const textMateRoots = new Set<string>();
  let plainCount = 0;
  let textMateCount = 0;
  let treeCount = 0;
  for (const [canonical, language] of languages) {
    const tree = treeByCanonical.get(canonical);
    if (canonical === excludedCanonical || language.tmScope === "none") {
      languageEntries[canonical] = { kind: "plain", reason: canonical === excludedCanonical ? "excluded-unverifiable-source" : "upstream-no-grammar" };
      plainCount += 1;
    } else if (tree !== undefined) {
      languageEntries[canonical] = { kind: "tree-sitter", scope: language.tmScope, variants: [] };
      treeCount += 1;
    } else {
      languageEntries[canonical] = { kind: "textmate", scope: language.tmScope, closure: [] };
      textMateRoots.add(language.tmScope);
      textMateCount += 1;
    }
  }
  if (plainCount !== expectedPlainRecords || textMateCount !== expectedTextMateRecords || treeCount !== expectedTreeRecords) {
    throw new Error(`Unexpected route counts: plain=${plainCount}, textmate=${textMateCount}, tree=${treeCount}.`);
  }

  const closureFor = (root: string): ReadonlyArray<string> => {
    const found = new Set<string>();
    const pending = [root];
    while (pending.length > 0) {
      const scope = pending.pop();
      if (scope === undefined || found.has(scope)) continue;
      if (scope === "text.xml.genshi") throw new Error(`${root} depends on excluded Genshi grammar.`);
      const grammar = grammarByScope.get(scope);
      if (grammar === undefined) throw new Error(`Missing TextMate dependency ${scope} for ${root}.`);
      found.add(scope);
      pending.push(...grammar.dependencies);
    }
    return [...found].sort();
  };

  const requiredScopes = new Set<string>();
  const closures = new Map<string, ReadonlyArray<string>>();
  for (const root of textMateRoots) {
    const closure = closureFor(root);
    closures.set(root, closure);
    for (const scope of closure) requiredScopes.add(scope);
  }

  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  const assets = new Map<string, Asset>();
  const usedLicensePaths = new Set<string>();
  const textMateEntries: Record<string, unknown> = {};
  for (const scope of [...requiredScopes].sort()) {
    const grammar = grammarByScope.get(scope);
    if (grammar === undefined) throw new Error(`Missing required grammar ${scope}.`);
    const asset = await writeAsset(output, assets, scope, "grammars", "json", "grammar", grammar.bytes);
    const sourcePath = sourceByScope.get(scope);
    if (sourcePath === undefined) throw new Error(`Missing source provenance for ${scope}.`);
    let repository: string;
    let revision: string;
    let license: string;
    if (scope === "source.ql") {
      repository = "https://github.com/github/vscode-codeql";
      revision = codeQlCommit;
      license = "mit";
    } else {
      const gitlink = gitlinks.find((entry) => sourcePath === entry.path || sourcePath.startsWith(`${entry.path}/`));
      if (gitlink === undefined) throw new Error(`Missing pinned gitlink for ${scope} from ${sourcePath}.`);
      const licenseRecord = licenseByVersion.get(gitlink.sha);
      if (licenseRecord === undefined) throw new Error(`Missing licence for ${scope} at ${gitlink.sha}.`);
      usedLicensePaths.add(licenseRecord.path);
      repository = moduleUrls.get(gitlink.path) ?? gitlink.path;
      revision = gitlink.sha;
      license = licenseRecord.id;
    }
    const verifiedHashes = scope === "source.ql"
      ? { sourceSha256: codeQlSourceSha256, licenseSha256: codeQlLicenseSha256 }
      : {};
    textMateEntries[scope] = { asset, dependencies: grammar.dependencies, source: { repository, revision, license, ...verifiedHashes } };
  }

  for (const [canonical, entryValue] of Object.entries(languageEntries)) {
    const entry = objectValue(entryValue, canonical);
    if (entry.kind === "textmate") {
      const scope = stringValue(entry.scope, `${canonical}.scope`);
      languageEntries[canonical] = { ...entry, closure: closures.get(scope) ?? [] };
    }
  }

  const treeEntries: Record<string, unknown> = {};
  const treeSourceRoot = join(auditRoot, "tree-sitter-sources", "extracted");
  const treeBuildRoot = join(auditRoot, "tree-sitter-build");
  const javascriptDirectory = treeRoutes.find((route) => route.canonical === "JavaScript")?.directory;
  if (javascriptDirectory === undefined) throw new Error("Missing JavaScript route source.");
  for (const route of treeRoutes) {
    const variants: Array<unknown> = [];
    const sourceDirectory = join(treeSourceRoot, route.directory);
    const licensePath = (await readdir(sourceDirectory)).find((name) => /^LICENSE(?:\.|$)/iu.test(name));
    if (licensePath === undefined) throw new Error(`Missing licence for ${route.repository}.`);
    const routeLicensePath = join(sourceDirectory, licensePath);
    for (const variant of route.variants) {
      const wasmBytes = await Bun.file(join(treeBuildRoot, variant.wasm)).bytes();
      const wasm = await writeAsset(output, assets, variant.name, "trees", "wasm", "tree-wasm", wasmBytes);
      const queryBytes = async (paths: ReadonlyArray<string>): Promise<Uint8Array> => {
        const texts: Array<string> = [];
        for (const path of paths) {
          const javascriptPath = path.startsWith("@javascript/");
          const relativePath = javascriptPath ? path.slice("@javascript/".length) : path;
          const directory = javascriptPath ? join(treeSourceRoot, javascriptDirectory) : sourceDirectory;
          texts.push(await Bun.file(join(directory, relativePath)).text());
        }
        const normalized = texts.join("\n").replaceAll(/[ \t]+$/gmu, "").trimEnd();
        return new TextEncoder().encode(`${normalized}\n`);
      };
      const highlights = await writeAsset(output, assets, `${variant.name}-highlights`, "trees", "scm", "query", await queryBytes(variant.highlights));
      const injections = variant.injections.length === 0
        ? undefined
        : await writeAsset(output, assets, `${variant.name}-injections`, "trees", "scm", "query", await queryBytes(variant.injections));
      variants.push({ name: variant.name, wasm, highlights, injections });
    }
    treeEntries[route.canonical] = { repository: route.repository, tag: route.tag, revision: route.commit, license: basename(routeLicensePath), variants };
    const languageEntry = objectValue(languageEntries[route.canonical], route.canonical);
    languageEntries[route.canonical] = { ...languageEntry, variants: objectValue(treeEntries[route.canonical], route.canonical).variants };
  }

  const runtimeRoot = join(uiRoot, "node_modules");
  const onigWasm = await writeAsset(output, assets, "onig", "runtime", "wasm", "runtime-wasm", await Bun.file(join(runtimeRoot, "vscode-oniguruma", "release", "onig.wasm")).bytes());
  const treeRuntimeWasm = await writeAsset(output, assets, "web-tree-sitter", "runtime", "wasm", "runtime-wasm", await Bun.file(join(runtimeRoot, "web-tree-sitter", "web-tree-sitter.wasm")).bytes());

  const noticeParts: Array<string> = [
    `# Third-party syntax highlighting notices\n\nGenerated from pinned sources.\n`,
    `## GitHub Linguist\n\n${await Bun.file(join(auditRoot, "linguist-source", "LICENSE")).text()}\n`,
  ];
  for (const path of [...usedLicensePaths].sort()) {
    noticeParts.push(`## Linguist grammar source: ${basename(path)}\n\n${await Bun.file(path).text()}\n`);
  }
  noticeParts.push(`## github/vscode-codeql at ${codeQlCommit}\n\n${await Bun.file(join(auditRoot, "codeql-LICENSE.md")).text()}\n`);
  for (const route of treeRoutes) {
    const directory = join(treeSourceRoot, route.directory);
    const licenseName = (await readdir(directory)).find((name) => /^LICENSE(?:\.|$)/iu.test(name));
    if (licenseName === undefined) throw new Error(`Missing licence for ${route.repository}.`);
    noticeParts.push(`## ${route.repository} at ${route.commit}\n\n${await Bun.file(join(directory, licenseName)).text()}\n`);
  }
  for (const [name, path] of [
    ["vscode-textmate", join(runtimeRoot, "vscode-textmate", "LICENSE.md")],
    ["vscode-oniguruma", join(runtimeRoot, "vscode-oniguruma", "LICENSE.txt")],
    ["vscode-oniguruma notices", join(runtimeRoot, "vscode-oniguruma", "NOTICES.txt")],
    ["web-tree-sitter", join(runtimeRoot, "web-tree-sitter", "LICENSE")],
  ] as const) {
    noticeParts.push(`## ${name}\n\n${await Bun.file(path).text()}\n`);
  }
  const noticeText = `${noticeParts.join("\n").trimEnd()}\n`;
  const notice = await writeAsset(output, assets, "THIRD-PARTY-NOTICES", "notices", "md", "notice", new TextEncoder().encode(noticeText));

  const manifest = {
    schemaVersion: 1,
    linguist: { version: linguistVersion, commit: linguistCommit },
    counts: { canonical: languages.size, aliases: Object.keys(aliases).length, plain: plainCount, textmate: textMateCount, treeSitter: treeCount, highlighted: textMateCount + treeCount },
    aliases: Object.fromEntries(Object.entries(aliases).sort()),
    languages: Object.fromEntries(Object.entries(languageEntries).sort()),
    textmateScopes: Object.fromEntries(Object.entries(textMateEntries).sort()),
    treeSources: Object.fromEntries(Object.entries(treeEntries).sort()),
    runtimes: { vscodeTextmate: "9.3.2", vscodeOniguruma: "2.0.1", webTreeSitter: "0.26.11", onigWasm, treeRuntimeWasm },
    notice,
    assets: Object.fromEntries([...assets].sort()),
  };
  const manifestBytes = new TextEncoder().encode(`${JSON.stringify(manifest)}\n`);
  await Bun.write(join(output, "manifest.json"), manifestBytes);
  console.log(`Generated ${languages.size} languages, ${assets.size} assets, and ${manifestBytes.byteLength} manifest bytes.`);
}

async function check(output: string): Promise<void> {
  const manifest = objectValue(await Bun.file(join(output, "manifest.json")).json(), "highlighting manifest");
  const counts = objectValue(manifest.counts, "manifest counts");
  if (counts.canonical !== expectedCatalogueRecords || counts.aliases !== expectedAliases || counts.plain !== expectedPlainRecords || counts.textmate !== expectedTextMateRecords || counts.treeSitter !== expectedTreeRecords || counts.highlighted !== 750) {
    throw new Error("Generated highlighting counts do not match the accepted corpus.");
  }
  const assets = objectValue(manifest.assets, "manifest assets");
  for (const [key, value] of Object.entries(assets)) {
    const asset = objectValue(value, `asset ${key}`);
    const path = stringValue(asset.path, `${key}.path`);
    const expectedHash = stringValue(asset.sha256, `${key}.sha256`);
    const bytes = await Bun.file(join(output, path)).bytes();
    if (await sha256(bytes) !== expectedHash || bytes.byteLength !== asset.bytes) throw new Error(`Generated asset mismatch: ${path}.`);
  }
  const allFiles = (await filesRecursively(output)).map((path) => relative(output, path)).filter((path) => path !== "manifest.json").sort();
  const expectedFiles = Object.keys(assets).sort();
  if (JSON.stringify(allFiles) !== JSON.stringify(expectedFiles)) throw new Error("Generated highlighting directory contains missing or untracked assets.");
  const languages = objectValue(manifest.languages, "manifest languages");
  const genshi = objectValue(languages.Genshi, "Genshi route");
  if (genshi.kind !== "plain") throw new Error("Genshi must remain exact plain text.");
  const codeQl = objectValue(languages.CodeQL, "CodeQL route");
  if (codeQl.kind !== "textmate" || codeQl.scope !== "source.ql") throw new Error("CodeQL must use the reconciled TextMate grammar.");
  for (const path of allFiles) {
    if (/tree-sitter-ql|source\.genshi|text\.xml\.genshi/iu.test(path)) throw new Error(`Excluded asset was generated: ${path}.`);
  }
  console.log(`Verified ${Object.keys(languages).length} languages and ${expectedFiles.length} highlighting assets.`);
}

const argumentsList = process.argv.slice(2);
const root = join(import.meta.dir, "..");
const defaultOutput = join(root, "ui", "public", "highlighting");
if (argumentsList.includes("--check")) {
  await check(defaultOutput);
} else {
  const auditIndex = argumentsList.indexOf("--audit-root");
  const auditRoot = auditIndex < 0 ? undefined : argumentsList[auditIndex + 1];
  if (auditRoot === undefined) throw new Error("Usage: bun scripts/generate-highlighting-assets.ts --audit-root <task-scratch>");
  await generate(auditRoot, defaultOutput, join(root, "ui"));
}
