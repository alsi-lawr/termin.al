import type {
  ContentCorpus,
  ProjectReadme,
} from "../api/ContentClient.ts";
import {
  createVirtualDocumentHandle,
  createVirtualFilesystem,
  createVirtualTimestamp,
  type VirtualCorpusCatalog,
  type VirtualDocumentReadResult,
  type VirtualDocumentSupplier,
} from "../domain/filesystem/VirtualFilesystem.ts";

type DemoContentDocument =
  | Readonly<{
      kind: "page";
      handle: string;
      path: string;
      text: string;
    }>
  | Readonly<{
      kind: "publication";
      publicationKind: "blog" | "note";
      handle: string;
      slug: string;
      path: string;
      title: string;
      summary: string;
      publishedAt: string;
      tags: ReadonlyArray<string>;
      text: string;
    }>;

function utf8ByteSize(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function createDemoDocumentSupplier(
  documents: ReadonlyArray<DemoContentDocument>,
): VirtualDocumentSupplier {
  const documentsByHandle = new Map<
    ReturnType<typeof createVirtualDocumentHandle>,
    DemoContentDocument
  >();

  for (const document of documents) {
    const handle = createVirtualDocumentHandle(document.handle);

    if (documentsByHandle.has(handle)) {
      throw new Error(`Demo document handle '${handle}' is duplicated.`);
    }

    documentsByHandle.set(handle, document);
  }

  return {
    read: (handle, signal): Promise<VirtualDocumentReadResult> => {
      if (signal.aborted) {
        return Promise.resolve({ kind: "cancelled" });
      }

      const document = documentsByHandle.get(handle);

      if (document === undefined) {
        return Promise.resolve({ kind: "missing", handle });
      }

      if (document.kind === "page") {
        return Promise.resolve({
          kind: "available",
          document: {
            text: document.text,
            source: { path: document.path },
          },
          classification: { kind: "page" },
        });
      }

      return Promise.resolve({
        kind: "available",
        document: {
          text: document.text,
          source: { path: document.path },
        },
        classification: {
          kind: "publication",
          publicationKind: document.publicationKind,
          slug: document.slug,
          title: document.title,
          summary: document.summary,
          publishedAt: createVirtualTimestamp(document.publishedAt),
          tags: document.tags,
        },
      });
    },
  };
}

const aboutText =
  "# About\n\nThis is a deterministic offline demonstration of a terminal workspace. It contains synthetic content only.";
const skillsText =
  "# Skills\n\nTyped domain modelling and accessible keyboard interaction.";
const toolsText =
  "# Tools\n\n- TypeScript\n- React\n- F#\n- Markdown";
const nowText = "# Now\n\nThis demonstration has no live activity.";
const projectReadmeText =
  "# Sample Project README\n\nThis independently supplied README documents the deterministic demo project.";
const blogText =
  "# Body Heading Is Not List Metadata\n\nThis body paragraph must not become the publication summary.";
const newerBlogText =
  "# Another Body Heading\n\nA second body paragraph that remains separate from list metadata.";
const noteText =
  "# Note Body Heading\n\nThis note body does not supply list metadata.";
const changelogText =
  "# Changelog\n\n## Unreleased\n\n- Keep the offline demo deterministic.\n\n## 0.1.0 — 2026-01-12\n\n- Added synthetic demonstration content.";

const documents = [
  { kind: "page", handle: "about", path: "~/about.md", text: aboutText },
  { kind: "page", handle: "skills", path: "~/skills.md", text: skillsText },
  { kind: "page", handle: "tools", path: "~/tools.md", text: toolsText },
  { kind: "page", handle: "now", path: "~/now.md", text: nowText },
  {
    kind: "publication",
    publicationKind: "blog",
    handle: "blog",
    slug: "sample-post",
    path: "~/blog/sample-post.md",
    title: "Stable Interfaces",
    summary: "Validated metadata about typed outcomes and explicit dependencies.",
    publishedAt: "2026-01-05T00:00:00.000Z",
    tags: ["typescript", "interfaces"],
    text: blogText,
  },
  {
    kind: "publication",
    publicationKind: "blog",
    handle: "newer-blog",
    slug: "deterministic-demo",
    path: "~/blog/deterministic-demo.md",
    title: "Deterministic Demos",
    summary: "Fixed publication metadata keeps the offline demonstration repeatable.",
    publishedAt: "2026-01-12T00:00:00.000Z",
    tags: ["demo", "offline"],
    text: newerBlogText,
  },
  {
    kind: "publication",
    publicationKind: "note",
    handle: "note",
    slug: "sample-note",
    path: "~/notes/sample-note.md",
    title: "Local Paths",
    summary: "Validated metadata about deterministic virtual filesystems.",
    publishedAt: "2026-01-07T00:00:00.000Z",
    tags: ["filesystem", "determinism"],
    text: noteText,
  },
  {
    kind: "page",
    handle: "changelog",
    path: "~/changelog.md",
    text: changelogText,
  },
] satisfies ReadonlyArray<DemoContentDocument>;

const projectReadmes = [
  {
    id: "sample-project",
    name: "Sample Project",
    summary: "A deterministic project card with external repository metadata.",
    repository: "demo/sample-project",
    repositoryUrl: "https://example.com/demo/sample-project",
    tags: ["typescript", "fsharp"],
    document: {
      text: projectReadmeText,
      source: { path: "https://example.com/demo/sample-project" },
    },
  },
] satisfies ReadonlyArray<ProjectReadme>;

const catalog: VirtualCorpusCatalog = {
  entries: [
    {
      kind: "directory",
      id: "home",
      path: "~",
      updatedAt: "2026-01-01T00:00:00.000Z",
      size: 0,
    },
    {
      kind: "directory",
      id: "projects",
      path: "~/projects",
      updatedAt: "2026-01-02T00:00:00.000Z",
      size: 0,
    },
    {
      kind: "directory",
      id: "blog",
      path: "~/blog",
      updatedAt: "2026-01-03T00:00:00.000Z",
      size: 0,
    },
    {
      kind: "directory",
      id: "notes",
      path: "~/notes",
      updatedAt: "2026-01-04T00:00:00.000Z",
      size: 0,
    },
    {
      kind: "file",
      id: "about-document",
      path: "~/about.md",
      updatedAt: "2026-01-05T00:00:00.000Z",
      size: utf8ByteSize(aboutText),
      documentHandle: "about",
    },
    {
      kind: "file",
      id: "skills-document",
      path: "~/skills.md",
      updatedAt: "2026-01-06T00:00:00.000Z",
      size: utf8ByteSize(skillsText),
      documentHandle: "skills",
    },
    {
      kind: "file",
      id: "tools-document",
      path: "~/tools.md",
      updatedAt: "2026-01-07T00:00:00.000Z",
      size: utf8ByteSize(toolsText),
      documentHandle: "tools",
    },
    {
      kind: "file",
      id: "now-document",
      path: "~/now.md",
      updatedAt: "2026-01-08T00:00:00.000Z",
      size: utf8ByteSize(nowText),
      documentHandle: "now",
    },
    {
      kind: "file",
      id: "blog-document",
      path: "~/blog/sample-post.md",
      updatedAt: "2026-01-15T00:00:00.000Z",
      size: utf8ByteSize(blogText),
      documentHandle: "blog",
    },
    {
      kind: "file",
      id: "newer-blog-document",
      path: "~/blog/deterministic-demo.md",
      updatedAt: "2026-01-09T00:00:00.000Z",
      size: utf8ByteSize(newerBlogText),
      documentHandle: "newer-blog",
    },
    {
      kind: "file",
      id: "note-document",
      path: "~/notes/sample-note.md",
      updatedAt: "2026-01-11T00:00:00.000Z",
      size: utf8ByteSize(noteText),
      documentHandle: "note",
    },
    {
      kind: "file",
      id: "changelog-document",
      path: "~/changelog.md",
      updatedAt: "2026-01-12T00:00:00.000Z",
      size: utf8ByteSize(changelogText),
      documentHandle: "changelog",
    },
    {
      kind: "locked-file",
      id: "cv-document",
      path: "~/cv.md",
      updatedAt: "2026-01-13T00:00:00.000Z",
      size: 0,
    },
  ],
};

export const demoContentCorpus: ContentCorpus = {
  filesystem: createVirtualFilesystem(catalog),
  documents: createDemoDocumentSupplier(documents),
  projectReadmes,
};
