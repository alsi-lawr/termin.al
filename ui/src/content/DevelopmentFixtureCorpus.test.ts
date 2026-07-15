import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveVirtualPath,
  virtualHomeDirectory,
} from "../domain/filesystem/VirtualFilesystem.ts";
import { developmentFixtureCorpus } from "./DevelopmentFixtureCorpus.ts";

test("supplies deterministic non-personal fixture documents through file handles", async () => {
  const resolution = resolveVirtualPath(
    developmentFixtureCorpus.filesystem,
    virtualHomeDirectory(),
    "about.md",
  );

  if (resolution.kind !== "found" || resolution.node.kind !== "file") {
    assert.fail("Expected the development about fixture file.");
  }

  const result = await developmentFixtureCorpus.documents.read(
    resolution.node.documentHandle,
    new AbortController().signal,
  );

  if (result.kind !== "available") {
    assert.fail("Expected the development fixture document.");
  }

  assert.equal(result.document.source.path, "~/about.md");
  assert.equal(result.document.text, "# About\n\nDeterministic development fixture content.");
});

test("cancels development fixture reads without accessing a document", async () => {
  const resolution = resolveVirtualPath(
    developmentFixtureCorpus.filesystem,
    virtualHomeDirectory(),
    "about.md",
  );

  if (resolution.kind !== "found" || resolution.node.kind !== "file") {
    assert.fail("Expected the development about fixture file.");
  }

  const controller = new AbortController();
  controller.abort();
  const result = await developmentFixtureCorpus.documents.read(
    resolution.node.documentHandle,
    controller.signal,
  );

  assert.deepEqual(result, { kind: "cancelled" });
});
