import {
  publicationDraftFromStoredValue,
  type PublicationDraft,
  type StagedAsset,
  type StagedAssetMetadata,
} from "./PublicationDraft.ts";

export type DraftWriteResult =
  | Readonly<{ kind: "written"; draft: PublicationDraft }>
  | Readonly<{ kind: "stale"; current: PublicationDraft }>;

export type DraftDiscardResult =
  | Readonly<{ kind: "discarded" }>
  | Readonly<{ kind: "stale"; current: PublicationDraft }>;

export interface DraftStore {
  read(repositoryPath: string): Promise<PublicationDraft | undefined>;
  readAssets(repositoryPath: string): Promise<ReadonlyArray<StagedAsset>>;
  write(draft: PublicationDraft, expectedRevision: number): Promise<DraftWriteResult>;
  stage(draft: PublicationDraft, expectedRevision: number, assets: ReadonlyArray<StagedAsset>): Promise<DraftWriteResult>;
  remove(draft: PublicationDraft, expectedRevision: number, destinationPath: string): Promise<DraftWriteResult>;
  discard(repositoryPath: string, expectedRevision: number): Promise<DraftDiscardResult>;
  cleanupOrphans(): Promise<void>;
}

type StoredAssetRecord = Readonly<{
  key: string;
  repositoryPath: string;
  destinationPath: string;
  mediaType: StagedAssetMetadata["mediaType"];
  blob: Blob;
}>;

const draftsStoreName = "drafts";
const assetsStoreName = "assets";
const repositoryPathIndexName = "repositoryPath";

function assetKey(repositoryPath: string, destinationPath: string): string {
  return `${repositoryPath}\0${destinationPath}`;
}

function storedAssetRecord(value: unknown): StoredAssetRecord | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const key = Reflect.get(value, "key");
  const repositoryPath = Reflect.get(value, "repositoryPath");
  const destinationPath = Reflect.get(value, "destinationPath");
  const mediaType = Reflect.get(value, "mediaType");
  const blob = Reflect.get(value, "blob");
  if (
    typeof key !== "string" || typeof repositoryPath !== "string" ||
    typeof destinationPath !== "string" || !(blob instanceof Blob) ||
    (mediaType !== "image/png" && mediaType !== "image/jpeg" && mediaType !== "image/webp" && mediaType !== "image/gif") ||
    key !== assetKey(repositoryPath, destinationPath)
  ) return undefined;
  return { key, repositoryPath, destinationPath, mediaType, blob };
}

function currentDraft(value: unknown): PublicationDraft | undefined {
  return value === undefined ? undefined : publicationDraftFromStoredValue(value);
}

function writtenDraft(draft: PublicationDraft, expectedRevision: number): PublicationDraft {
  return { ...draft, recordRevision: expectedRevision + 1 };
}

function staleDraft(
  stored: unknown,
  expectedRevision: number,
): Readonly<{ kind: "stale"; current: PublicationDraft }> | undefined {
  const current = currentDraft(stored);
  if (stored !== undefined && current === undefined) {
    throw new Error("Stored draft data is invalid.");
  }
  return current !== undefined && current.recordRevision !== expectedRevision
    ? { kind: "stale", current }
    : undefined;
}

export class IndexedDbDraftStore implements DraftStore {
  readonly #database: Promise<IDBDatabase>;

  constructor(indexedDb: IDBFactory, databaseName = "terminal-authoring") {
    this.#database = new Promise((resolve, reject) => {
      const request = indexedDb.open(databaseName, 2);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(draftsStoreName)) {
          request.result.createObjectStore(draftsStoreName, { keyPath: "repositoryPath" });
        }
        if (!request.result.objectStoreNames.contains(assetsStoreName)) {
          const assets = request.result.createObjectStore(assetsStoreName, { keyPath: "key" });
          assets.createIndex(repositoryPathIndexName, "repositoryPath", { unique: false });
        }
      };
      request.onerror = () => reject(request.error ?? new Error("IndexedDB could not be opened."));
      request.onsuccess = () => resolve(request.result);
    });
  }

  async read(repositoryPath: string): Promise<PublicationDraft | undefined> {
    const database = await this.#database;
    return new Promise((resolve, reject) => {
      const request = database.transaction(draftsStoreName).objectStore(draftsStoreName).get(repositoryPath);
      request.onerror = () => reject(request.error ?? new Error("Draft could not be read."));
      request.onsuccess = () => {
        if (request.result === undefined) { resolve(undefined); return; }
        const draft = publicationDraftFromStoredValue(request.result);
        if (draft === undefined || draft.repositoryPath !== repositoryPath) reject(new Error("Stored draft data is invalid."));
        else resolve(draft);
      };
    });
  }

  async readAssets(repositoryPath: string): Promise<ReadonlyArray<StagedAsset>> {
    const database = await this.#database;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([draftsStoreName, assetsStoreName]);
      const draftRequest = transaction.objectStore(draftsStoreName).get(repositoryPath);
      const assetsRequest = transaction.objectStore(assetsStoreName).index(repositoryPathIndexName).getAll(repositoryPath);
      transaction.onerror = () => reject(transaction.error ?? new Error("Staged assets could not be read."));
      transaction.oncomplete = () => {
        const draft = publicationDraftFromStoredValue(draftRequest.result);
        if (draft === undefined || draft.repositoryPath !== repositoryPath || !Array.isArray(assetsRequest.result)) {
          reject(new Error("Stored staged asset data is invalid."));
          return;
        }
        const records = assetsRequest.result.map(storedAssetRecord);
        if (records.some((record) => record === undefined)) {
          reject(new Error("Stored staged asset data is invalid."));
          return;
        }
        const assets: StagedAsset[] = [];
        for (const metadata of draft.stagedAssets) {
          const record = records.find((candidate) => candidate?.destinationPath === metadata.destinationPath);
          if (record === undefined || record.mediaType !== metadata.mediaType) {
            reject(new Error("Stored staged asset data is invalid."));
            return;
          }
          assets.push({ metadata, blob: record.blob });
        }
        if (assets.length !== records.length) {
          reject(new Error("Stored staged asset data is invalid."));
          return;
        }
        resolve(assets);
      };
    });
  }

  async write(draft: PublicationDraft, expectedRevision: number): Promise<DraftWriteResult> {
    const database = await this.#database;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(draftsStoreName, "readwrite");
      const store = transaction.objectStore(draftsStoreName);
      const read = store.get(draft.repositoryPath);
      let result: DraftWriteResult | undefined;
      read.onsuccess = () => {
        try {
          const stale = staleDraft(read.result, expectedRevision);
          if (stale !== undefined) { result = stale; transaction.abort(); return; }
          if (read.result === undefined && expectedRevision !== 0) throw new Error("The expected draft revision does not exist.");
          const written = writtenDraft(draft, expectedRevision);
          store.put(written);
          result = { kind: "written", draft: written };
        } catch (error) {
          transaction.abort();
          reject(error);
        }
      };
      transaction.oncomplete = () => result === undefined ? reject(new Error("Draft write did not complete.")) : resolve(result);
      transaction.onabort = () => {
        if (result?.kind === "stale") resolve(result);
        else if (transaction.error !== null) reject(transaction.error);
      };
      transaction.onerror = () => reject(transaction.error ?? new Error("Draft could not be written."));
    });
  }

  async stage(
    draft: PublicationDraft,
    expectedRevision: number,
    assets: ReadonlyArray<StagedAsset>,
  ): Promise<DraftWriteResult> {
    const database = await this.#database;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([draftsStoreName, assetsStoreName], "readwrite");
      const drafts = transaction.objectStore(draftsStoreName);
      const storedAssets = transaction.objectStore(assetsStoreName);
      const read = drafts.get(draft.repositoryPath);
      let result: DraftWriteResult | undefined;
      read.onsuccess = () => {
        try {
          const stale = staleDraft(read.result, expectedRevision);
          if (stale !== undefined) { result = stale; transaction.abort(); return; }
          if (read.result === undefined && expectedRevision !== 0) throw new Error("The expected draft revision does not exist.");
          const written = writtenDraft(draft, expectedRevision);
          drafts.put(written);
          for (const asset of assets) {
            const key = assetKey(draft.repositoryPath, asset.metadata.destinationPath);
            storedAssets.delete(key);
            storedAssets.put({
              key,
              repositoryPath: draft.repositoryPath,
              destinationPath: asset.metadata.destinationPath,
              mediaType: asset.metadata.mediaType,
              blob: asset.blob,
            } satisfies StoredAssetRecord);
          }
          result = { kind: "written", draft: written };
        } catch (error) {
          transaction.abort();
          reject(error);
        }
      };
      transaction.oncomplete = () => result === undefined ? reject(new Error("Asset staging did not complete.")) : resolve(result);
      transaction.onabort = () => {
        if (result?.kind === "stale") resolve(result);
        else if (transaction.error !== null) reject(transaction.error);
      };
      transaction.onerror = () => reject(transaction.error ?? new Error("Assets could not be staged."));
    });
  }

  async remove(
    draft: PublicationDraft,
    expectedRevision: number,
    destinationPath: string,
  ): Promise<DraftWriteResult> {
    const database = await this.#database;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([draftsStoreName, assetsStoreName], "readwrite");
      const drafts = transaction.objectStore(draftsStoreName);
      const read = drafts.get(draft.repositoryPath);
      let result: DraftWriteResult | undefined;
      read.onsuccess = () => {
        try {
          const stale = staleDraft(read.result, expectedRevision);
          if (stale !== undefined) { result = stale; transaction.abort(); return; }
          if (read.result === undefined && expectedRevision !== 0) throw new Error("The expected draft revision does not exist.");
          const written = writtenDraft(draft, expectedRevision);
          drafts.put(written);
          transaction.objectStore(assetsStoreName).delete(assetKey(draft.repositoryPath, destinationPath));
          result = { kind: "written", draft: written };
        } catch (error) {
          transaction.abort();
          reject(error);
        }
      };
      transaction.oncomplete = () => result === undefined ? reject(new Error("Asset removal did not complete.")) : resolve(result);
      transaction.onabort = () => {
        if (result?.kind === "stale") resolve(result);
        else if (transaction.error !== null) reject(transaction.error);
      };
      transaction.onerror = () => reject(transaction.error ?? new Error("Asset could not be removed."));
    });
  }

  async discard(repositoryPath: string, expectedRevision: number): Promise<DraftDiscardResult> {
    const database = await this.#database;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([draftsStoreName, assetsStoreName], "readwrite");
      const drafts = transaction.objectStore(draftsStoreName);
      const read = drafts.get(repositoryPath);
      let result: DraftDiscardResult | undefined;
      read.onsuccess = () => {
        try {
          const stale = staleDraft(read.result, expectedRevision);
          if (stale !== undefined) { result = stale; transaction.abort(); return; }
          drafts.delete(repositoryPath);
          const cursorRequest = transaction.objectStore(assetsStoreName).index(repositoryPathIndexName).openCursor(repositoryPath);
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (cursor === null) return;
            cursor.delete();
            cursor.continue();
          };
          result = { kind: "discarded" };
        } catch (error) {
          transaction.abort();
          reject(error);
        }
      };
      transaction.oncomplete = () => result === undefined ? reject(new Error("Draft discard did not complete.")) : resolve(result);
      transaction.onabort = () => {
        if (result?.kind === "stale") resolve(result);
        else if (transaction.error !== null) reject(transaction.error);
      };
      transaction.onerror = () => reject(transaction.error ?? new Error("Draft could not be discarded."));
    });
  }

  async cleanupOrphans(): Promise<void> {
    const database = await this.#database;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([draftsStoreName, assetsStoreName], "readwrite");
      const drafts = transaction.objectStore(draftsStoreName);
      const cursorRequest = transaction.objectStore(assetsStoreName).openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (cursor === null) return;
        const record = storedAssetRecord(cursor.value);
        if (record === undefined) {
          cursor.delete();
          cursor.continue();
          return;
        }
        const draftRequest = drafts.get(record.repositoryPath);
        draftRequest.onsuccess = () => {
          const draft = publicationDraftFromStoredValue(draftRequest.result);
          const metadata = draft?.stagedAssets.find((asset) => asset.destinationPath === record.destinationPath);
          if (metadata === undefined || metadata.mediaType !== record.mediaType) cursor.delete();
          cursor.continue();
        };
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Orphaned assets could not be cleaned up."));
    });
  }
}
