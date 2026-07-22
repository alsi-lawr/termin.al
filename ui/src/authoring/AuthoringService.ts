import type { ContentCorpus } from "../api/ContentClient.ts";
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
  validatePublicationSource,
  type PublicationDraft,
} from "./PublicationDraft.ts";

export type AuthoringOpenResult =
  | Readonly<{ kind: "opened"; draft: PublicationDraft }>
  | Readonly<{ kind: "rejected"; message: string }>
  | Readonly<{ kind: "cancelled" }>;

export class AuthoringService {
  readonly #corpus: ContentCorpus;
  readonly #authentication: AuthenticationController;
  readonly #store: DraftStore;

  constructor(
    corpus: ContentCorpus,
    authentication: AuthenticationController,
    store: DraftStore,
  ) {
    this.#corpus = corpus;
    this.#authentication = authentication;
    this.#store = store;
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
}
