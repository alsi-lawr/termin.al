import assert from "node:assert/strict";
import test from "node:test";
import type { ContentCorpus } from "../api/ContentClient.ts";
import type { CvClient } from "../api/CvClient.ts";
import type { AuthenticatedLogin, SessionClient } from "../api/SessionClient.ts";
import { AuthenticationController } from "../auth/Authentication.ts";
import {
  createVirtualFilesystem,
  createVirtualTimestamp,
  virtualHomeDirectory,
  type VirtualCorpusCatalog,
} from "../domain/filesystem/VirtualFilesystem.ts";
import { AuthoringService } from "./AuthoringService.ts";
import type { DraftDiscardResult, DraftStore, DraftWriteResult } from "./DraftStore.ts";
import { minimalPublicationSource, type PublicationDraft } from "./PublicationDraft.ts";

class MemoryDraftStore implements DraftStore {
  readonly drafts = new Map<string, PublicationDraft>();
  read(path: string): Promise<PublicationDraft | undefined> { return Promise.resolve(this.drafts.get(path)); }
  write(draft: PublicationDraft, expectedRevision: number): Promise<DraftWriteResult> {
    const current = this.drafts.get(draft.repositoryPath);
    if ((current?.recordRevision ?? 0) !== expectedRevision && current !== undefined) return Promise.resolve({ kind: "stale", current });
    const written = { ...draft, recordRevision: expectedRevision + 1 };
    this.drafts.set(draft.repositoryPath, written);
    return Promise.resolve({ kind: "written", draft: written });
  }
  discard(path: string, expectedRevision: number): Promise<DraftDiscardResult> {
    const current = this.drafts.get(path);
    if (current !== undefined && current.recordRevision !== expectedRevision) return Promise.resolve({ kind: "stale", current });
    this.drafts.delete(path);
    return Promise.resolve({ kind: "discarded" });
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
