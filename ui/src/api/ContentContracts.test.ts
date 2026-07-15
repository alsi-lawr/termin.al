import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ContentByteSize,
  validateContentCatalog,
  validateContentChangelog,
  validateContentDocument,
  validateContentNow,
  validateContentProblem,
  validateContentProjects,
} from "./ContentContracts.ts";

function fixture(name: string): unknown {
  const path = new URL(`../../../contracts/fixtures/${name}`, import.meta.url);

  return JSON.parse(readFileSync(path, "utf8"));
}

test("accepts every shared serialized content contract fixture", () => {
  const catalog = validateContentCatalog(fixture("catalog.json"));
  const document = validateContentDocument(fixture("document-about.json"));
  const projects = validateContentProjects(fixture("projects.json"));
  const now = validateContentNow(fixture("now.json"));
  const changelog = validateContentChangelog(fixture("changelog.json"));
  const problem = validateContentProblem(fixture("problem-invalid-request.json"));

  for (const result of [catalog, document, projects, now, changelog, problem]) {
    assert.equal(result.kind, "valid", result.kind === "invalid" ? result.message : "");
  }

  if (
    catalog.kind !== "valid" ||
    document.kind !== "valid" ||
    projects.kind !== "valid"
  ) {
    assert.fail("Expected catalog, document, and projects fixture validation.");
  }

  assert.equal(catalog.value.entries[2]?.kind, "file");
  assert.equal(document.value.id.value, "about");
  assert.deepEqual(
    projects.value.projects.map((project) => project.repository.value),
    ["example-owner/sample-project", "example-owner/second-project"],
  );
});

test("rejects malformed paths, fractional sizes, duplicate projects, and unstable problem shapes", () => {
  const traversalCatalog: unknown = {
    entries: [
      {
        kind: "directory",
        id: "home",
        path: "~",
        updatedAt: "2026-07-15T00:00:00.000Z",
        size: 0,
      },
      {
        kind: "file",
        id: "about-document",
        path: "~/../about.md",
        updatedAt: "2026-07-15T00:00:02.000Z",
        size: 42,
        documentHandle: "about",
      },
    ],
    source: {
      repository: "example-owner/content",
      path: "content/catalog.json",
      revision: "main",
      url: "https://github.com/example-owner/content/blob/main/content/catalog.json",
    },
    cache: {
      state: "fresh",
      fetchedAt: "2026-07-15T00:00:00.000Z",
      freshUntil: "2026-07-15T00:05:00.000Z",
      staleUntil: "2026-07-15T01:05:00.000Z",
    },
  };
  const duplicateProjects: unknown = {
    projects: [
      {
        id: "sample-project",
        slug: "sample-project",
        name: "Sample Project",
        summary: "A validated project fixture.",
        url: "https://github.com/example-owner/sample-project",
        repository: "example-owner/sample-project",
        updatedAt: "2026-07-15T00:00:03.000Z",
        tags: ["fsharp"],
      },
      {
        id: "second-project",
        slug: "sample-project",
        name: "Second Project",
        summary: "A second validated project fixture.",
        url: "https://github.com/example-owner/second-project",
        repository: "example-owner/second-project",
        updatedAt: "2026-07-15T00:00:03.000Z",
        tags: ["typescript"],
      },
    ],
    source: {
      repository: "example-owner/content",
      path: "content/projects.json",
      revision: "main",
      url: "https://github.com/example-owner/content/blob/main/content/projects.json",
    },
    cache: {
      state: "fresh",
      fetchedAt: "2026-07-15T00:00:00.000Z",
      freshUntil: "2026-07-15T00:05:00.000Z",
      staleUntil: "2026-07-15T01:05:00.000Z",
    },
  };
  const malformedProblem: unknown = {
    type: "https://termin.al/problems/invalid-request",
    title: "The request is invalid.",
    status: 500,
    code: "invalid-request",
    detail: "The requested document identifier is invalid.",
  };

  assert.equal(validateContentCatalog(traversalCatalog).kind, "invalid");
  assert.equal(validateContentProjects(duplicateProjects).kind, "invalid");
  assert.equal(ContentByteSize.tryCreate(0.5, "catalog.size").kind, "invalid");
  assert.equal(validateContentCatalog(fixture("catalog-fractional-size.json")).kind, "invalid");
  assert.equal(
    validateContentProjects(fixture("projects-duplicate-repository-exact.json")).kind,
    "invalid",
  );
  assert.equal(
    validateContentProjects(fixture("projects-duplicate-repository-case.json")).kind,
    "invalid",
  );
  assert.equal(validateContentProblem(malformedProblem).kind, "invalid");
});
