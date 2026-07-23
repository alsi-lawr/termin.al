import type { ContentCorpus } from "../api/ContentClient.ts";
import type {
  ManagedRemovalResult,
  PublicationClient,
  PublicationMutation,
} from "../api/PublicationClient.ts";
import type { AuthenticationController } from "../auth/Authentication.ts";
import {
  normalizeVirtualPath,
  resolveVirtualPath,
  type VirtualDirectoryPath,
} from "../domain/filesystem/VirtualFilesystem.ts";
import type { DraftStore, DraftDiscardResult, DraftWriteResult } from "./DraftStore.ts";
import {
  minimalPublicationSource,
  publicationPathFromVirtualPath,
  publicationSource,
  stagedAssetFromFile,
  stagedAssetMarkdown,
  validatePublicationSource,
  type PublicationDraft,
  type StagedAsset,
  type StagedAssetMetadata,
} from "./PublicationDraft.ts";

export type AuthoringOpenResult =
  | Readonly<{ kind: "opened"; draft: PublicationDraft }>
  | Readonly<{ kind: "rejected"; message: string }>
  | Readonly<{ kind: "cancelled" }>;

export type AuthoringAssetMutationResult =
  | Readonly<{ kind: "written"; draft: PublicationDraft; source: string; cursorOffset: number }>
  | Readonly<{ kind: "stale"; current: PublicationDraft }>
  | Readonly<{ kind: "invalid"; message: string }>;

export type AuthoringPublicationResult =
  | Readonly<{
      kind: "published";
      sha: string;
      url: string;
      draft: PublicationDraft;
      persistedState: "discarded" | "newer-revision-retained";
    }>
  | Readonly<{
      kind: "conflict";
      draft: PublicationDraft;
      localMarkdown: string;
      upstreamMarkdown: string;
    }>
  | Readonly<{ kind: "invalid"; message: string }>
  | Readonly<{ kind: "failed"; message: string }>;

const unavailablePublicationClient: PublicationClient = {
  mutate: () => Promise.resolve({ kind: "failed", message: "Publication failed." }),
  removeManaged: () => Promise.resolve({ kind: "failed", message: "Removal failed." }),
};

export class AuthoringService {
  readonly #corpus: ContentCorpus;
  readonly #authentication: AuthenticationController;
  readonly #store: DraftStore;
  readonly #publication: PublicationClient;

  constructor(
    corpus: ContentCorpus,
    authentication: AuthenticationController,
    store: DraftStore,
    publication: PublicationClient = unavailablePublicationClient,
  ) {
    this.#corpus = corpus;
    this.#authentication = authentication;
    this.#store = store;
    this.#publication = publication;
  }

  async open(input: string, currentDirectory: VirtualDirectoryPath, signal: AbortSignal): Promise<AuthoringOpenResult> {
    const state = this.#authentication.snapshot();
    if (state.kind !== "available" || state.session.kind !== "owner") {
      return { kind: "rejected", message: "edit requires the live owner session." };
    }

    if (input.split("/").some((segment) => segment === "." || segment === "..")) {
      return { kind: "rejected", message: "edit paths must not contain traversal segments." };
    }
    const normalized = normalizeVirtualPath(currentDirectory, input);
    if (normalized.kind === "invalid-path") return { kind: "rejected", message: "edit requires a canonical path." };
    const path = publicationPathFromVirtualPath(normalized.path);
    if (path.kind === "invalid") return { kind: "rejected", message: path.message };

    await this.#store.cleanupOrphans();
    const stored = await this.#store.read(path.value.repositoryPath);
    if (stored !== undefined) return { kind: "opened", draft: stored };
    if (signal.aborted) return { kind: "cancelled" };

    const resolved = resolveVirtualPath(this.#corpus.filesystem, currentDirectory, input);
    if (resolved.kind === "found") {
      if (resolved.node.kind !== "file") return { kind: "rejected", message: "edit requires a Markdown document path." };
      const loaded = await this.#corpus.documents.read(resolved.node.documentHandle, signal);
      if (loaded.kind === "cancelled") return { kind: "cancelled" };
      if (loaded.kind !== "available" || loaded.classification.kind !== "publication") {
        return { kind: "rejected", message: "Published content could not be opened for authoring." };
      }
      const source = loaded.classification.repositorySource;
      if (
        source.kind !== "authoring-base" ||
        source.repositoryPath !== path.value.repositoryPath ||
        source.virtualPath !== path.value.virtualPath
      ) {
        return { kind: "rejected", message: "Published content source paths do not match the requested path." };
      }
      const markdown = publicationSource(loaded.classification, loaded.document.text);
      const parsed = validatePublicationSource(markdown);
      if (parsed.kind === "invalid") return { kind: "rejected", message: parsed.message };
      return {
        kind: "opened",
        draft: {
          schemaVersion: 1,
          recordRevision: 0,
          kind: path.value.kind,
          repositoryPath: path.value.repositoryPath,
          virtualPath: path.value.virtualPath,
          frontMatter: parsed.value,
          source: markdown,
          base: { kind: "existing", defaultBranch: source.defaultBranch, headSha: source.headSha, blobSha: source.blobSha },
          dirty: false,
          unpublished: false,
          stagedAssets: [],
        },
      };
    }

    if (resolved.kind !== "not-found" || this.#corpus.repositoryBase.kind !== "available") {
      return { kind: "rejected", message: "The publication repository base is unavailable." };
    }
    const repositoryBase = await this.#corpus.repositoryBase.read(signal);
    if (repositoryBase.kind === "cancelled") return { kind: "cancelled" };
    if (repositoryBase.kind === "failed") return { kind: "rejected", message: "The publication repository base is unavailable." };
    const markdown = minimalPublicationSource(path.value.slug);
    const parsed = validatePublicationSource(markdown);
    if (parsed.kind === "invalid") throw new Error("The minimal publication source must be valid.");
    return {
      kind: "opened",
      draft: {
        schemaVersion: 1,
        recordRevision: 0,
        kind: path.value.kind,
        repositoryPath: path.value.repositoryPath,
        virtualPath: path.value.virtualPath,
        frontMatter: parsed.value,
        source: markdown,
        base: { kind: "new", defaultBranch: repositoryBase.value.defaultBranch, headSha: repositoryBase.value.headSha },
        dirty: true,
        unpublished: true,
        stagedAssets: [],
      },
    };
  }

  save(draft: PublicationDraft, source: string): Promise<DraftWriteResult | Readonly<{ kind: "invalid"; message: string }>> {
    const parsed = validatePublicationSource(source);
    if (parsed.kind === "invalid") return Promise.resolve(parsed);
    return this.#store.write(
      { ...draft, source, frontMatter: parsed.value, dirty: draft.dirty || source !== draft.source },
      draft.recordRevision,
    );
  }

  discard(draft: PublicationDraft): Promise<DraftDiscardResult> {
    return this.#store.discard(draft.repositoryPath, draft.recordRevision);
  }

  assets(draft: PublicationDraft): Promise<ReadonlyArray<StagedAsset>> {
    return this.#store.readAssets(draft.repositoryPath);
  }

  hasManagedRemovalCapability(): boolean {
    const state = this.#authentication.snapshot();
    return state.kind === "available" && state.session.kind === "owner";
  }

  removeManaged(
    virtualPath: string,
    recursive: boolean,
    confirmation: string,
    signal: AbortSignal,
  ): Promise<ManagedRemovalResult> {
    if (!this.hasManagedRemovalCapability()) {
      return Promise.resolve({ kind: "failed", message: "Removal failed." });
    }

    return this.#publication.removeManaged(
      virtualPath,
      recursive,
      confirmation,
      signal,
    );
  }

  async publish(
    mutation: PublicationMutation,
    draft: PublicationDraft,
    source: string,
    removalConfirmation: string,
    signal: AbortSignal,
  ): Promise<AuthoringPublicationResult> {
    const parsed = validatePublicationSource(source);
    if (parsed.kind === "invalid") return parsed;
    if (mutation === "remove" && removalConfirmation !== draft.repositoryPath) {
      return { kind: "invalid", message: "Removal confirmation must match the exact recursive document path." };
    }

    const assets = draft.stagedAssets.length === 0
      ? []
      : await this.#store.readAssets(draft.repositoryPath);
    const result = await this.#publication.mutate(
      mutation,
      draft,
      source,
      assets,
      removalConfirmation,
      signal,
    );
    if (result.kind === "failed") return result;
    if (result.kind === "conflict") {
      const base = result.blobSha.length === 0
        ? { kind: "new", defaultBranch: result.defaultBranch, headSha: result.headSha } as const
        : {
            kind: "existing",
            defaultBranch: result.defaultBranch,
            headSha: result.headSha,
            blobSha: result.blobSha,
          } as const;
      return {
        kind: "conflict",
        draft: { ...draft, base, dirty: true, unpublished: true },
        localMarkdown: result.localMarkdown,
        upstreamMarkdown: result.upstreamMarkdown,
      };
    }

    const discarded = await this.#store.discard(draft.repositoryPath, draft.recordRevision);
    const nextBase = mutation === "remove"
      ? { kind: "new", defaultBranch: result.defaultBranch, headSha: result.sha } as const
      : {
          kind: "existing",
          defaultBranch: result.defaultBranch,
          headSha: result.sha,
          blobSha: result.documentBlobSha,
        } as const;
    return {
      kind: "published",
      sha: result.sha,
      url: result.url,
      draft: discarded.kind === "stale"
        ? discarded.current
        : {
            ...draft,
            recordRevision: 0,
            source,
            frontMatter: parsed.value,
            base: nextBase,
            dirty: false,
            unpublished: mutation === "remove",
            stagedAssets: [],
          },
      persistedState: discarded.kind === "stale" ? "newer-revision-retained" : "discarded",
    };
  }

  async stageAssets(
    draft: PublicationDraft,
    source: string,
    cursorOffset: number,
    files: ReadonlyArray<File>,
  ): Promise<AuthoringAssetMutationResult> {
    if (files.length === 0) return { kind: "invalid", message: "Select at least one raster asset." };
    const selected: StagedAsset[] = [];
    for (const file of files) {
      const asset = await stagedAssetFromFile(draft.repositoryPath, file);
      if (asset.kind === "invalid") return asset;
      if (selected.some((candidate) => candidate.metadata.destinationPath === asset.value.metadata.destinationPath)) {
        return { kind: "invalid", message: "Selected asset destination paths must be unique." };
      }
      selected.push(asset.value);
    }
    const existingDestinations = new Set(draft.stagedAssets.map((asset) => asset.destinationPath));
    const links = selected
      .filter((asset) => !existingDestinations.has(asset.metadata.destinationPath))
      .map((asset) => stagedAssetMarkdown(asset.metadata));
    const insertion = links.join("\n");
    const boundedOffset = Math.max(0, Math.min(source.length, cursorOffset));
    const stagedSource = source.slice(0, boundedOffset) + insertion + source.slice(boundedOffset);
    const parsed = validatePublicationSource(stagedSource);
    if (parsed.kind === "invalid") return parsed;
    const metadata = [...draft.stagedAssets];
    for (const asset of selected) {
      const index = metadata.findIndex((candidate) => candidate.destinationPath === asset.metadata.destinationPath);
      if (index < 0) metadata.push(asset.metadata);
      else metadata[index] = asset.metadata;
    }
    const result = await this.#store.stage({
      ...draft,
      frontMatter: parsed.value,
      source: stagedSource,
      dirty: true,
      stagedAssets: metadata,
    }, draft.recordRevision, selected);
    return result.kind === "stale"
      ? result
      : { kind: "written", draft: result.draft, source: stagedSource, cursorOffset: boundedOffset + insertion.length };
  }

  async removeAsset(
    draft: PublicationDraft,
    source: string,
    cursorOffset: number,
    metadata: StagedAssetMetadata,
  ): Promise<AuthoringAssetMutationResult> {
    if (!draft.stagedAssets.some((asset) => asset.destinationPath === metadata.destinationPath)) {
      return { kind: "invalid", message: "The staged asset is no longer available." };
    }
    const link = stagedAssetMarkdown(metadata);
    const linkIndex = source.indexOf(link);
    const nextSource = linkIndex < 0
      ? source
      : source.slice(0, linkIndex) + source.slice(linkIndex + link.length);
    const nextCursorOffset = linkIndex < 0 || linkIndex >= cursorOffset
      ? cursorOffset
      : Math.max(linkIndex, cursorOffset - link.length);
    const parsed = validatePublicationSource(nextSource);
    if (parsed.kind === "invalid") return parsed;
    const result = await this.#store.remove({
      ...draft,
      frontMatter: parsed.value,
      source: nextSource,
      dirty: true,
      stagedAssets: draft.stagedAssets.filter((asset) => asset.destinationPath !== metadata.destinationPath),
    }, draft.recordRevision, metadata.destinationPath);
    return result.kind === "stale"
      ? result
      : { kind: "written", draft: result.draft, source: nextSource, cursorOffset: nextCursorOffset };
  }

  async replaceAsset(
    draft: PublicationDraft,
    source: string,
    cursorOffset: number,
    metadata: StagedAssetMetadata,
    file: File,
  ): Promise<AuthoringAssetMutationResult> {
    if (!draft.stagedAssets.some((asset) => asset.destinationPath === metadata.destinationPath)) {
      return { kind: "invalid", message: "The staged asset is no longer available." };
    }
    const replacement = await stagedAssetFromFile(draft.repositoryPath, file);
    if (replacement.kind === "invalid") return replacement;
    if (replacement.value.metadata.destinationPath !== metadata.destinationPath) {
      return { kind: "invalid", message: "Replacement files must retain the staged asset's canonical filename." };
    }
    const parsed = validatePublicationSource(source);
    if (parsed.kind === "invalid") return parsed;
    const result = await this.#store.stage({
      ...draft,
      frontMatter: parsed.value,
      source,
      dirty: true,
      stagedAssets: draft.stagedAssets.map((asset) =>
        asset.destinationPath === metadata.destinationPath ? replacement.value.metadata : asset),
    }, draft.recordRevision, [replacement.value]);
    return result.kind === "stale"
      ? result
      : { kind: "written", draft: result.draft, source, cursorOffset };
  }
}
