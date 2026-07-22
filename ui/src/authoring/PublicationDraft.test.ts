import assert from "node:assert/strict";
import test from "node:test";
import {
  minimalPublicationSource,
  publicationDraftFromStoredValue,
  publicationPathFromVirtualPath,
  validatePublicationSource,
} from "./PublicationDraft.ts";

test("accepts arbitrary-depth canonical blog and notes paths without traversal", () => {
  assert.equal(publicationPathFromVirtualPath("~/blog/engineering/interfaces/example.md").kind, "valid");
  assert.equal(publicationPathFromVirtualPath("~/notes/runtime/files/example.md").kind, "valid");
  for (const path of ["~/blogs/example.md", "~/note/example.md", "~/blog/../example.md", "~/blog/Example.md", "~/blog/example.txt"]) {
    assert.equal(publicationPathFromVirtualPath(path).kind, "invalid");
  }
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
  assert.equal(publicationDraftFromStoredValue({ ...stored, virtualPath: "~/notes/deep/example.md" }), undefined);
  assert.equal(publicationDraftFromStoredValue({ ...stored, schemaVersion: 2 }), undefined);
  assert.equal(publicationDraftFromStoredValue({ ...stored, stagedAssets: [{ token: "secret" }] }), undefined);
});
