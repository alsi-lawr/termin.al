import assert from "node:assert/strict";
import test from "node:test";
import {
  minimalPublicationSource,
  publicationDraftFromStoredValue,
  publicationPathFromVirtualPath,
  stagedAssetFromFile,
  stagedAssetMarkdown,
  validatePublicationSource,
} from "./PublicationDraft.ts";

test("accepts arbitrary-depth canonical blog and notes paths without traversal", () => {
  assert.equal(publicationPathFromVirtualPath("~/blog/engineering/interfaces/example.md").kind, "valid");
  assert.equal(publicationPathFromVirtualPath("~/notes/runtime/files/example.md").kind, "valid");
  for (const path of ["~/blogs/example.md", "~/note/example.md", "~/blog/../example.md", "~/blog/Example.md", "~/blog/example.txt"]) {
    assert.equal(publicationPathFromVirtualPath(path).kind, "invalid");
  }
});

test("uses the host virtual-path maximum as the browser canonical-path boundary", () => {
  const directoriesAtLimit = ["a".repeat(128), "b".repeat(128), "c".repeat(128), "d".repeat(113)].join("/");
  const maximum = `~/blog/${directoriesAtLimit}/x.md`;
  const overMaximum = maximum.replace("d".repeat(113), "d".repeat(114));
  assert.equal(maximum.length, 512);
  assert.equal(overMaximum.length, 513);
  assert.equal(publicationPathFromVirtualPath(maximum).kind, "valid");
  assert.equal(publicationPathFromVirtualPath(overMaximum).kind, "invalid");
});

test("validates the complete strict publication front matter contract", () => {
  const source = minimalPublicationSource("cross-tab-drafts");
  const parsed = validatePublicationSource(source);
  assert.deepEqual(parsed.kind === "valid" ? parsed.value : parsed, {
    title: "Cross Tab Drafts",
    summary: "Cross Tab Drafts summary.",
    tags: [],
  });
  for (const invalid of [
    source.replace('summary = "Cross Tab Drafts summary."\n', ""),
    source.replace("tags = []", "tags = []\nunknown = true"),
    source.replace("tags = []", 'tags = ["same", "same"]'),
    source.replace("# Cross Tab Drafts", ""),
  ]) assert.equal(validatePublicationSource(invalid).kind, "invalid");
});

test("rehydrates only versioned path-bound publication drafts and no ambient credentials", () => {
  const source = minimalPublicationSource("example");
  const stored = {
    schemaVersion: 1,
    recordRevision: 4,
    kind: "blog",
    repositoryPath: "blog/deep/example.md",
    virtualPath: "~/blog/deep/example.md",
    frontMatter: { title: "ignored", summary: "ignored", tags: [] },
    source,
    base: { kind: "existing", defaultBranch: "main", headSha: "a".repeat(40), blobSha: "b".repeat(40) },
    dirty: true,
    unpublished: false,
    stagedAssets: [],
  };
  assert.equal(publicationDraftFromStoredValue(stored)?.recordRevision, 4);
  const withAsset = publicationDraftFromStoredValue({
    ...stored,
    stagedAssets: [{
      destinationPath: "assets/blog/deep/example/image.png",
      mediaType: "image/png",
    }],
    accessToken: "must-not-be-hydrated",
  });
  assert.equal(withAsset?.stagedAssets.length, 1);
  assert.equal(JSON.stringify(withAsset).includes("must-not-be-hydrated"), false);
  assert.equal(publicationDraftFromStoredValue({ ...stored, virtualPath: "~/notes/deep/example.md" }), undefined);
  assert.equal(publicationDraftFromStoredValue({ ...stored, schemaVersion: 2 }), undefined);
  assert.equal(publicationDraftFromStoredValue({ ...stored, stagedAssets: [{ token: "secret" }] }), undefined);
});

test("derives recursive asset destinations and image links from canonical raster files", async () => {
  const file = new File([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  ], "interface-diagram.png", { type: "image/png" });
  const result = await stagedAssetFromFile("blog/engineering/interfaces/example.md", file);
  assert.equal(result.kind, "valid");
  if (result.kind !== "valid") return;
  assert.deepEqual(result.value.metadata, {
    destinationPath: "assets/blog/engineering/interfaces/example/interface-diagram.png",
    mediaType: "image/png",
  });
  assert.equal(
    stagedAssetMarkdown(result.value.metadata),
    "![interface diagram](/assets/blog/engineering/interfaces/example/interface-diagram.png)",
  );
});

test("advises against traversal, mismatched types, and mismatched raster signatures", async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  for (const file of [
    new File([png], "../image.png", { type: "image/png" }),
    new File([png], "image.jpg", { type: "image/png" }),
    new File([png], "image.png", { type: "image/jpeg" }),
  ]) {
    assert.equal((await stagedAssetFromFile("notes/runtime/example.md", file)).kind, "invalid");
  }
});
