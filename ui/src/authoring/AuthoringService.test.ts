import assert from "node:assert/strict";
import test from "node:test";
import type { ContentCorpus } from "../api/ContentClient.ts";
import type { CvClient } from "../api/CvClient.ts";
import type { AuthenticatedLogin, SessionClient } from "../api/SessionClient.ts";
import type { PublicationClient } from "../api/PublicationClient.ts";
import { AuthenticationController } from "../auth/Authentication.ts";
import {
  createVirtualFilesystem,
  createVirtualTimestamp,
  virtualHomeDirectory,
  type VirtualCorpusCatalog,
} from "../domain/filesystem/VirtualFilesystem.ts";
import { AuthoringService } from "./AuthoringService.ts";
import type { DraftDiscardResult, DraftStore, DraftWriteResult } from "./DraftStore.ts";
import { minimalPublicationSource, type PublicationDraft, type StagedAsset } from "./PublicationDraft.ts";

class MemoryDraftStore implements DraftStore {
  readonly drafts = new Map<string, PublicationDraft>();
  readonly assets = new Map<string, StagedAsset>();
  cleanupCount = 0;
  read(path: string): Promise<PublicationDraft | undefined> { return Promise.resolve(this.drafts.get(path)); }
  readAssets(path: string): Promise<ReadonlyArray<StagedAsset>> {
    const draft = this.drafts.get(path);
    return Promise.resolve(draft?.stagedAssets.map((metadata) => {
      const asset = this.assets.get(metadata.destinationPath);
      if (asset === undefined) throw new Error("Missing staged asset.");
      return asset;
    }) ?? []);
  }
  write(draft: PublicationDraft, expectedRevision: number): Promise<DraftWriteResult> {
    const current = this.drafts.get(draft.repositoryPath);
    if ((current?.recordRevision ?? 0) !== expectedRevision && current !== undefined) return Promise.resolve({ kind: "stale", current });
    const written = { ...draft, recordRevision: expectedRevision + 1 };
    this.drafts.set(draft.repositoryPath, written);
    return Promise.resolve({ kind: "written", draft: written });
  }
  stage(draft: PublicationDraft, expectedRevision: number, assets: ReadonlyArray<StagedAsset>): Promise<DraftWriteResult> {
    const current = this.drafts.get(draft.repositoryPath);
    if (current !== undefined && current.recordRevision !== expectedRevision) return Promise.resolve({ kind: "stale", current });
    const written = { ...draft, recordRevision: expectedRevision + 1 };
    this.drafts.set(draft.repositoryPath, written);
    for (const asset of assets) {
      this.assets.delete(asset.metadata.destinationPath);
      this.assets.set(asset.metadata.destinationPath, asset);
    }
    return Promise.resolve({ kind: "written", draft: written });
  }
  remove(draft: PublicationDraft, expectedRevision: number, destinationPath: string): Promise<DraftWriteResult> {
    const current = this.drafts.get(draft.repositoryPath);
    if (current !== undefined && current.recordRevision !== expectedRevision) return Promise.resolve({ kind: "stale", current });
    const written = { ...draft, recordRevision: expectedRevision + 1 };
    this.drafts.set(draft.repositoryPath, written);
    this.assets.delete(destinationPath);
    return Promise.resolve({ kind: "written", draft: written });
  }
  discard(path: string, expectedRevision: number): Promise<DraftDiscardResult> {
    const current = this.drafts.get(path);
    if (current !== undefined && current.recordRevision !== expectedRevision) return Promise.resolve({ kind: "stale", current });
    this.drafts.delete(path);
    for (const [destinationPath] of this.assets) {
      if (destinationPath.startsWith(`assets/${path.slice(0, -3)}/`)) this.assets.delete(destinationPath);
    }
    return Promise.resolve({ kind: "discarded" });
  }
  cleanupOrphans(): Promise<void> {
    this.cleanupCount += 1;
    for (const [destinationPath] of this.assets) {
      const retained = [...this.drafts.values()].some((draft) =>
        draft.stagedAssets.some((metadata) => metadata.destinationPath === destinationPath));
      if (!retained) this.assets.delete(destinationPath);
    }
    return Promise.resolve();
  }
}

class NoAssetReadDraftStore extends MemoryDraftStore {
  override readAssets(): Promise<ReadonlyArray<StagedAsset>> {
    throw new Error("Asset-free publication must not read a missing IndexedDB asset row.");
  }
}

function authentication(): AuthenticationController {
  const owner = { kind: "owner", login: "owner" as AuthenticatedLogin } as const;
  const sessions: SessionClient = {
    read: () => Promise.resolve({ kind: "available", session: owner }),
    login: () => Promise.resolve({ kind: "available", session: owner }),
    logout: () => Promise.resolve({ kind: "available", session: { kind: "anonymous" } }),
  };
  const cv: CvClient = {
    unlock: () => Promise.resolve({ kind: "failed", message: "CV access failed." }),
    lock: () => Promise.resolve({ kind: "locked" }),
    read: () => Promise.resolve({ kind: "locked" }),
  };
  return new AuthenticationController(sessions, cv);
}

const catalog: VirtualCorpusCatalog = {
  entries: [
    { kind: "directory", id: "home", path: "~", updatedAt: "2026-07-22T00:00:00.000Z", size: 0 },
    { kind: "directory", id: "notes", path: "~/notes", updatedAt: "2026-07-22T00:00:00.000Z", size: 0 },
    { kind: "directory", id: "runtime", path: "~/notes/runtime", updatedAt: "2026-07-22T00:00:00.000Z", size: 0 },
  ],
};

function corpus(): ContentCorpus {
  return {
    filesystem: createVirtualFilesystem(catalog),
    documents: { read: () => { throw new Error("New and recovered drafts must not read upstream documents."); } },
    projectReadmes: [],
    repositoryBase: {
      kind: "available",
      read: () => Promise.resolve({ kind: "available", value: { defaultBranch: "main", headSha: "a".repeat(40) } }),
    },
  };
}

function existingCorpus(repositoryPath = "notes/runtime/existing.md"): ContentCorpus {
  return {
    ...corpus(),
    filesystem: createVirtualFilesystem({
      entries: [
        ...catalog.entries,
        {
          kind: "file",
          id: "existing-note",
          path: "~/notes/runtime/existing.md",
          updatedAt: "2026-07-22T00:00:00.000Z",
          size: 32,
          documentHandle: "existing-note",
        },
      ],
    }),
    documents: {
      read: () => Promise.resolve({
        kind: "available",
        document: { text: "# Existing\n", source: { path: "~/notes/runtime/existing.md" } },
        classification: {
          kind: "publication",
          publicationKind: "note",
          slug: "existing",
          title: "Existing",
          summary: "Existing summary.",
          updatedAt: createVirtualTimestamp("2026-07-22T00:00:00.000Z"),
          tags: ["typescript"],
          repositorySource: {
            kind: "authoring-base",
            repositoryPath,
            virtualPath: "~/notes/runtime/existing.md",
            defaultBranch: "main",
            headSha: "a".repeat(40),
            blobSha: "b".repeat(40),
          },
        },
      }),
    },
  };
}

test("opens a missing recursive path with a real new-document base and recovers its saved draft", async () => {
  const auth = authentication();
  await auth.refresh(new AbortController().signal);
  const store = new MemoryDraftStore();
  const service = new AuthoringService(corpus(), auth, store);
  const opened = await service.open("notes/runtime/example.md", virtualHomeDirectory(), new AbortController().signal);
  assert.equal(opened.kind, "opened");
  if (opened.kind !== "opened") return;
  assert.deepEqual(opened.draft.base, { kind: "new", defaultBranch: "main", headSha: "a".repeat(40) });
  const saved = await service.save(opened.draft, opened.draft.source + "\nMore.");
  assert.equal(saved.kind, "written");
  const recovered = await service.open("~/notes/runtime/example.md", virtualHomeDirectory(), new AbortController().signal);
  assert.equal(recovered.kind === "opened" ? recovered.draft.recordRevision : -1, 1);
  await auth.logout(new AbortController().signal);
  assert.equal(store.drafts.get(opened.draft.repositoryPath)?.recordRevision, 1);
  assert.equal(
    (await service.open("~/notes/runtime/example.md", virtualHomeDirectory(), new AbortController().signal)).kind,
    "rejected",
  );
});

test("publishes a new asset-free draft before its first save and discards only that exact state", async () => {
  const auth = authentication();
  await auth.refresh(new AbortController().signal);
  const store = new NoAssetReadDraftStore();
  let submittedPath = "";
  const publication: PublicationClient = {
    mutate: (_mutation, draft) => {
      submittedPath = draft.repositoryPath;
      return Promise.resolve({
        kind: "published",
        sha: "b".repeat(40),
        url: `https://github.com/example/content/commit/${"b".repeat(40)}`,
        defaultBranch: "main",
        documentBlobSha: "c".repeat(40),
      });
    },
  };
  const service = new AuthoringService(corpus(), auth, store, publication);
  const opened = await service.open(
    "notes/runtime/direct.md",
    virtualHomeDirectory(),
    new AbortController().signal,
  );
  if (opened.kind !== "opened") assert.fail("The new draft must open.");
  const result = await service.publish(
    "publish",
    opened.draft,
    opened.draft.source,
    "",
    new AbortController().signal,
  );
  assert.equal(result.kind, "published");
  assert.equal(submittedPath, "notes/runtime/direct.md");
  assert.equal(store.drafts.size, 0);
});

test("rejects stale saves and discards without replacing the newer stored revision", async () => {
  const auth = authentication();
  await auth.refresh(new AbortController().signal);
  const store = new MemoryDraftStore();
  const service = new AuthoringService(corpus(), auth, store);
  const opened = await service.open("notes/runtime/example.md", virtualHomeDirectory(), new AbortController().signal);
  if (opened.kind !== "opened") assert.fail("Expected a draft.");
  const newer = { ...opened.draft, recordRevision: 2, source: minimalPublicationSource("newer") };
  store.drafts.set(opened.draft.repositoryPath, newer);
  assert.equal((await service.save(opened.draft, opened.draft.source)).kind, "stale");
  assert.equal((await service.discard(opened.draft)).kind, "stale");
  assert.equal(store.drafts.get(opened.draft.repositoryPath)?.source, newer.source);
});

test("reconstructs an existing publication only when its complete repository and virtual paths bind", async () => {
  const auth = authentication();
  await auth.refresh(new AbortController().signal);
  const opened = await new AuthoringService(existingCorpus(), auth, new MemoryDraftStore()).open(
    "notes/runtime/existing.md",
    virtualHomeDirectory(),
    new AbortController().signal,
  );
  assert.equal(opened.kind, "opened");
  if (opened.kind !== "opened") return;
  assert.equal(opened.draft.source.startsWith('---\ntitle = "Existing"\nsummary = "Existing summary."'), true);
  assert.deepEqual(opened.draft.base, {
    kind: "existing",
    defaultBranch: "main",
    headSha: "a".repeat(40),
    blobSha: "b".repeat(40),
  });
  const unchanged = await new AuthoringService(existingCorpus(), auth, new MemoryDraftStore()).save(
    opened.draft,
    opened.draft.source,
  );
  assert.equal(unchanged.kind === "written" ? unchanged.draft.dirty : true, false);

  const mismatched = await new AuthoringService(
    existingCorpus("notes/other/existing.md"),
    auth,
    new MemoryDraftStore(),
  ).open("notes/runtime/existing.md", virtualHomeDirectory(), new AbortController().signal);
  assert.equal(mismatched.kind, "rejected");
});

function pngFile(name: string, trailingBytes = 0): File {
  return new File([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    new Uint8Array(trailingBytes),
  ], name, { type: "image/png" });
}

test("stages recursive assets with links and atomically replaces, removes, discards, and cleans orphan blobs", async () => {
  const auth = authentication();
  await auth.refresh(new AbortController().signal);
  const store = new MemoryDraftStore();
  const service = new AuthoringService(corpus(), auth, store);
  const opened = await service.open("blog/engineering/interfaces/example.md", virtualHomeDirectory(), new AbortController().signal);
  if (opened.kind !== "opened") assert.fail("Expected a recursive publication draft.");
  assert.equal(store.cleanupCount, 1);
  const staged = await service.stageAssets(opened.draft, opened.draft.source, opened.draft.source.length, [pngFile("image.png")]);
  if (staged.kind !== "written") assert.fail("Expected the asset to be staged.");
  assert.deepEqual(staged.draft.stagedAssets, [{
    destinationPath: "assets/blog/engineering/interfaces/example/image.png",
    mediaType: "image/png",
  }]);
  assert.equal(staged.source.endsWith("![image](/assets/blog/engineering/interfaces/example/image.png)"), true);
  assert.equal((await service.assets(staged.draft)).length, 1);

  const replacement = pngFile("image.png", 1);
  const replaced = await service.replaceAsset(
    staged.draft,
    staged.source,
    staged.source.length,
    staged.draft.stagedAssets[0] ?? assert.fail("Expected staged metadata."),
    replacement,
  );
  if (replaced.kind !== "written") assert.fail("Expected the staged asset to be replaced.");
  assert.equal(replaced.draft.stagedAssets.length, 1);
  assert.equal(replaced.source, staged.source);
  assert.equal((await service.assets(replaced.draft))[0]?.blob, replacement);
  assert.equal((await service.replaceAsset(
    replaced.draft,
    replaced.source,
    replaced.source.length,
    replaced.draft.stagedAssets[0] ?? assert.fail("Expected staged metadata."),
    pngFile("renamed.png"),
  )).kind, "invalid");

  const removed = await service.removeAsset(
    replaced.draft,
    replaced.source,
    replaced.source.length,
    replaced.draft.stagedAssets[0] ?? assert.fail("Expected staged metadata."),
  );
  if (removed.kind !== "written") assert.fail("Expected the staged asset to be removed.");
  assert.equal(removed.draft.stagedAssets.length, 0);
  assert.equal(store.assets.size, 0);

  const restaged = await service.stageAssets(removed.draft, removed.source, removed.source.length, [pngFile("again.png")]);
  if (restaged.kind !== "written") assert.fail("Expected the asset to be restaged.");
  assert.equal((await service.discard(restaged.draft)).kind, "discarded");
  assert.equal(store.assets.size, 0);

  store.assets.set("assets/notes/orphan.png", {
    metadata: { destinationPath: "assets/notes/orphan.png", mediaType: "image/png" },
    blob: pngFile("orphan.png"),
  });
  await store.cleanupOrphans();
  assert.equal(store.assets.size, 0);
});

test("preserves a selected File on stale staging and applies no former media byte, aggregate, or count caps", async () => {
  const auth = authentication();
  await auth.refresh(new AbortController().signal);
  const store = new MemoryDraftStore();
  const service = new AuthoringService(corpus(), auth, store);
  const opened = await service.open("notes/runtime/example.md", virtualHomeDirectory(), new AbortController().signal);
  if (opened.kind !== "opened") assert.fail("Expected a publication draft.");
  const selected = pngFile("selected.png");
  store.drafts.set(opened.draft.repositoryPath, { ...opened.draft, recordRevision: 2 });
  const stale = await service.stageAssets(opened.draft, opened.draft.source, opened.draft.source.length, [selected]);
  assert.equal(stale.kind, "stale");
  assert.equal(selected.name, "selected.png");
  assert.equal(store.assets.size, 0);

  store.drafts.delete(opened.draft.repositoryPath);
  const numerous = Array.from({ length: 101 }, (_, index) => pngFile(`image-${index}.png`));
  const beyondOldAggregateLimit = [
    pngFile("large-a.png", 6 * 1024 * 1024),
    pngFile("large-b.png", 6 * 1024 * 1024),
    ...numerous,
  ];
  const accepted = await service.stageAssets(
    opened.draft,
    opened.draft.source,
    opened.draft.source.length,
    beyondOldAggregateLimit,
  );
  assert.equal(accepted.kind, "written");
  assert.equal(accepted.kind === "written" ? accepted.draft.stagedAssets.length : 0, 103);
});
