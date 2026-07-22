import {
  createWorkspaceVirtualFilesystem,
  normalizeVirtualPath,
  writeVirtualFile,
  type VirtualFilesystem,
  type VirtualFilesystemOverlay,
} from "../../domain/filesystem/VirtualFilesystem.ts";

export const virtualFilesystemStorageKey = "termin.al.virtual-files";
const virtualFilesystemStorageVersion = 1;
const maximumStoredByteCount = 1024 * 1024;
const unavailableDiagnostic =
  "Browser virtual file storage is unavailable; files remain in memory.";

export type VirtualFilesystemStorageBackend = Readonly<{
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}>;

export type VirtualFilesystemStorageResult =
  | Readonly<{
      kind: "available";
      overlay: VirtualFilesystemOverlay;
    }>
  | Readonly<{
      kind: "unavailable";
      overlay: VirtualFilesystemOverlay;
      diagnostic: string;
    }>;

function unavailable(
  overlay: VirtualFilesystemOverlay,
): VirtualFilesystemStorageResult {
  return { kind: "unavailable", overlay, diagnostic: unavailableDiagnostic };
}

function validatedOverlay(
  files: ReadonlyArray<unknown>,
  corpus: VirtualFilesystem,
): VirtualFilesystemOverlay | undefined {
  const filesystem = createWorkspaceVirtualFilesystem(corpus);
  const paths = new Set<string>();

  for (const value of files) {
    if (
      value === null ||
      typeof value !== "object" ||
      !("path" in value) ||
      typeof value.path !== "string" ||
      !("text" in value) ||
      typeof value.text !== "string" ||
      Object.keys(value).some((key) => key !== "path" && key !== "text") ||
      value.text.includes("\u0000") ||
      paths.has(value.path)
    ) {
      return undefined;
    }

    const normalization = normalizeVirtualPath(corpus.root.path, value.path);

    if (
      normalization.kind !== "normalized" ||
      normalization.path !== value.path
    ) {
      return undefined;
    }

    const write = writeVirtualFile(
      filesystem,
      corpus.root.path,
      value.path,
      value.text,
    );

    if (write.kind !== "written") {
      return undefined;
    }

    paths.add(value.path);
  }

  return filesystem.writableFiles.current();
}

export function virtualFilesystemOverlayFromStoredValue(
  value: string | null,
  corpus: VirtualFilesystem,
): VirtualFilesystemStorageResult {
  const empty: VirtualFilesystemOverlay = { files: [] };

  if (value === null) {
    return { kind: "available", overlay: empty };
  }

  if (new TextEncoder().encode(value).byteLength > maximumStoredByteCount) {
    return unavailable(empty);
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    return unavailable(empty);
  }

  if (
    parsed === null ||
    typeof parsed !== "object" ||
    !("version" in parsed) ||
    parsed.version !== virtualFilesystemStorageVersion ||
    !("files" in parsed) ||
    !Array.isArray(parsed.files) ||
    Object.keys(parsed).some((key) => key !== "version" && key !== "files")
  ) {
    return unavailable(empty);
  }

  const overlay = validatedOverlay(parsed.files, corpus);
  return overlay === undefined
    ? unavailable(empty)
    : { kind: "available", overlay };
}

export function readVirtualFilesystemOverlay(
  storage: VirtualFilesystemStorageBackend | undefined,
  corpus: VirtualFilesystem,
): VirtualFilesystemStorageResult {
  if (storage === undefined) {
    return unavailable({ files: [] });
  }

  try {
    return virtualFilesystemOverlayFromStoredValue(
      storage.getItem(virtualFilesystemStorageKey),
      corpus,
    );
  } catch {
    return unavailable({ files: [] });
  }
}

export function writeVirtualFilesystemOverlay(
  storage: VirtualFilesystemStorageBackend | undefined,
  overlay: VirtualFilesystemOverlay,
): VirtualFilesystemStorageResult {
  const value = JSON.stringify({
    version: virtualFilesystemStorageVersion,
    files: overlay.files.map((file) => ({ path: file.path, text: file.text })),
  });

  if (
    storage === undefined ||
    new TextEncoder().encode(value).byteLength > maximumStoredByteCount
  ) {
    return unavailable(overlay);
  }

  try {
    storage.setItem(virtualFilesystemStorageKey, value);
    return { kind: "available", overlay };
  } catch {
    return unavailable(overlay);
  }
}
