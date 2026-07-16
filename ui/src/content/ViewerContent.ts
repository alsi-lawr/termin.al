import type {
  VirtualAbsolutePath,
} from "../domain/filesystem/VirtualFilesystem.ts";
import type { MarkdownDocument } from "./MarkdownDocument.ts";

export type DocumentViewerPresentation = "inline" | "raw-pager";

export type ViewerDirectoryEntry = Readonly<{
  name: string;
  kind: "directory" | "file" | "locked-file";
}>;

export type ViewerCollectionLeaf = Readonly<{
  kind: "leaf";
  id: string;
  title: string;
  path: string;
  summary: string;
  tags: ReadonlyArray<string>;
  metadata: string;
  documentTitle: string;
  document: MarkdownDocument;
  repositoryUrl: string | undefined;
}>;

export type ViewerCollectionBranch = Readonly<{
  kind: "branch";
  id: string;
  title: string;
  path: string;
  children: ReadonlyArray<ViewerCollectionNode>;
}>;

export type ViewerCollectionNode =
  | ViewerCollectionBranch
  | ViewerCollectionLeaf;

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
      kind: "collection";
      title: string;
      emptyMessage: string;
      roots: ReadonlyArray<ViewerCollectionNode>;
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

export type CreateCollectionViewerContentOptions = Readonly<{
  title: string;
  emptyMessage: string;
  roots: ReadonlyArray<ViewerCollectionNode>;
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

export function createCollectionViewerContent({
  title,
  emptyMessage,
  roots,
}: CreateCollectionViewerContentOptions): ViewerContent {
  assertViewerTitle(title);
  assertViewerTitle(emptyMessage);
  return {
    kind: "collection",
    title,
    emptyMessage,
    roots: [...roots],
  };
}

export function viewerTitle(content: ViewerContent): string {
  return content.title;
}
