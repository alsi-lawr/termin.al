import type { VirtualAbsolutePath } from "../domain/filesystem/VirtualFilesystem.ts";
import type { MarkdownDocument } from "./MarkdownDocument.ts";

export type DocumentViewerPresentation = "inline" | "raw-pager";

export type ViewerDirectoryEntry = Readonly<{
  name: string;
  kind: "directory" | "file" | "locked-file";
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

export function viewerTitle(content: ViewerContent): string {
  return content.title;
}
