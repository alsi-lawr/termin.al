import assert from "node:assert/strict";
import test from "node:test";
import { StagedAssetPreviewUrls, type AssetPreviewUrlApi } from "./StagedAssetPreviewUrls.ts";
import type { StagedAsset } from "./PublicationDraft.ts";

function asset(destinationPath: string): StagedAsset {
  return {
    metadata: { destinationPath, mediaType: "image/png" },
    blob: new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" }),
  };
}

test("revokes every staged asset object URL on replacement, removal, and cleanup", () => {
  const revoked: string[] = [];
  let sequence = 0;
  const api: AssetPreviewUrlApi = {
    createObjectURL: () => `blob:preview-${sequence++}`,
    revokeObjectURL: (url) => { revoked.push(url); },
  };
  const previews = new StagedAssetPreviewUrls(api);
  assert.deepEqual(
    previews.replace([asset("assets/notes/a.png"), asset("assets/notes/b.png")]).map((preview) => preview.url),
    ["blob:preview-0", "blob:preview-1"],
  );
  assert.deepEqual(previews.replace([asset("assets/notes/a.png")]).map((preview) => preview.url), ["blob:preview-2"]);
  assert.deepEqual(revoked, ["blob:preview-0", "blob:preview-1"]);
  previews.clear();
  assert.deepEqual(revoked, ["blob:preview-0", "blob:preview-1", "blob:preview-2"]);
});

test("revokes already-created URLs when a later preview result is abandoned by the URL boundary", () => {
  const revoked: string[] = [];
  let calls = 0;
  const previews = new StagedAssetPreviewUrls({
    createObjectURL: () => {
      if (calls++ === 1) throw new Error("Object URL unavailable.");
      return "blob:created";
    },
    revokeObjectURL: (url) => { revoked.push(url); },
  });
  assert.throws(() => previews.replace([asset("assets/notes/a.png"), asset("assets/notes/b.png")]));
  assert.deepEqual(revoked, ["blob:created"]);
});
