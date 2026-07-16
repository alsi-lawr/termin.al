import type {
  ViewerContent,
  ViewerProjectCard,
  ViewerPublicationEntry,
} from "../../content/ViewerContent.ts";
import type { MarkdownDocument } from "../../content/MarkdownDocument.ts";
import {
  selectedCollectionSelectorItem,
  type CollectionSelectorItem,
  type CollectionSelectorState,
} from "./CollectionSelector.ts";

export type CollectionViewerContent = Extract<
  ViewerContent,
  Readonly<{ kind: "project-gallery" | "publication-list" }>
>;

export type CollectionViewerDocument = Readonly<{
  title: string;
  document: MarkdownDocument;
}>;

export type CollectionViewerEntry =
  | Readonly<{
      kind: "project";
      id: string;
      title: string;
      summary: string;
      tags: ReadonlyArray<string>;
      repository: string;
      repositoryUrl: string | undefined;
      document: MarkdownDocument;
    }>
  | Readonly<{
      kind: "publication";
      id: string;
      title: string;
      summary: string;
      tags: ReadonlyArray<string>;
      publishedAt: string;
      document: MarkdownDocument;
      publicationKind: "blog" | "notes";
    }>;

export type SelectedCollectionViewerEntry =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "selected"; entry: CollectionViewerEntry }>;

function projectEntry(project: ViewerProjectCard): CollectionViewerEntry {
  return {
    kind: "project",
    id: project.id,
    title: project.name,
    summary: project.summary,
    tags: project.tags,
    repository: project.repository,
    repositoryUrl: project.repositoryUrl,
    document: project.document,
  };
}

function publicationEntry(
  entry: ViewerPublicationEntry,
  publicationKind: "blog" | "notes",
): CollectionViewerEntry {
  return {
    kind: "publication",
    id: entry.id,
    title: entry.title,
    summary: entry.summary,
    tags: entry.tags,
    publishedAt: entry.publishedAt,
    document: entry.document,
    publicationKind,
  };
}

export function collectionViewerEntries(
  viewer: CollectionViewerContent,
): ReadonlyArray<CollectionViewerEntry> {
  switch (viewer.kind) {
    case "project-gallery":
      return viewer.projects.map(projectEntry);
    case "publication-list":
      return viewer.entries.map((entry) =>
        publicationEntry(entry, viewer.publicationKind)
      );
  }
}

export function collectionSelectorItemsForViewer(
  viewer: CollectionViewerContent,
): ReadonlyArray<CollectionSelectorItem> {
  return collectionViewerEntries(viewer).map((entry) => ({
    id: entry.id,
    searchText: [
      entry.title,
      entry.summary,
      ...entry.tags,
      entry.kind === "project"
        ? entry.repository
        : entry.publishedAt.slice(0, 10),
    ].join("\n"),
  }));
}

export function selectedCollectionViewerEntry(
  entries: ReadonlyArray<CollectionViewerEntry>,
  items: ReadonlyArray<CollectionSelectorItem>,
  state: CollectionSelectorState,
): SelectedCollectionViewerEntry {
  const selected = selectedCollectionSelectorItem(items, state);

  if (selected.kind === "none") {
    return { kind: "none" };
  }

  const entry = entries.find((candidate) => candidate.id === selected.item.id);

  return entry === undefined
    ? { kind: "none" }
    : { kind: "selected", entry };
}

export function selectedCollectionViewerDocument(
  viewer: CollectionViewerContent,
  state: CollectionSelectorState,
): Readonly<
  | { kind: "none" }
  | { kind: "selected"; document: CollectionViewerDocument }
> {
  const entries = collectionViewerEntries(viewer);
  const selected = selectedCollectionViewerEntry(
    entries,
    collectionSelectorItemsForViewer(viewer),
    state,
  );

  if (selected.kind === "none") {
    return { kind: "none" };
  }

  const title = selected.entry.kind === "project"
    ? `${selected.entry.title} README`
    : selected.entry.title;

  return {
    kind: "selected",
    document: { title, document: selected.entry.document },
  };
}
