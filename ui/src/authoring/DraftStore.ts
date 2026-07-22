import { publicationDraftFromStoredValue, type PublicationDraft } from "./PublicationDraft.ts";

export type DraftWriteResult =
  | Readonly<{ kind: "written"; draft: PublicationDraft }>
  | Readonly<{ kind: "stale"; current: PublicationDraft }>;

export type DraftDiscardResult =
  | Readonly<{ kind: "discarded" }>
  | Readonly<{ kind: "stale"; current: PublicationDraft }>;

export interface DraftStore {
  read(repositoryPath: string): Promise<PublicationDraft | undefined>;
  write(draft: PublicationDraft, expectedRevision: number): Promise<DraftWriteResult>;
  discard(repositoryPath: string, expectedRevision: number): Promise<DraftDiscardResult>;
}

export class IndexedDbDraftStore implements DraftStore {
  readonly #database: Promise<IDBDatabase>;

  constructor(indexedDb: IDBFactory, databaseName = "terminal-authoring") {
    this.#database = new Promise((resolve, reject) => {
      const request = indexedDb.open(databaseName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("drafts", { keyPath: "repositoryPath" });
      request.onerror = () => reject(request.error ?? new Error("IndexedDB could not be opened."));
      request.onsuccess = () => resolve(request.result);
    });
  }

  async read(repositoryPath: string): Promise<PublicationDraft | undefined> {
    const database = await this.#database;
    return new Promise((resolve, reject) => {
      const request = database.transaction("drafts").objectStore("drafts").get(repositoryPath);
      request.onerror = () => reject(request.error ?? new Error("Draft could not be read."));
      request.onsuccess = () => {
        if (request.result === undefined) { resolve(undefined); return; }
        const draft = publicationDraftFromStoredValue(request.result);
        if (draft === undefined || draft.repositoryPath !== repositoryPath) reject(new Error("Stored draft data is invalid."));
        else resolve(draft);
      };
    });
  }

  async write(draft: PublicationDraft, expectedRevision: number): Promise<DraftWriteResult> {
    const database = await this.#database;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction("drafts", "readwrite");
      const store = transaction.objectStore("drafts");
      const read = store.get(draft.repositoryPath);
      let result: DraftWriteResult | undefined;
      read.onerror = () => reject(read.error ?? new Error("Draft could not be read."));
      read.onsuccess = () => {
        const current = read.result === undefined ? undefined : publicationDraftFromStoredValue(read.result);
        if (read.result !== undefined && current === undefined) { reject(new Error("Stored draft data is invalid.")); transaction.abort(); return; }
        const currentRevision = current?.recordRevision ?? 0;
        if (currentRevision !== expectedRevision && current !== undefined) {
          result = { kind: "stale", current };
          transaction.abort();
          return;
        }
        if (currentRevision !== expectedRevision) {
          reject(new Error("The expected draft revision does not exist."));
          transaction.abort();
          return;
        }
        const written = { ...draft, recordRevision: expectedRevision + 1 };
        store.put(written);
        result = { kind: "written", draft: written };
      };
      transaction.oncomplete = () => result === undefined ? reject(new Error("Draft write did not complete.")) : resolve(result);
      transaction.onabort = () => {
        if (result?.kind === "stale") resolve(result);
        else if (transaction.error !== null) reject(transaction.error);
      };
      transaction.onerror = () => reject(transaction.error ?? new Error("Draft could not be written."));
    });
  }

  async discard(repositoryPath: string, expectedRevision: number): Promise<DraftDiscardResult> {
    const database = await this.#database;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction("drafts", "readwrite");
      const store = transaction.objectStore("drafts");
      const read = store.get(repositoryPath);
      let result: DraftDiscardResult | undefined;
      read.onerror = () => reject(read.error ?? new Error("Draft could not be read."));
      read.onsuccess = () => {
        const current = read.result === undefined ? undefined : publicationDraftFromStoredValue(read.result);
        if (read.result !== undefined && current === undefined) { reject(new Error("Stored draft data is invalid.")); transaction.abort(); return; }
        if (current !== undefined && current.recordRevision !== expectedRevision) {
          result = { kind: "stale", current };
          transaction.abort();
          return;
        }
        store.delete(repositoryPath);
        result = { kind: "discarded" };
      };
      transaction.oncomplete = () => result === undefined ? reject(new Error("Draft discard did not complete.")) : resolve(result);
      transaction.onabort = () => {
        if (result?.kind === "stale") resolve(result);
        else if (transaction.error !== null) reject(transaction.error);
      };
      transaction.onerror = () => reject(transaction.error ?? new Error("Draft could not be discarded."));
    });
  }
}
