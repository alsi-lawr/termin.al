import {
  resolveVirtualDirectory,
  type VirtualFilesystem,
} from "../../domain/filesystem/VirtualFilesystem.ts";
import {
  createCommandHistoryTieBreaker,
  createCommandHistoryTimestamp,
  type CommandHistoryEntry,
} from "../../domain/terminal/Shell.ts";

export const commandHistoryStorageKey = "termin.al.command-history";

const commandHistoryVersion = 1;
const commandHistoryLimit = 100;
const maximumStoredCharacterCount = 128 * 1024;
const unavailableDiagnostic =
  "Browser command history storage is unavailable; history remains in memory.";

export type CommandHistoryStorageBackend = Readonly<{
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}>;

export type CommandHistoryStorageResult =
  | Readonly<{
      kind: "available";
      entries: ReadonlyArray<CommandHistoryEntry>;
    }>
  | Readonly<{
      kind: "unavailable";
      diagnostic: string;
    }>;

type StoredCommandHistoryEntry = Readonly<{
  source: string;
  currentDirectory: string;
  timestamp: number;
  tieBreaker: number;
}>;

function hasExactKeys(
  value: object,
  expectedKeys: ReadonlyArray<string>,
): boolean {
  const keys = Object.keys(value);
  return keys.length === expectedKeys.length &&
    expectedKeys.every((key) => keys.includes(key));
}

function compareText(first: string, second: string): number {
  if (first === second) {
    return 0;
  }

  return first < second ? -1 : 1;
}

function compareEntries(
  first: CommandHistoryEntry,
  second: CommandHistoryEntry,
): number {
  if (first.timestamp !== second.timestamp) {
    return first.timestamp - second.timestamp;
  }

  if (first.tieBreaker !== second.tieBreaker) {
    return first.tieBreaker - second.tieBreaker;
  }

  const sourceOrder = compareText(first.source, second.source);

  if (sourceOrder !== 0) {
    return sourceOrder;
  }

  const directoryOrder = compareText(
    first.currentDirectory,
    second.currentDirectory,
  );

  if (directoryOrder !== 0) {
    return directoryOrder;
  }

  if (first.persistence.kind === second.persistence.kind) {
    return 0;
  }

  return first.persistence.kind === "memory-only" ? 1 : -1;
}

function sameStoredIdentity(
  first: CommandHistoryEntry,
  second: CommandHistoryEntry,
): boolean {
  return first.timestamp === second.timestamp &&
    first.tieBreaker === second.tieBreaker &&
    first.source === second.source &&
    first.currentDirectory === second.currentDirectory;
}

export function mergeCommandHistory(
  ...histories: ReadonlyArray<ReadonlyArray<CommandHistoryEntry>>
): ReadonlyArray<CommandHistoryEntry> {
  const ordered = histories.flat().toSorted(compareEntries);
  const merged: CommandHistoryEntry[] = [];

  for (const entry of ordered) {
    const previous = merged.at(-1);

    if (previous !== undefined && sameStoredIdentity(previous, entry)) {
      if (entry.persistence.kind === "memory-only") {
        merged[merged.length - 1] = entry;
      }
      continue;
    }

    if (previous?.source === entry.source) {
      merged[merged.length - 1] = entry;
      continue;
    }

    merged.push(entry);
  }

  return merged.slice(-commandHistoryLimit);
}

function storedEntryFrom(
  value: unknown,
  filesystem: VirtualFilesystem,
): CommandHistoryEntry | undefined {
  if (
    value === null ||
    typeof value !== "object" ||
    !("source" in value) ||
    !("currentDirectory" in value) ||
    !("timestamp" in value) ||
    !("tieBreaker" in value) ||
    !hasExactKeys(value, [
      "source",
      "currentDirectory",
      "timestamp",
      "tieBreaker",
    ]) ||
    typeof value.source !== "string" ||
    value.source.trim().length === 0 ||
    typeof value.currentDirectory !== "string" ||
    typeof value.timestamp !== "number" ||
    typeof value.tieBreaker !== "number"
  ) {
    return undefined;
  }

  const directory = resolveVirtualDirectory(
    filesystem,
    filesystem.root.path,
    value.currentDirectory,
  );

  if (
    directory.kind !== "found" ||
    directory.directory.path !== value.currentDirectory
  ) {
    return undefined;
  }

  try {
    return {
      source: value.source,
      currentDirectory: directory.directory.path,
      timestamp: createCommandHistoryTimestamp(value.timestamp),
      tieBreaker: createCommandHistoryTieBreaker(value.tieBreaker),
      persistence: { kind: "persistent" },
    };
  } catch {
    return undefined;
  }
}

export function commandHistoryFromStoredValue(
  value: string | null,
  filesystem: VirtualFilesystem,
): CommandHistoryStorageResult {
  if (value === null) {
    return { kind: "available", entries: [] };
  }

  if (value.length > maximumStoredCharacterCount) {
    return { kind: "unavailable", diagnostic: unavailableDiagnostic };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    return { kind: "unavailable", diagnostic: unavailableDiagnostic };
  }

  if (
    parsed === null ||
    typeof parsed !== "object" ||
    !("version" in parsed) ||
    parsed.version !== commandHistoryVersion ||
    !("entries" in parsed) ||
    !hasExactKeys(parsed, ["version", "entries"]) ||
    !Array.isArray(parsed.entries) ||
    parsed.entries.length > commandHistoryLimit
  ) {
    return { kind: "unavailable", diagnostic: unavailableDiagnostic };
  }

  const entries: CommandHistoryEntry[] = [];

  for (const valueEntry of parsed.entries) {
    const entry = storedEntryFrom(valueEntry, filesystem);

    if (entry === undefined) {
      return { kind: "unavailable", diagnostic: unavailableDiagnostic };
    }

    entries.push(entry);
  }

  return { kind: "available", entries: mergeCommandHistory(entries) };
}

export function readCommandHistory(
  storage: CommandHistoryStorageBackend | undefined,
  filesystem: VirtualFilesystem,
): CommandHistoryStorageResult {
  if (storage === undefined) {
    return { kind: "unavailable", diagnostic: unavailableDiagnostic };
  }

  try {
    return commandHistoryFromStoredValue(
      storage.getItem(commandHistoryStorageKey),
      filesystem,
    );
  } catch {
    return { kind: "unavailable", diagnostic: unavailableDiagnostic };
  }
}

function storedEntry(entry: CommandHistoryEntry): StoredCommandHistoryEntry {
  return {
    source: entry.source,
    currentDirectory: entry.currentDirectory,
    timestamp: entry.timestamp,
    tieBreaker: entry.tieBreaker,
  };
}

export function persistCommandHistory(
  storage: CommandHistoryStorageBackend | undefined,
  filesystem: VirtualFilesystem,
  entries: ReadonlyArray<CommandHistoryEntry>,
): CommandHistoryStorageResult {
  const current = readCommandHistory(storage, filesystem);

  if (current.kind === "unavailable" || storage === undefined) {
    return current;
  }

  const persistentEntries = entries.filter(
    (entry) => entry.persistence.kind === "persistent",
  );
  const merged = mergeCommandHistory(current.entries, persistentEntries);
  const record = JSON.stringify({
    version: commandHistoryVersion,
    entries: merged.map(storedEntry),
  });

  if (record.length > maximumStoredCharacterCount) {
    return { kind: "unavailable", diagnostic: unavailableDiagnostic };
  }

  try {
    storage.setItem(commandHistoryStorageKey, record);
    return { kind: "available", entries: merged };
  } catch {
    return { kind: "unavailable", diagnostic: unavailableDiagnostic };
  }
}

export function clearPersistedCommandHistory(
  storage: CommandHistoryStorageBackend | undefined,
): CommandHistoryStorageResult {
  if (storage === undefined) {
    return { kind: "unavailable", diagnostic: unavailableDiagnostic };
  }

  try {
    storage.removeItem(commandHistoryStorageKey);
    storage.setItem(
      commandHistoryStorageKey,
      JSON.stringify({ version: commandHistoryVersion, entries: [] }),
    );
    return { kind: "available", entries: [] };
  } catch {
    return { kind: "unavailable", diagnostic: unavailableDiagnostic };
  }
}
