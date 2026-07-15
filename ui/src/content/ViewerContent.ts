import type {
  VirtualAbsolutePath,
  VirtualNodeId,
  VirtualTimestamp,
} from "../domain/filesystem/VirtualFilesystem.ts";
import type { MarkdownDocument } from "./MarkdownDocument.ts";

export type DocumentViewerPresentation = "inline" | "raw-pager";

export type ViewerDirectoryEntry = Readonly<{
  name: string;
  kind: "directory" | "file" | "locked-file";
}>;

export type ViewerProjectCard = Readonly<{
  id: VirtualNodeId;
  name: string;
  summary: string;
  repository: string;
  repositoryUrl?: string;
  tags: ReadonlyArray<string>;
  document: MarkdownDocument;
}>;

export type ViewerPublicationEntry = Readonly<{
  id: VirtualNodeId;
  title: string;
  summary: string;
  publishedAt: VirtualTimestamp;
  document: MarkdownDocument;
}>;

export type ViewerContent =
  | Readonly<{
      kind: "placeholder";
      title: string;
    }>
  | Readonly<{
      kind: "document";
      title: string;
      presentation: DocumentViewerPresentation;
      document: MarkdownDocument;
    }>
  | Readonly<{
      kind: "directory";
      title: string;
      path: VirtualAbsolutePath;
      entries: ReadonlyArray<ViewerDirectoryEntry>;
    }>
  | Readonly<{
      kind: "project-gallery";
      title: string;
      projects: ReadonlyArray<ViewerProjectCard>;
    }>
  | Readonly<{
      kind: "publication-list";
      title: string;
      publicationKind: "blog" | "notes";
      entries: ReadonlyArray<ViewerPublicationEntry>;
    }>;

export type ViewerOpenDisposition =
  | Readonly<{ kind: "inline" }>
  | Readonly<{
      kind: "split";
      orientation: "horizontal" | "vertical";
    }>;

export type CreateDocumentViewerContentOptions = Readonly<{
  title: string;
  presentation: DocumentViewerPresentation;
  document: MarkdownDocument;
}>;

export type CreateDirectoryViewerContentOptions = Readonly<{
  title: string;
  path: VirtualAbsolutePath;
  entries: ReadonlyArray<ViewerDirectoryEntry>;
}>;

export type CreateProjectGalleryViewerContentOptions = Readonly<{
  title: string;
  projects: ReadonlyArray<ViewerProjectCard>;
}>;

export type CreatePublicationListViewerContentOptions = Readonly<{
  title: string;
  publicationKind: "blog" | "notes";
  entries: ReadonlyArray<ViewerPublicationEntry>;
}>;

function assertViewerTitle(value: string): void {
  if (value.length === 0 || value.trim() !== value) {
    throw new Error("Viewer titles must be non-empty trimmed strings.");
  }
}

export function createPlaceholderViewerContent(title: string): ViewerContent {
  assertViewerTitle(title);
  return { kind: "placeholder", title };
}

export function createDocumentViewerContent({
  title,
  presentation,
  document,
}: CreateDocumentViewerContentOptions): ViewerContent {
  assertViewerTitle(title);
  return { kind: "document", title, presentation, document };
}

export function createDirectoryViewerContent({
  title,
  path,
  entries,
}: CreateDirectoryViewerContentOptions): ViewerContent {
  assertViewerTitle(title);

  for (const entry of entries) {
    if (entry.name.length === 0 || entry.name.trim() !== entry.name) {
      throw new Error("Viewer directory entry names must be non-empty trimmed strings.");
    }
  }

  return { kind: "directory", title, path, entries: [...entries] };
}

export function createProjectGalleryViewerContent({
  title,
  projects,
}: CreateProjectGalleryViewerContentOptions): ViewerContent {
  assertViewerTitle(title);
  return { kind: "project-gallery", title, projects: [...projects] };
}

export function createPublicationListViewerContent({
  title,
  publicationKind,
  entries,
}: CreatePublicationListViewerContentOptions): ViewerContent {
  assertViewerTitle(title);
  return {
    kind: "publication-list",
    title,
    publicationKind,
    entries: [...entries],
  };
}

export function viewerTitle(content: ViewerContent): string {
  return content.title;
}
