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
}>;

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
  signal: AbortSignal;
}>;

export type VirtualDocumentReadResult =
  | Readonly<{
      kind: "available";
      document: MarkdownDocument;
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

  return { root, nodesByPath, childrenByDirectoryPath };
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
    const next = filesystem.nodesByPath.get(path);

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

  const entries = filesystem.childrenByDirectoryPath.get(resolution.directory.path);

  if (entries === undefined) {
    throw new Error("Virtual filesystem directories must have child collections.");
  }

  return { kind: "found", directory: resolution.directory, entries };
}

export function traverseVirtualDirectory({
  filesystem,
  directory,
  limit,
  signal,
}: VirtualTraversalOptions): VirtualTraversalResult {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error("Virtual traversal limits must be positive safe integers.");
  }

  const children = filesystem.childrenByDirectoryPath.get(directory.path);

  if (children === undefined) {
    throw new Error("Virtual filesystem directories must have child collections.");
  }

  const pending = [...children]
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

    if (entry.node.kind !== "directory") {
      continue;
    }

    const childEntries = filesystem.childrenByDirectoryPath.get(entry.node.path);

    if (childEntries === undefined) {
      throw new Error("Virtual filesystem directories must have child collections.");
    }

    for (const child of [...childEntries].reverse()) {
      pending.push({ node: child, depth: entry.depth + 1 });
    }
  }

  return { kind: "completed", entries };
}
