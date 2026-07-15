import {
  createVirtualDocumentHandle,
  createVirtualFilesystem,
  type VirtualCorpusCatalog,
  type VirtualDocumentReadResult,
  type VirtualDocumentSupplier,
  type VirtualFilesystem,
} from "../domain/filesystem/VirtualFilesystem.ts";

export type DevelopmentFixtureDocument = Readonly<{
  handle: string;
  path: string;
  text: string;
}>;

export type DevelopmentFixtureCorpus = Readonly<{
  filesystem: VirtualFilesystem;
  documents: VirtualDocumentSupplier;
}>;

export type CreateDevelopmentFixtureDocumentSupplierOptions = Readonly<{
  documents: ReadonlyArray<DevelopmentFixtureDocument>;
}>;

function utf8ByteSize(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function createDevelopmentFixtureDocumentSupplier({
  documents,
}: CreateDevelopmentFixtureDocumentSupplierOptions): VirtualDocumentSupplier {
  const documentsByHandle = new Map<
    ReturnType<typeof createVirtualDocumentHandle>,
    DevelopmentFixtureDocument
  >();

  for (const document of documents) {
    const handle = createVirtualDocumentHandle(document.handle);

    if (documentsByHandle.has(handle)) {
      throw new Error(`Development fixture handle '${handle}' is duplicated.`);
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

const aboutText = "# About\n\nDeterministic development fixture content.";
const skillsText = "# Skills\n\nTyped modelling and accessible interaction.";
const toolsText = "# Tools\n\nTerminal, TypeScript, and F# development tools.";
const nowText = "# Now\n\nNo current activity is configured for this fixture.";
const projectText = "# Sample Project\n\nA non-personal project fixture for navigation tests.";
const blogText = "# Sample Post\n\nA deterministic blog fixture about typed outcomes.";
const noteText = "# Sample Note\n\nA deterministic note fixture about virtual paths.";
const changelogText = "# Changelog\n\nNo released changes are configured for this fixture.";

const documents = [
  { handle: "about", path: "~/about.md", text: aboutText },
  { handle: "skills", path: "~/skills.md", text: skillsText },
  { handle: "tools", path: "~/tools.md", text: toolsText },
  { handle: "now", path: "~/now.md", text: nowText },
  { handle: "project", path: "~/projects/sample-project.md", text: projectText },
  { handle: "blog", path: "~/blog/sample-post.md", text: blogText },
  { handle: "note", path: "~/notes/sample-note.md", text: noteText },
  { handle: "changelog", path: "~/changelog.md", text: changelogText },
] satisfies ReadonlyArray<DevelopmentFixtureDocument>;

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

export const developmentFixtureCorpus: DevelopmentFixtureCorpus = {
  filesystem: createVirtualFilesystem(catalog),
  documents: createDevelopmentFixtureDocumentSupplier({ documents }),
};
