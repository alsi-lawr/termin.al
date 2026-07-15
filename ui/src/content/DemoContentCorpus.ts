import type { ContentCorpus } from "../api/ContentClient.ts";
import {
  createVirtualDocumentHandle,
  createVirtualFilesystem,
  type VirtualCorpusCatalog,
  type VirtualDocumentReadResult,
  type VirtualDocumentSupplier,
} from "../domain/filesystem/VirtualFilesystem.ts";

type DemoContentDocument = Readonly<{
  handle: string;
  path: string;
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

      return Promise.resolve({
        kind: "available",
        document: {
          text: document.text,
          source: { path: document.path },
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
const projectText =
  "# Sample Project\n\nA fictional workspace used to demonstrate local Markdown documents.\n\nRepository: demo/sample-project\nRepository URL: https://example.com/demo/sample-project\nTags: #typescript #fsharp";
const blogText =
  "# Stable Interfaces\n\nA synthetic post about typed outcomes and explicit dependencies.";
const noteText =
  "# Local Paths\n\nA synthetic note about deterministic virtual filesystems.";
const changelogText =
  "# Changelog\n\n## Unreleased\n\n- Keep the offline demo deterministic.\n\n## 0.1.0 — 2026-01-12\n\n- Added synthetic demonstration content.";

const documents = [
  { handle: "about", path: "~/about.md", text: aboutText },
  { handle: "skills", path: "~/skills.md", text: skillsText },
  { handle: "tools", path: "~/tools.md", text: toolsText },
  { handle: "now", path: "~/now.md", text: nowText },
  { handle: "project", path: "~/projects/sample-project.md", text: projectText },
  { handle: "blog", path: "~/blog/sample-post.md", text: blogText },
  { handle: "note", path: "~/notes/sample-note.md", text: noteText },
  { handle: "changelog", path: "~/changelog.md", text: changelogText },
] satisfies ReadonlyArray<DemoContentDocument>;

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
      id: "project-document",
      path: "~/projects/sample-project.md",
      updatedAt: "2026-01-09T00:00:00.000Z",
      size: utf8ByteSize(projectText),
      documentHandle: "project",
    },
    {
      kind: "file",
      id: "blog-document",
      path: "~/blog/sample-post.md",
      updatedAt: "2026-01-10T00:00:00.000Z",
      size: utf8ByteSize(blogText),
      documentHandle: "blog",
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
};
