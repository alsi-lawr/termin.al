import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repositoryRoot = resolve(import.meta.dirname, "..");
const uiRoot = join(repositoryRoot, "ui");
const generatedRoot = join(uiRoot, "src", "generated", "browser");
const protoRoot = join(repositoryRoot, "contracts");
const protoPath = join(protoRoot, "browser.proto");
const generatedFiles = [
  "browser.client.ts",
  "browser.ts",
] as const;

function generatorPath(packageName: string): string {
  return join(uiRoot, "node_modules", ".bin", packageName);
}

function protocPath(): string {
  if (process.platform !== "linux" || process.arch !== "x64") {
    throw new Error("Browser gRPC generation requires the repository's x86_64 Linux development shell.");
  }

  const packagesRoot = process.env.NUGET_PACKAGES ?? join(homedir(), ".nuget", "packages");
  return join(packagesRoot, "grpc.tools", "2.82.0", "tools", "linux_x64", "protoc");
}

function generate(outputRoot: string): void {
  const result = spawnSync(
    protocPath(),
    [
      "-I",
      protoRoot,
      protoPath,
      `--plugin=protoc-gen-ts=${generatorPath("protoc-gen-ts")}`,
      `--ts_out=${outputRoot}`,
    ],
    { encoding: "utf8" },
  );

  if (result.error !== undefined) {
    throw new Error("Failed to execute the pinned protobuf compiler.", { cause: result.error });
  }

  if (result.status !== 0) {
    throw new Error(`Browser gRPC generation failed: ${result.stderr.trim()}`);
  }
}

async function normalizeGeneratedFiles(outputRoot: string): Promise<void> {
  for (const file of generatedFiles) {
    const path = join(outputRoot, file);
    const source = await readFile(path, "utf8");
    const normalized = source
      .replace("// tslint:disable\n", "")
      .replaceAll("(this.messagePrototype!)", "(this.messagePrototype ?? {})")
      .replaceAll(
        "    constructor(private readonly _transport: RpcTransport) {\n    }",
        "    private readonly _transport: RpcTransport;\n    constructor(transport: RpcTransport) {\n        this._transport = transport;\n    }",
      )
      .replace(
        /export enum SessionKind \{[\s\S]*?\n\}/u,
        "export const SessionKind = { UNSPECIFIED: 0, ANONYMOUS: 1, GITHUB_VIEWER: 2, CV_VIEWER: 3, GITHUB_CV_VIEWER: 4, OWNER: 5 } as const;\nexport type SessionKind = number;",
      )
      .replace(
        /export enum CacheState \{[\s\S]*?\n\}/u,
        "export const CacheState = { UNSPECIFIED: 0, FRESH: 1, STALE: 2 } as const;\nexport type CacheState = number;",
      )
      .replace(
        /export enum CatalogEntryKind \{[\s\S]*?\n\}/u,
        "export const CatalogEntryKind = { UNSPECIFIED: 0, DIRECTORY: 1, FILE: 2, LOCKED_FILE: 3 } as const;\nexport type CatalogEntryKind = number;",
      );
    await writeFile(path, normalized);
  }
}

async function assertExpectedFiles(outputRoot: string): Promise<void> {
  const actualFiles = (await readdir(outputRoot)).sort();
  const expectedFiles = [...generatedFiles].sort();

  if (actualFiles.join("\n") !== expectedFiles.join("\n")) {
    throw new Error("The browser gRPC generated file set changed unexpectedly.");
  }
}

async function checkGeneratedFiles(candidateRoot: string): Promise<void> {
  for (const file of generatedFiles) {
    const [expected, candidate] = await Promise.all([
      readFile(join(generatedRoot, file)),
      readFile(join(candidateRoot, file)),
    ]);

    if (!expected.equals(candidate)) {
      throw new Error(`Generated browser gRPC artifact is stale: ${file}`);
    }
  }
}

async function main(): Promise<void> {
  const check = process.argv.slice(2).includes("--check");
  const outputRoot = check
    ? await mkdtemp(join(tmpdir(), "termin-al-browser-grpc-"))
    : generatedRoot;

  await mkdir(outputRoot, { recursive: true });
  generate(outputRoot);
  await normalizeGeneratedFiles(outputRoot);
  await assertExpectedFiles(outputRoot);

  if (check) {
    try {
      await checkGeneratedFiles(outputRoot);
      process.stdout.write("Verified generated browser gRPC artifacts.\n");
    } finally {
      await rm(outputRoot, { recursive: true });
    }
    return;
  }

  process.stdout.write("Generated browser gRPC artifacts.\n");
}

await main();
