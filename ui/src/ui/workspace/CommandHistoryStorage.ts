import {
  resolveVirtualDirectory,
  type VirtualFilesystem,
} from "../../domain/filesystem/VirtualFilesystem.ts";
import {
  createCommandHistoryTieBreaker,
  createCommandHistoryTimestamp,
  type CommandHistoryEntry,
  type CommandHistoryTimestamp,
} from "../../domain/terminal/Shell.ts";
export const commandHistoryStorageKey = "termin.al.command-history";
const commandHistoryVersion = 2;
const commandHistoryLimit = 100;
const maximumStoredCharacterCount = 128 * 1024;
const unavailableDiagnostic =
  "Browser command history storage is unavailable; history remains in memory.";
export type CommandHistoryState = Readonly<{
  clearedAt: CommandHistoryTimestamp;
  entries: ReadonlyArray<CommandHistoryEntry>;
}>;
export type CommandHistoryStorageBackend = Readonly<{
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}>;
export type CommandHistoryStorageResult =
  | Readonly<{ kind: "available"; state: CommandHistoryState }>
  | Readonly<{
      kind: "unavailable";
      state: CommandHistoryState;
      diagnostic: string;
    }>;
export type CommandHistoryReconciliation =
  Readonly<{ kind: "accepted"; state: CommandHistoryState }> |
  Readonly<{ kind: "publish"; state: CommandHistoryState }>;
export function emptyCommandHistoryState(): CommandHistoryState {
  return { clearedAt: createCommandHistoryTimestamp(0), entries: [] };
}
const unavailable = (state: CommandHistoryState): CommandHistoryStorageResult =>
  ({ kind: "unavailable", state, diagnostic: unavailableDiagnostic });
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
  const sourceOrder = Number(first.source > second.source) - Number(first.source < second.source);
  return sourceOrder !== 0
    ? sourceOrder
    : Number(first.currentDirectory > second.currentDirectory) - Number(first.currentDirectory < second.currentDirectory);
}
function sameEntry(
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
  const merged: CommandHistoryEntry[] = [];
  for (const entry of histories.flat().toSorted(compareEntries)) {
    const previous = merged.at(-1);
    if (previous !== undefined && sameEntry(previous, entry)) {
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
function entriesAfter(
  entries: ReadonlyArray<CommandHistoryEntry>,
  clearedAt: CommandHistoryTimestamp,
): ReadonlyArray<CommandHistoryEntry> {
  return clearedAt === 0
    ? entries
    : entries.filter((entry) => entry.timestamp > clearedAt);
}
function persistentEntries(
  entries: ReadonlyArray<CommandHistoryEntry>,
): ReadonlyArray<CommandHistoryEntry> {
  return entries.filter((entry) => entry.persistence.kind === "persistent");
}
export function reconcileCommandHistory(
  local: CommandHistoryState,
  received: CommandHistoryState,
): CommandHistoryReconciliation {
  const clearedAt = local.clearedAt > received.clearedAt
    ? local.clearedAt
    : received.clearedAt;
  const entries = mergeCommandHistory(
    entriesAfter(local.entries, clearedAt),
    entriesAfter(received.entries, clearedAt),
  );
  const state = { clearedAt, entries };
  const persistent = persistentEntries(entries);
  const receivedIsCanonical = received.clearedAt === clearedAt &&
    received.entries.length === persistent.length && received.entries.every(
      (entry, index) => persistent[index] !== undefined &&
        sameEntry(entry, persistent[index]),
    );
  return receivedIsCanonical
    ? { kind: "accepted", state }
    : { kind: "publish", state };
}
export function commandHistoryWithSubmission(
  state: CommandHistoryState,
  entries: ReadonlyArray<CommandHistoryEntry>,
): CommandHistoryState {
  const submission = entries.at(-1);
  if (submission === undefined || submission.timestamp > state.clearedAt) {
    return { ...state, entries };
  }
  const advanced = {
    ...submission,
    timestamp: createCommandHistoryTimestamp(state.clearedAt + 1),
  };
  return { ...state, entries: [...entries.slice(0, -1), advanced] };
}
function parsedEntry(
  value: unknown,
  filesystem: VirtualFilesystem,
): CommandHistoryEntry | undefined {
  if (
    value === null || typeof value !== "object" ||
    !("source" in value) || typeof value.source !== "string" ||
    value.source.trim().length === 0 ||
    !("currentDirectory" in value) ||
    typeof value.currentDirectory !== "string" ||
    !("timestamp" in value) || typeof value.timestamp !== "number" ||
    !("tieBreaker" in value) || typeof value.tieBreaker !== "number"
  ) {
    return undefined;
  }
  const directory = resolveVirtualDirectory(
    filesystem,
    filesystem.root.path,
    value.currentDirectory,
  );
  if (directory.kind !== "found" || directory.directory.path !== value.currentDirectory) {
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
  const fallback = emptyCommandHistoryState();
  if (value === null) {
    return { kind: "available", state: fallback };
  }
  if (value.length > maximumStoredCharacterCount) {
    return unavailable(fallback);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return unavailable(fallback);
  }
  if (
    parsed === null || typeof parsed !== "object" ||
    !("version" in parsed) || parsed.version !== commandHistoryVersion ||
    !("clearedAt" in parsed) || typeof parsed.clearedAt !== "number" ||
    parsed.clearedAt >= Number.MAX_SAFE_INTEGER ||
    !("entries" in parsed) || !Array.isArray(parsed.entries) ||
    parsed.entries.length > commandHistoryLimit
  ) {
    return unavailable(fallback);
  }
  const entries = parsed.entries.map((entry) => parsedEntry(entry, filesystem));
  if (entries.some((entry) => entry === undefined)) {
    return unavailable(fallback);
  }
  try {
    const state = {
      clearedAt: createCommandHistoryTimestamp(parsed.clearedAt),
      entries: mergeCommandHistory(
        entries.flatMap((entry) => entry === undefined ? [] : [entry]),
      ),
    };
    return entriesAfter(state.entries, state.clearedAt).length === state.entries.length
      ? { kind: "available", state }
      : unavailable(fallback);
  } catch {
    return unavailable(fallback);
  }
}
export function readCommandHistory(
  storage: CommandHistoryStorageBackend | undefined,
  filesystem: VirtualFilesystem,
): CommandHistoryStorageResult {
  if (storage === undefined) {
    return unavailable(emptyCommandHistoryState());
  }
  try {
    return commandHistoryFromStoredValue(
      storage.getItem(commandHistoryStorageKey),
      filesystem,
    );
  } catch {
    return unavailable(emptyCommandHistoryState());
  }
}
export function writeCommandHistory(
  storage: CommandHistoryStorageBackend | undefined,
  state: CommandHistoryState,
): CommandHistoryStorageResult {
  const value = JSON.stringify({
    version: commandHistoryVersion,
    clearedAt: state.clearedAt,
    entries: persistentEntries(entriesAfter(state.entries, state.clearedAt)).map(
      (entry) => ({
        source: entry.source,
        currentDirectory: entry.currentDirectory,
        timestamp: entry.timestamp,
        tieBreaker: entry.tieBreaker,
      }),
    ),
  });
  if (storage === undefined || value.length > maximumStoredCharacterCount) {
    return unavailable(state);
  }
  try {
    storage.setItem(commandHistoryStorageKey, value);
    return { kind: "available", state };
  } catch {
    return unavailable(state);
  }
}
function applyReconciliation(
  storage: CommandHistoryStorageBackend | undefined,
  reconciliation: CommandHistoryReconciliation,
): CommandHistoryStorageResult {
  return reconciliation.kind === "publish"
    ? writeCommandHistory(storage, reconciliation.state)
    : { kind: "available", state: reconciliation.state };
}
export function publishCommandHistory(
  storage: CommandHistoryStorageBackend | undefined,
  filesystem: VirtualFilesystem,
  local: CommandHistoryState,
): CommandHistoryStorageResult {
  const received = readCommandHistory(storage, filesystem);
  return received.kind === "available"
    ? applyReconciliation(storage, reconcileCommandHistory(local, received.state))
    : unavailable(local);
}
export function receiveCommandHistory(
  storage: CommandHistoryStorageBackend | undefined,
  filesystem: VirtualFilesystem,
  local: CommandHistoryState,
  value: string | null,
): CommandHistoryStorageResult {
  const received = commandHistoryFromStoredValue(value, filesystem);
  return received.kind === "available"
    ? publishCommandHistory(storage, filesystem, reconcileCommandHistory(local, received.state).state)
    : unavailable(local);
}
export function clearCommandHistory(
  storage: CommandHistoryStorageBackend | undefined,
  filesystem: VirtualFilesystem,
  local: CommandHistoryState,
  clearedAt: CommandHistoryTimestamp,
): CommandHistoryStorageResult {
  const received = readCommandHistory(storage, filesystem);
  const latestMarker = received.kind === "available" &&
      received.state.clearedAt > local.clearedAt
    ? received.state.clearedAt
    : local.clearedAt;
  return writeCommandHistory(storage, {
    clearedAt: latestMarker > clearedAt ? latestMarker : clearedAt,
    entries: [],
  });
}
