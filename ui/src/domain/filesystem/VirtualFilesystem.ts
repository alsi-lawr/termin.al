import type { MarkdownDocument } from "../../content/MarkdownDocument.ts";

declare const virtualNodeIdBrand: unique symbol;
declare const virtualDocumentHandleBrand: unique symbol;
declare const virtualTimestampBrand: unique symbol;
declare const virtualByteSizeBrand: unique symbol;
declare const virtualAbsolutePathBrand: unique symbol;
declare const virtualDirectoryPathBrand: unique symbol;

export type VirtualNodeId = string & {
  readonly [virtualNodeIdBrand]: "VirtualNodeId";
};

export type VirtualDocumentHandle = string & {
  readonly [virtualDocumentHandleBrand]: "VirtualDocumentHandle";
};

export type VirtualTimestamp = string & {
  readonly [virtualTimestampBrand]: "VirtualTimestamp";
};

export type VirtualByteSize = number & {
  readonly [virtualByteSizeBrand]: "VirtualByteSize";
};

export type VirtualAbsolutePath = string & {
  readonly [virtualAbsolutePathBrand]: "VirtualAbsolutePath";
};

export type VirtualDirectoryPath = VirtualAbsolutePath & {
  readonly [virtualDirectoryPathBrand]: "VirtualDirectoryPath";
};

export type VirtualDirectoryNode = Readonly<{
  kind: "directory";
  id: VirtualNodeId;
  path: VirtualDirectoryPath;
  name: string;
  updatedAt: VirtualTimestamp;
  size: VirtualByteSize;
}>;

export type VirtualFileNode = Readonly<{
  kind: "file";
  id: VirtualNodeId;
  path: VirtualAbsolutePath;
  name: string;
  updatedAt: VirtualTimestamp;
  size: VirtualByteSize;
  documentHandle: VirtualDocumentHandle;
}>;

export type VirtualLockedFileNode = Readonly<{
  kind: "locked-file";
  id: VirtualNodeId;
  path: VirtualAbsolutePath;
  name: string;
  updatedAt: VirtualTimestamp;
  size: VirtualByteSize;
}>;

export type VirtualNode =
  | VirtualDirectoryNode
  | VirtualFileNode
  | VirtualLockedFileNode;

export type VirtualCorpusCatalogEntry =
  | Readonly<{
      kind: "directory";
      id: string;
      path: string;
      updatedAt: string;
      size: number;
    }>
  | Readonly<{
      kind: "file";
      id: string;
      path: string;
      updatedAt: string;
      size: number;
      documentHandle: string;
    }>
  | Readonly<{
      kind: "locked-file";
      id: string;
      path: string;
      updatedAt: string;
      size: number;
    }>;

export type VirtualCorpusCatalog = Readonly<{
  entries: ReadonlyArray<VirtualCorpusCatalogEntry>;
}>;

export type VirtualFilesystem = Readonly<{
  root: VirtualDirectoryNode;
  nodesByPath: ReadonlyMap<VirtualAbsolutePath, VirtualNode>;
  childrenByDirectoryPath: ReadonlyMap<
    VirtualDirectoryPath,
    ReadonlyArray<VirtualNode>
  >;
  writableFiles: VirtualFilesystemWritableFiles;
}>;

export type VirtualWritableFile = Readonly<{
  path: VirtualAbsolutePath;
  text: string;
}>;

export type VirtualFilesystemOverlay = Readonly<{
  files: ReadonlyArray<VirtualWritableFile>;
}>;

export type VirtualFilesystemWritableFiles = Readonly<{
  current: () => VirtualFilesystemOverlay;
  replace: (overlay: VirtualFilesystemOverlay) => void;
}>;

export type VirtualFileWriteResult =
  | Readonly<{
      kind: "written";
      path: VirtualAbsolutePath;
      overlay: VirtualFilesystemOverlay;
    }>
  | Readonly<{
      kind: "is-directory";
      path: VirtualDirectoryPath;
      node: VirtualDirectoryNode;
    }>
  | VirtualPathFailure;

export type VirtualPathNormalization =
  | Readonly<{
      kind: "normalized";
      path: VirtualAbsolutePath;
    }>
  | Readonly<{
      kind: "invalid-path";
      input: string;
    }>;

export type VirtualPathFailure =
  | Readonly<{
      kind: "invalid-path";
      input: string;
    }>
  | Readonly<{
      kind: "not-found";
      path: VirtualAbsolutePath;
    }>
  | Readonly<{
      kind: "not-directory";
      path: VirtualAbsolutePath;
      node: VirtualFileNode;
    }>
  | Readonly<{
      kind: "locked";
      path: VirtualAbsolutePath;
      node: VirtualLockedFileNode;
    }>;

export type VirtualPathResolution =
  | Readonly<{
      kind: "found";
      path: VirtualAbsolutePath;
      node: VirtualNode;
    }>
  | VirtualPathFailure;

export type VirtualDirectoryResolution =
  | Readonly<{
      kind: "found";
      directory: VirtualDirectoryNode;
    }>
  | VirtualPathFailure;

export type VirtualDirectoryListing =
  | Readonly<{
      kind: "found";
      directory: VirtualDirectoryNode;
      entries: ReadonlyArray<VirtualNode>;
    }>
  | VirtualPathFailure;

export type VirtualTraversalEntry = Readonly<{
  node: VirtualNode;
  depth: number;
}>;

export type VirtualTraversalResult =
  | Readonly<{
      kind: "completed";
      entries: ReadonlyArray<VirtualTraversalEntry>;
    }>
  | Readonly<{
      kind: "truncated";
      entries: ReadonlyArray<VirtualTraversalEntry>;
      limit: number;
    }>
  | Readonly<{
      kind: "cancelled";
      entries: ReadonlyArray<VirtualTraversalEntry>;
    }>;

export type VirtualTraversalOptions = Readonly<{
  filesystem: VirtualFilesystem;
  directory: VirtualDirectoryNode;
  limit: number;
  maximumDepth: number;
  signal: AbortSignal;
}>;

export type ExpandVirtualPathGlobOptions = Readonly<{
  filesystem: VirtualFilesystem;
  currentDirectory: VirtualDirectoryPath;
  value: string;
  protectedMetacharacterOffsets: ReadonlyArray<number>;
}>;

export type VirtualDocumentClassification =
  | Readonly<{ kind: "page" }>
  | Readonly<{
      kind: "publication";
      publicationKind: "blog" | "note";
      slug: string;
      title: string;
      summary: string;
      publishedAt: VirtualTimestamp;
      tags: ReadonlyArray<string>;
    }>;

export type VirtualDocumentReadResult =
  | Readonly<{
      kind: "available";
      document: MarkdownDocument;
      classification: VirtualDocumentClassification;
    }>
  | Readonly<{
      kind: "missing";
      handle: VirtualDocumentHandle;
    }>
  | Readonly<{ kind: "cancelled" }>;

export type VirtualDocumentSupplier = Readonly<{
  read: (
    handle: VirtualDocumentHandle,
    signal: AbortSignal,
  ) => Promise<VirtualDocumentReadResult>;
}>;

const stableIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;
const canonicalHomePath = "~" as VirtualAbsolutePath;
const canonicalHomeDirectoryPath = canonicalHomePath as VirtualDirectoryPath;
const writableTimestamp = "1970-01-01T00:00:00.000Z";

function assertStableIdentifier(value: string, label: string): void {
  if (!stableIdentifierPattern.test(value)) {
    throw new Error(`${label} must be stable identifier strings.`);
  }
}

function assertTimestamp(value: string): void {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error("Virtual timestamps must be ISO-8601 UTC timestamps.");
  }
}

function assertByteSize(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Virtual byte sizes must be non-negative safe integers.");
  }
}

function isValidPathSegment(value: string): boolean {
  return (
    value.length > 0 &&
    value !== "." &&
    value !== ".." &&
    !value.includes("/") &&
    !value.includes("\u0000")
  );
}

function createCanonicalPath(
  segments: ReadonlyArray<string>,
): VirtualAbsolutePath {
  return segments.length === 0
    ? canonicalHomePath
    : (`~/${segments.join("/")}` as VirtualAbsolutePath);
}

function pathSegments(path: VirtualAbsolutePath): ReadonlyArray<string> {
  return path === canonicalHomePath ? [] : path.slice(2).split("/");
}

function createCatalogPath(value: string): VirtualAbsolutePath {
  if (value === "~") {
    return canonicalHomePath;
  }

  if (!value.startsWith("~/")) {
    throw new Error("Virtual catalog paths must start at ~.");
  }

  const segments = value.slice(2).split("/");

  if (segments.some((segment) => !isValidPathSegment(segment))) {
    throw new Error("Virtual catalog paths must contain canonical path segments.");
  }

  return createCanonicalPath(segments);
}

function directoryPath(path: VirtualAbsolutePath): VirtualDirectoryPath {
  return path as VirtualDirectoryPath;
}

function parentPath(path: VirtualAbsolutePath): VirtualDirectoryPath | undefined {
  const segments = pathSegments(path);

  if (segments.length === 0) {
    return undefined;
  }

  return directoryPath(createCanonicalPath(segments.slice(0, -1)));
}

function nodeName(path: VirtualAbsolutePath): string {
  const segments = pathSegments(path);
  const name = segments[segments.length - 1];

  return name === undefined ? "~" : name;
}

function compareNodeNames(left: VirtualNode, right: VirtualNode): number {
  if (left.name < right.name) {
    return -1;
  }

  if (left.name > right.name) {
    return 1;
  }

  return 0;
}

function writableFileHandle(path: VirtualAbsolutePath): VirtualDocumentHandle {
  const encoded = new TextEncoder()
    .encode(path)
    .reduce((value, byte) => value + byte.toString(16).padStart(2, "0"), "");

  return createVirtualDocumentHandle(`writable-${encoded}`);
}

function createWritableFileNode(file: VirtualWritableFile): VirtualFileNode {
  return {
    kind: "file",
    id: createVirtualNodeId(writableFileHandle(file.path)),
    path: file.path,
    name: nodeName(file.path),
    updatedAt: createVirtualTimestamp(writableTimestamp),
    size: createVirtualByteSize(new TextEncoder().encode(file.text).byteLength),
    documentHandle: writableFileHandle(file.path),
  };
}

function writableFileAt(
  filesystem: VirtualFilesystem,
  path: VirtualAbsolutePath,
): VirtualWritableFile | undefined {
  return filesystem.writableFiles.current().files.find(
    (file) => file.path === path,
  );
}

function visibleNodeAt(
  filesystem: VirtualFilesystem,
  path: VirtualAbsolutePath,
): VirtualNode | undefined {
  const writable = writableFileAt(filesystem, path);
  return writable === undefined
    ? filesystem.nodesByPath.get(path)
    : createWritableFileNode(writable);
}

function visibleNodes(filesystem: VirtualFilesystem): ReadonlyArray<VirtualNode> {
  const overlay = filesystem.writableFiles.current();
  const shadowedPaths = new Set(overlay.files.map((file) => file.path));
  const corpusNodes = [...filesystem.nodesByPath.values()].filter(
    (node) => !shadowedPaths.has(node.path),
  );

  return [
    ...corpusNodes,
    ...overlay.files.map(createWritableFileNode),
  ];
}

function visibleChildren(
  filesystem: VirtualFilesystem,
  directory: VirtualDirectoryPath,
): ReadonlyArray<VirtualNode> {
  return visibleNodes(filesystem)
    .filter((node) => parentPath(node.path) === directory)
    .sort(compareNodeNames);
}

function createVirtualNode(entry: VirtualCorpusCatalogEntry): VirtualNode {
  const id = createVirtualNodeId(entry.id);
  const path = createCatalogPath(entry.path);
  const updatedAt = createVirtualTimestamp(entry.updatedAt);
  const size = createVirtualByteSize(entry.size);
  const name = nodeName(path);

  switch (entry.kind) {
    case "directory":
      return {
        kind: "directory",
        id,
        path: directoryPath(path),
        name,
        updatedAt,
        size,
      };
    case "file":
      return {
        kind: "file",
        id,
        path,
        name,
        updatedAt,
        size,
        documentHandle: createVirtualDocumentHandle(entry.documentHandle),
      };
    case "locked-file":
      return { kind: "locked-file", id, path, name, updatedAt, size };
  }
}

function failureFromNormalization(
  normalization: Extract<VirtualPathNormalization, { kind: "invalid-path" }>,
): VirtualPathFailure {
  return normalization;
}

function pathForSegments(segments: ReadonlyArray<string>): VirtualAbsolutePath {
  return createCanonicalPath(segments);
}

const protectedGlobMarker = "\uFDD0";

type BracketClass = Readonly<{ endOffset: number; matches: boolean }>;

function globValueAt(pattern: string, offset: number): string | undefined {
  const characterOffset = pattern[offset] === protectedGlobMarker
    ? offset + 1
    : offset;
  const codePoint = pattern.codePointAt(characterOffset);

  return codePoint === undefined ? undefined : String.fromCodePoint(codePoint);
}

function nextGlobOffset(pattern: string, offset: number): number {
  const markerWidth = pattern[offset] === protectedGlobMarker ? 1 : 0;
  const codePoint = pattern.codePointAt(offset + markerWidth);
  const characterWidth = codePoint !== undefined && codePoint > 0xFFFF ? 2 : 1;

  return offset + markerWidth + characterWidth;
}

function valueAt(value: string, offset: number): string | undefined {
  const codePoint = value.codePointAt(offset);
  return codePoint === undefined ? undefined : String.fromCodePoint(codePoint);
}

function nextValueOffset(value: string, offset: number): number {
  const codePoint = value.codePointAt(offset);
  return offset + (codePoint !== undefined && codePoint > 0xFFFF ? 2 : 1);
}

function firstCodePoint(value: string): number {
  return value.codePointAt(0) ?? -1;
}

function protectedVirtualPathGlob(
  value: string,
  protectedMetacharacterOffsets: ReadonlyArray<number>,
): string {
  let pattern = "";

  for (let offset = 0; offset < value.length; offset += 1) {
    pattern += protectedMetacharacterOffsets.includes(offset) ||
      value[offset] === protectedGlobMarker
      ? protectedGlobMarker + value[offset]
      : value[offset];
  }

  return pattern;
}

function bracketClassAt(
  pattern: string,
  openingOffset: number,
  value: string,
): BracketClass | undefined {
  let memberOffset = nextGlobOffset(pattern, openingOffset);
  let matches = false;
  let members = 0;

  while (memberOffset < pattern.length) {
    const member = globValueAt(pattern, memberOffset) ?? "";
    const memberActive = pattern[memberOffset] !== protectedGlobMarker;

    if (member === "/" || memberActive && member === "[") {
      return undefined;
    }

    if (memberActive && member === "]") {
      return members === 0
        ? undefined
        : { endOffset: nextGlobOffset(pattern, memberOffset), matches };
    }

    const markerOffset = nextGlobOffset(pattern, memberOffset);
    const rangeMarker = globValueAt(pattern, markerOffset);
    const rangeOffset = nextGlobOffset(pattern, markerOffset);
    const rangeEnd = rangeMarker === "-" &&
      pattern[markerOffset] !== protectedGlobMarker
      ? globValueAt(pattern, rangeOffset)
      : undefined;

    if (rangeEnd !== undefined && rangeEnd !== "]" && rangeEnd !== "/") {
      const memberCodePoint = firstCodePoint(member);
      const rangeEndCodePoint = firstCodePoint(rangeEnd);
      const valueCodePoint = firstCodePoint(value);

      if (memberCodePoint > rangeEndCodePoint) {
        return undefined;
      }

      matches = matches ||
        memberCodePoint <= valueCodePoint && valueCodePoint <= rangeEndCodePoint;
      memberOffset = nextGlobOffset(pattern, rangeOffset);
    } else {
      if (memberActive && member === "-") {
        return undefined;
      }

      matches = matches || member === value;
      memberOffset = markerOffset;
    }

    members += 1;
  }

  return undefined;
}

function matchingGlobOffset(
  pattern: string,
  patternOffset: number,
  value: string,
): number | undefined {
  const character = globValueAt(pattern, patternOffset);
  const syntaxActive = pattern[patternOffset] !== protectedGlobMarker;
  const nextOffset = nextGlobOffset(pattern, patternOffset);

  if (syntaxActive && character === "?") {
    return nextOffset;
  }

  if (syntaxActive && character === "[") {
    const bracket = bracketClassAt(pattern, patternOffset, value);

    if (bracket !== undefined) {
      return bracket.matches ? bracket.endOffset : undefined;
    }
  }

  return character === value ? nextOffset : undefined;
}

function matchesVirtualPathSegment(pattern: string, value: string): boolean {
  if (value.startsWith(".") && pattern[0] !== ".") {
    return false;
  }

  let patternOffset = 0;
  let valueOffset = 0;
  let starPatternOffset = -1;
  let starValueOffset = -1;

  while (valueOffset < value.length) {
    const character = globValueAt(pattern, patternOffset);
    const syntaxActive = pattern[patternOffset] !== protectedGlobMarker;
    const nextOffset = nextGlobOffset(pattern, patternOffset);

    if (syntaxActive && character === "*") {
      starPatternOffset = nextOffset;
      starValueOffset = valueOffset;
      patternOffset = nextOffset;
      continue;
    }

    const matchedOffset = matchingGlobOffset(
      pattern,
      patternOffset,
      valueAt(value, valueOffset) ?? "",
    );

    if (matchedOffset !== undefined) {
      patternOffset = matchedOffset;
      valueOffset = nextValueOffset(value, valueOffset);
      continue;
    }

    if (starPatternOffset < 0) {
      return false;
    }

    starValueOffset = nextValueOffset(value, starValueOffset);
    valueOffset = starValueOffset;
    patternOffset = starPatternOffset;
  }

  let remaining = globValueAt(pattern, patternOffset);

  while (pattern[patternOffset] !== protectedGlobMarker && remaining === "*") {
    patternOffset = nextGlobOffset(pattern, patternOffset);
    remaining = globValueAt(pattern, patternOffset);
  }

  return remaining === undefined;
}

function matchesProtectedVirtualPathGlob(
  pattern: string,
  value: string,
): boolean {
  const patterns = pattern.split("/");
  const segments = value.split("/");

  return patterns.length === segments.length && patterns.every(
    (pattern, index) => matchesVirtualPathSegment(pattern, segments[index] ?? ""),
  );
}

export function matchesVirtualPathGlob(pattern: string, value: string): boolean {
  return matchesProtectedVirtualPathGlob(
    protectedVirtualPathGlob(pattern, []),
    value,
  );
}

function hasActiveGlobMetacharacter(pattern: string): boolean {
  for (let offset = 0; offset < pattern.length;) {
    const character = globValueAt(pattern, offset);

    if (character === undefined) {
      return false;
    }

    if (pattern[offset] !== protectedGlobMarker && "*?[".includes(character)) {
      return true;
    }

    offset = nextGlobOffset(pattern, offset);
  }

  return false;
}

export function expandVirtualPathGlob({
  filesystem,
  currentDirectory,
  value,
  protectedMetacharacterOffsets,
}: ExpandVirtualPathGlobOptions): ReadonlyArray<VirtualAbsolutePath> {
  const pattern = protectedVirtualPathGlob(value, protectedMetacharacterOffsets);

  if (!hasActiveGlobMetacharacter(pattern)) {
    return [];
  }

  const normalized = normalizeVirtualPath(currentDirectory, pattern);

  if (normalized.kind === "invalid-path") {
    return [];
  }

  return visibleNodes(filesystem)
    .filter((node) => matchesProtectedVirtualPathGlob(normalized.path, node.path))
    .map((node) => node.path)
    .sort();
}

export function createVirtualNodeId(value: string): VirtualNodeId {
  assertStableIdentifier(value, "Virtual node IDs");
  return value as VirtualNodeId;
}

export function createVirtualDocumentHandle(value: string): VirtualDocumentHandle {
  assertStableIdentifier(value, "Virtual document handles");
  return value as VirtualDocumentHandle;
}

export function createVirtualTimestamp(value: string): VirtualTimestamp {
  assertTimestamp(value);
  return value as VirtualTimestamp;
}

export function createVirtualByteSize(value: number): VirtualByteSize {
  assertByteSize(value);
  return value as VirtualByteSize;
}

export function virtualHomeDirectory(): VirtualDirectoryPath {
  return canonicalHomeDirectoryPath;
}

function createVirtualFilesystemWritableFiles(
  initial: VirtualFilesystemOverlay = { files: [] },
): VirtualFilesystemWritableFiles {
  let overlay = initial;

  return {
    current: (): VirtualFilesystemOverlay => overlay,
    replace: (replacement: VirtualFilesystemOverlay): void => {
      overlay = replacement;
    },
  };
}

export function createVirtualFilesystem(
  catalog: VirtualCorpusCatalog,
): VirtualFilesystem {
  const nodesByPath = new Map<VirtualAbsolutePath, VirtualNode>();
  const nodeIds = new Set<VirtualNodeId>();

  for (const entry of catalog.entries) {
    const node = createVirtualNode(entry);

    if (nodesByPath.has(node.path)) {
      throw new Error(`Virtual catalog path '${node.path}' is duplicated.`);
    }

    if (nodeIds.has(node.id)) {
      throw new Error(`Virtual catalog node ID '${node.id}' is duplicated.`);
    }

    nodesByPath.set(node.path, node);
    nodeIds.add(node.id);
  }

  const root = nodesByPath.get(canonicalHomePath);

  if (root === undefined || root.kind !== "directory") {
    throw new Error("Virtual catalog must define ~ as its root directory.");
  }

  const mutableChildren = new Map<VirtualDirectoryPath, VirtualNode[]>();

  for (const node of nodesByPath.values()) {
    if (node.kind === "directory") {
      mutableChildren.set(node.path, []);
    }
  }

  for (const node of nodesByPath.values()) {
    const parent = parentPath(node.path);

    if (parent === undefined) {
      continue;
    }

    const parentNode = nodesByPath.get(parent);

    if (parentNode === undefined) {
      throw new Error(`Virtual catalog parent '${parent}' is missing.`);
    }

    if (parentNode.kind !== "directory") {
      throw new Error(`Virtual catalog parent '${parent}' must be a directory.`);
    }

    const children = mutableChildren.get(parent);

    if (children === undefined) {
      throw new Error(`Virtual catalog directory '${parent}' is missing children.`);
    }

    children.push(node);
  }

  const childrenByDirectoryPath = new Map<
    VirtualDirectoryPath,
    ReadonlyArray<VirtualNode>
  >();

  for (const [path, children] of mutableChildren) {
    childrenByDirectoryPath.set(path, [...children].sort(compareNodeNames));
  }

  return {
    root,
    nodesByPath,
    childrenByDirectoryPath,
    writableFiles: createVirtualFilesystemWritableFiles(),
  };
}

export function createWorkspaceVirtualFilesystem(
  corpus: VirtualFilesystem,
  overlay: VirtualFilesystemOverlay = { files: [] },
): VirtualFilesystem {
  return {
    root: corpus.root,
    nodesByPath: corpus.nodesByPath,
    childrenByDirectoryPath: corpus.childrenByDirectoryPath,
    writableFiles: createVirtualFilesystemWritableFiles(overlay),
  };
}

export function replaceVirtualFilesystemOverlay(
  filesystem: VirtualFilesystem,
  overlay: VirtualFilesystemOverlay,
): void {
  filesystem.writableFiles.replace(overlay);
}

export function writeVirtualFile(
  filesystem: VirtualFilesystem,
  currentDirectory: VirtualDirectoryPath,
  input: string,
  text: string,
): VirtualFileWriteResult {
  const normalization = normalizeVirtualPath(currentDirectory, input);

  if (normalization.kind === "invalid-path") {
    return normalization;
  }

  const target = filesystem.nodesByPath.get(normalization.path);

  if (target?.kind === "directory") {
    return { kind: "is-directory", path: target.path, node: target };
  }

  if (target?.kind === "locked-file") {
    return { kind: "locked", path: target.path, node: target };
  }

  const parent = parentPath(normalization.path);
  const parentNode = parent === undefined
    ? undefined
    : visibleNodeAt(filesystem, parent);

  if (parent === undefined || parentNode === undefined) {
    return { kind: "not-found", path: normalization.path };
  }

  if (parentNode.kind !== "directory") {
    if (parentNode.kind === "locked-file") {
      return { kind: "locked", path: parentNode.path, node: parentNode };
    }

    return { kind: "not-directory", path: parentNode.path, node: parentNode };
  }

  const current = filesystem.writableFiles.current();
  const nextFile = { path: normalization.path, text };
  const overlay = {
    files: [
      ...current.files.filter((file) => file.path !== normalization.path),
      nextFile,
    ].sort((left, right) => left.path.localeCompare(right.path)),
  } satisfies VirtualFilesystemOverlay;
  filesystem.writableFiles.replace(overlay);

  return { kind: "written", path: normalization.path, overlay };
}

export function writableVirtualFileText(
  filesystem: VirtualFilesystem,
  path: VirtualAbsolutePath,
): string | undefined {
  return writableFileAt(filesystem, path)?.text;
}

export function createWorkspaceVirtualDocumentSupplier(
  filesystem: VirtualFilesystem,
  corpus: VirtualDocumentSupplier,
): VirtualDocumentSupplier {
  return {
    read: (handle, signal) => {
      const file = filesystem.writableFiles.current().files.find(
        (candidate) => writableFileHandle(candidate.path) === handle,
      );

      if (file === undefined) {
        return corpus.read(handle, signal);
      }

      return Promise.resolve(signal.aborted
        ? { kind: "cancelled" }
        : {
            kind: "available",
            document: { text: file.text, source: { path: file.path } },
            classification: { kind: "page" },
          });
    },
  };
}

export function normalizeVirtualPath(
  currentDirectory: VirtualDirectoryPath,
  input: string,
): VirtualPathNormalization {
  if (input.length === 0 || input.includes("\u0000")) {
    return { kind: "invalid-path", input };
  }

  let remaining = input;
  let segments: string[];

  if (input === "~" || input.startsWith("~/")) {
    remaining = input === "~" ? "" : input.slice(2);
    segments = [];
  } else if (input.startsWith("/")) {
    remaining = input.slice(1);
    segments = [];
  } else if (input.startsWith("~")) {
    return { kind: "invalid-path", input };
  } else {
    segments = [...pathSegments(currentDirectory)];
  }

  for (const segment of remaining.split("/")) {
    if (segment.length === 0 || segment === ".") {
      continue;
    }

    if (segment === "..") {
      segments.pop();
      continue;
    }

    if (!isValidPathSegment(segment)) {
      return { kind: "invalid-path", input };
    }

    segments.push(segment);
  }

  return { kind: "normalized", path: createCanonicalPath(segments) };
}

export function resolveVirtualPath(
  filesystem: VirtualFilesystem,
  currentDirectory: VirtualDirectoryPath,
  input: string,
): VirtualPathResolution {
  const normalization = normalizeVirtualPath(currentDirectory, input);

  if (normalization.kind === "invalid-path") {
    return failureFromNormalization(normalization);
  }

  const segments = pathSegments(normalization.path);
  let current: VirtualNode = filesystem.root;

  for (let index = 0; index < segments.length; index += 1) {
    const path = pathForSegments(segments.slice(0, index + 1));
    const next = visibleNodeAt(filesystem, path);

    if (next === undefined) {
      return { kind: "not-found", path: normalization.path };
    }

    if (next.kind === "locked-file") {
      return { kind: "locked", path: next.path, node: next };
    }

    if (index < segments.length - 1 && next.kind !== "directory") {
      return { kind: "not-directory", path: next.path, node: next };
    }

    current = next;
  }

  return { kind: "found", path: normalization.path, node: current };
}

export function resolveVirtualDirectory(
  filesystem: VirtualFilesystem,
  currentDirectory: VirtualDirectoryPath,
  input: string,
): VirtualDirectoryResolution {
  const resolution = resolveVirtualPath(filesystem, currentDirectory, input);

  if (resolution.kind !== "found") {
    return resolution;
  }

  if (resolution.node.kind === "directory") {
    return { kind: "found", directory: resolution.node };
  }

  if (resolution.node.kind === "file") {
    return {
      kind: "not-directory",
      path: resolution.path,
      node: resolution.node,
    };
  }

  return {
    kind: "locked",
    path: resolution.node.path,
    node: resolution.node,
  };
}

export function listVirtualDirectory(
  filesystem: VirtualFilesystem,
  currentDirectory: VirtualDirectoryPath,
  input: string,
): VirtualDirectoryListing {
  const resolution = resolveVirtualDirectory(filesystem, currentDirectory, input);

  if (resolution.kind !== "found") {
    return resolution;
  }

  const entries = visibleChildren(filesystem, resolution.directory.path);

  return { kind: "found", directory: resolution.directory, entries };
}

export function traverseVirtualDirectory({
  filesystem,
  directory,
  limit,
  maximumDepth,
  signal,
}: VirtualTraversalOptions): VirtualTraversalResult {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error("Virtual traversal limits must be positive safe integers.");
  }

  if (!Number.isSafeInteger(maximumDepth) || maximumDepth < 0) {
    throw new Error("Virtual traversal depths must be non-negative safe integers.");
  }

  const children = visibleChildren(filesystem, directory.path);

  const pending =
    maximumDepth === 0
      ? []
      : [...children]
          .reverse()
          .map((node) => ({ node, depth: 1 }));
  const entries: VirtualTraversalEntry[] = [];

  while (pending.length > 0) {
    if (signal.aborted) {
      return { kind: "cancelled", entries };
    }

    if (entries.length === limit) {
      return { kind: "truncated", entries, limit };
    }

    const entry = pending.pop();

    if (entry === undefined) {
      break;
    }

    entries.push(entry);

    if (entry.node.kind !== "directory" || entry.depth >= maximumDepth) {
      continue;
    }

    const childEntries = visibleChildren(filesystem, entry.node.path);

    for (const child of [...childEntries].reverse()) {
      pending.push({ node: child, depth: entry.depth + 1 });
    }
  }

  return { kind: "completed", entries };
}
