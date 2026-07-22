import assert from "node:assert/strict";
import test from "node:test";
import { demoContentCorpus } from "../../content/DemoContentCorpus.ts";
import {
  createWorkspaceVirtualFilesystem,
  replaceVirtualFilesystemOverlay,
  virtualHomeDirectory,
  writableVirtualFileText,
} from "../../domain/filesystem/VirtualFilesystem.ts";
import {
  createShellId,
  createShellSessionId,
} from "../../domain/terminal/Shell.ts";
import { createCompletionRequest } from "../../domain/terminal/Completion.ts";
import { createVirtualFilesystemPathCompletionProvider } from "../../application/commands/Completion.ts";
import {
  replaceVirtualFilesystemFromStoredValue,
  virtualFilesystemOverlayFromStoredValue,
  virtualFilesystemStorageKey,
  writeVirtualFilesystemOverlay,
  type VirtualFilesystemStorageBackend,
} from "./VirtualFilesystemStorage.ts";

test("validates, persists, and replaces one whole virtual filesystem record", () => {
  const stored = new Map<string, string>();
  const storage: VirtualFilesystemStorageBackend = {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => {
      stored.set(key, value);
    },
  };
  const hydrated = virtualFilesystemOverlayFromStoredValue(
    JSON.stringify({
      version: 1,
      files: [{ path: "~/persisted.txt", text: "exact" }],
    }),
    demoContentCorpus.filesystem,
  );

  assert.equal(hydrated.kind, "available");
  if (hydrated.kind !== "available") {
    return;
  }

  assert.equal(writeVirtualFilesystemOverlay(storage, hydrated.overlay).kind, "available");
  assert.equal(
    stored.get(virtualFilesystemStorageKey),
    '{"version":1,"files":[{"path":"~/persisted.txt","text":"exact"}]}',
  );

  const filesystem = createWorkspaceVirtualFilesystem(demoContentCorpus.filesystem);
  replaceVirtualFilesystemOverlay(filesystem, hydrated.overlay);
  const path = hydrated.overlay.files[0]?.path;
  if (path === undefined) {
    assert.fail("Expected one hydrated file.");
  }
  assert.equal(writableVirtualFileText(filesystem, path), "exact");

  const replacement = virtualFilesystemOverlayFromStoredValue(
    JSON.stringify({
      version: 1,
      files: [{ path: "~/replacement.txt", text: "new" }],
    }),
    demoContentCorpus.filesystem,
  );
  if (replacement.kind !== "available") {
    assert.fail("Expected a valid storage-event replacement.");
  }
  replaceVirtualFilesystemOverlay(filesystem, replacement.overlay);
  assert.equal(writableVirtualFileText(filesystem, path), undefined);
  const replacementPath = replacement.overlay.files[0]?.path;
  if (replacementPath === undefined) {
    assert.fail("Expected one replacement file.");
  }
  assert.equal(writableVirtualFileText(filesystem, replacementPath), "new");
});

test("notifies an existing completion consumer after stored overlay replacement", async () => {
  const filesystem = createWorkspaceVirtualFilesystem(demoContentCorpus.filesystem);
  const completion = createVirtualFilesystemPathCompletionProvider({
    filesystem,
    currentDirectory: virtualHomeDirectory(),
  });
  const request = createCompletionRequest(
    createShellId("storage-consumer"),
    createShellSessionId("storage-consumer"),
    "cat replacement",
    15,
  );
  const signal = new AbortController().signal;
  assert.deepEqual(await completion.complete(request, signal), []);

  let replacementRevision = 0;
  const replacement = replaceVirtualFilesystemFromStoredValue(
    '{"version":1,"files":[{"path":"~/replacement.txt","text":"new"}]}',
    demoContentCorpus.filesystem,
    filesystem,
    () => {
      replacementRevision += 1;
    },
  );

  assert.equal(replacement.kind, "available");
  assert.equal(replacementRevision, 1);
  assert.deepEqual(await completion.complete(request, signal), [{
    kind: "path",
    value: "replacement.txt",
    label: "File",
  }]);
});

test("keeps memory functional when storage data or the backend is unavailable", () => {
  for (const value of [
    "not json",
    '{"version":2,"files":[]}',
    '{"version":1,"files":[{"path":"~/cv.md","text":"locked"}]}',
    '{"version":1,"files":[{"path":"~/missing/file","text":"orphan"}]}',
    '{"version":1,"files":[{"path":"~/bad","text":"nul\\u0000"}]}',
  ]) {
    const result = virtualFilesystemOverlayFromStoredValue(
      value,
      demoContentCorpus.filesystem,
    );
    assert.equal(result.kind, "unavailable");
    assert.deepEqual(result.overlay.files, []);
  }

  const overlay = virtualFilesystemOverlayFromStoredValue(
    '{"version":1,"files":[{"path":"~/memory.txt","text":"retained"}]}',
    demoContentCorpus.filesystem,
  ).overlay;
  const failed = writeVirtualFilesystemOverlay({
    getItem: () => null,
    setItem: () => {
      throw new Error("quota");
    },
  }, overlay);

  assert.equal(failed.kind, "unavailable");
  assert.deepEqual(failed.overlay, overlay);
  if (failed.kind === "unavailable") {
    assert.equal(failed.diagnostic.includes("retained"), false);
  }
});
