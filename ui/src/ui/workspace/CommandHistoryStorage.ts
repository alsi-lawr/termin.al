import {
  resolveVirtualDirectory,
  type VirtualFilesystem,
} from "../../domain/filesystem/VirtualFilesystem.ts";
import type { CommandHistoryEntry } from "../../domain/terminal/Shell.ts";

export const commandHistoryStorageKey = "termin.al.command-history";
const commandHistoryVersion = 1;
const commandHistoryLimit = 100;
const maximumStoredCharacterCount = 128 * 1024;
const unavailableDiagnostic =
  "Browser command history storage is unavailable; history remains in memory.";

export type CommandHistoryStorageBackend = Readonly<{
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}>;

export type CommandHistoryStorageResult =
  | Readonly<{
      kind: "available";
      entries: ReadonlyArray<CommandHistoryEntry>;
    }>
  | Readonly<{
      kind: "unavailable";
      entries: ReadonlyArray<CommandHistoryEntry>;
      diagnostic: string;
    }>;

function unavailable(
  entries: ReadonlyArray<CommandHistoryEntry>,
): CommandHistoryStorageResult {
  return { kind: "unavailable", entries, diagnostic: unavailableDiagnostic };
}

function parsedEntry(
  value: unknown,
  filesystem: VirtualFilesystem,
): CommandHistoryEntry | undefined {
  if (
    value === null ||
    typeof value !== "object" ||
    !("source" in value) ||
    typeof value.source !== "string" ||
    value.source.trim().length === 0 ||
    !("currentDirectory" in value) ||
    typeof value.currentDirectory !== "string"
  ) {
    return undefined;
  }

  const directory = resolveVirtualDirectory(
    filesystem,
    filesystem.root.path,
    value.currentDirectory,
  );

  return directory.kind === "found" &&
      directory.directory.path === value.currentDirectory
    ? {
        source: value.source,
        currentDirectory: directory.directory.path,
        persistence: { kind: "persistent" },
      }
    : undefined;
}

export function commandHistoryFromStoredValue(
  value: string | null,
  filesystem: VirtualFilesystem,
): CommandHistoryStorageResult {
  if (value === null) {
    return { kind: "available", entries: [] };
  }

  if (value.length > maximumStoredCharacterCount) {
    return unavailable([]);
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    return unavailable([]);
  }

  if (
    parsed === null ||
    typeof parsed !== "object" ||
    !("version" in parsed) ||
    parsed.version !== commandHistoryVersion ||
    !("entries" in parsed) ||
    !Array.isArray(parsed.entries) ||
    parsed.entries.length > commandHistoryLimit
  ) {
    return unavailable([]);
  }

  const entries = parsed.entries.map((entry) => parsedEntry(entry, filesystem));

  return entries.some((entry) => entry === undefined)
    ? unavailable([])
    : {
        kind: "available",
        entries: entries.flatMap((entry) => entry === undefined ? [] : [entry]),
      };
}

export function readCommandHistory(
  storage: CommandHistoryStorageBackend | undefined,
  filesystem: VirtualFilesystem,
): CommandHistoryStorageResult {
  if (storage === undefined) {
    return unavailable([]);
  }

  try {
    return commandHistoryFromStoredValue(
      storage.getItem(commandHistoryStorageKey),
      filesystem,
    );
  } catch {
    return unavailable([]);
  }
}

export function writeCommandHistory(
  storage: CommandHistoryStorageBackend | undefined,
  entries: ReadonlyArray<CommandHistoryEntry>,
): CommandHistoryStorageResult {
  const value = JSON.stringify({
    version: commandHistoryVersion,
    entries: entries
      .filter((entry) => entry.persistence.kind === "persistent")
      .slice(-commandHistoryLimit)
      .map((entry) => ({
        source: entry.source,
        currentDirectory: entry.currentDirectory,
      })),
  });

  if (storage === undefined || value.length > maximumStoredCharacterCount) {
    return unavailable(entries);
  }

  try {
    storage.setItem(commandHistoryStorageKey, value);
    return { kind: "available", entries };
  } catch {
    return unavailable(entries);
  }
}
