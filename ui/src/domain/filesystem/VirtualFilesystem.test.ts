import assert from "node:assert/strict";
import test from "node:test";
import {
  createVirtualFilesystem,
  createWorkspaceVirtualFilesystem,
  expandVirtualPathGlob,
  listVirtualDirectory,
  removeVirtualFiles,
  resolveVirtualDirectory,
  resolveVirtualPath,
  traverseVirtualDirectory,
  virtualHomeDirectory,
  writableVirtualFileText,
  writeVirtualFile,
} from "./VirtualFilesystem.ts";

const filesystem = createVirtualFilesystem({
  entries: [
    {
      kind: "directory",
      id: "home",
      path: "~",
      updatedAt: "2026-01-01T00:00:00.000Z",
      size: 0,
    },
    {
      kind: "directory",
      id: "projects",
      path: "~/projects",
      updatedAt: "2026-01-02T00:00:00.000Z",
      size: 0,
    },
    {
      kind: "file",
      id: "about",
      path: "~/about.md",
      updatedAt: "2026-01-03T00:00:00.000Z",
      size: 12,
      documentHandle: "about-document",
    },
    {
      kind: "file",
      id: "project",
      path: "~/projects/example.md",
      updatedAt: "2026-01-04T00:00:00.000Z",
      size: 18,
      documentHandle: "project-document",
    },
    {
      kind: "locked-file",
      id: "cv",
      path: "~/cv.md",
      updatedAt: "2026-01-05T00:00:00.000Z",
      size: 0,
    },
  ],
});

function projectsDirectory() {
  const resolution = resolveVirtualDirectory(
    filesystem,
    virtualHomeDirectory(),
    "projects",
  );

  if (resolution.kind !== "found") {
    assert.fail("Expected the projects fixture directory.");
  }

  return resolution.directory;
}

test("normalizes home, absolute, relative, and parent virtual paths", () => {
  const projects = projectsDirectory();
  const relative = resolveVirtualPath(filesystem, projects.path, "../about.md");
  const absolute = resolveVirtualPath(
    filesystem,
    projects.path,
    "/projects/./example.md",
  );
  const home = resolveVirtualDirectory(filesystem, projects.path, "~");
  const clamped = resolveVirtualDirectory(filesystem, virtualHomeDirectory(), "../../");

  assert.deepEqual(relative.kind, "found");
  assert.deepEqual(absolute.kind, "found");
  assert.equal(home.kind, "found");
  assert.equal(clamped.kind, "found");

  if (relative.kind === "found") {
    assert.equal(relative.path, "~/about.md");
  }

  if (absolute.kind === "found") {
    assert.equal(absolute.path, "~/projects/example.md");
  }

  if (clamped.kind === "found") {
    assert.equal(clamped.directory.path, "~");
  }
});

test("reports explicit virtual path failures", () => {
  const missing = resolveVirtualPath(
    filesystem,
    virtualHomeDirectory(),
    "missing.md",
  );
  const notDirectory = resolveVirtualDirectory(
    filesystem,
    virtualHomeDirectory(),
    "about.md",
  );
  const locked = resolveVirtualPath(
    filesystem,
    virtualHomeDirectory(),
    "cv.md",
  );

  assert.equal(missing.kind, "not-found");
  assert.equal(notDirectory.kind, "not-directory");
  assert.equal(locked.kind, "locked");
});

test("lists and traverses immutable virtual directory data with bounds", () => {
  const listing = listVirtualDirectory(
    filesystem,
    virtualHomeDirectory(),
    ".",
  );
  const complete = traverseVirtualDirectory({
    filesystem,
    directory: filesystem.root,
    limit: 10,
    maximumDepth: 10,
    signal: new AbortController().signal,
  });
  const truncated = traverseVirtualDirectory({
    filesystem,
    directory: filesystem.root,
    limit: 2,
    maximumDepth: 10,
    signal: new AbortController().signal,
  });
  const controller = new AbortController();
  controller.abort();
  const cancelled = traverseVirtualDirectory({
    filesystem,
    directory: filesystem.root,
    limit: 10,
    maximumDepth: 10,
    signal: controller.signal,
  });

  if (listing.kind !== "found") {
    assert.fail("Expected the home directory listing.");
  }

  assert.deepEqual(
    listing.entries.map((entry) => entry.name),
    ["about.md", "cv.md", "projects"],
  );
  assert.equal(complete.kind, "completed");
  assert.equal(truncated.kind, "truncated");
  assert.equal(cancelled.kind, "cancelled");

  if (complete.kind === "completed") {
    assert.deepEqual(
      complete.entries.map((entry) => entry.node.path),
      ["~/about.md", "~/cv.md", "~/projects", "~/projects/example.md"],
    );
  }

  if (truncated.kind === "truncated") {
    assert.equal(truncated.entries.length, 2);
    assert.equal(truncated.limit, 2);
  }

  assert.equal(filesystem.root.path, "~");
});

test("writes one visible overlay without shadowing locked nodes or directories", () => {
  const workspace = createWorkspaceVirtualFilesystem(filesystem);
  const created = writeVirtualFile(
    workspace,
    virtualHomeDirectory(),
    "projects/new.txt",
    "new",
  );
  const shadowed = writeVirtualFile(
    workspace,
    virtualHomeDirectory(),
    "about.md",
    "shadow",
  );

  assert.equal(created.kind, "written");
  assert.equal(shadowed.kind, "written");
  if (shadowed.kind !== "written") {
    assert.fail("Expected the corpus file to be shadowed.");
  }

  assert.equal(writableVirtualFileText(workspace, shadowed.path), "shadow");
  assert.equal(
    writeVirtualFile(workspace, virtualHomeDirectory(), "cv.md", "x").kind,
    "locked",
  );
  assert.equal(
    writeVirtualFile(workspace, virtualHomeDirectory(), "projects", "x").kind,
    "is-directory",
  );
  assert.equal(
    writeVirtualFile(workspace, virtualHomeDirectory(), "missing/x", "x").kind,
    "not-found",
  );

  const listing = listVirtualDirectory(workspace, virtualHomeDirectory(), "projects");
  if (listing.kind !== "found") {
    assert.fail("Expected the overlay directory listing.");
  }

  assert.deepEqual(
    listing.entries.map((entry) => entry.name),
    ["example.md", "new.txt"],
  );
  assert.deepEqual(
    expandVirtualPathGlob({
      filesystem: workspace,
      currentDirectory: virtualHomeDirectory(),
      value: "projects/*.txt",
      protectedMetacharacterOffsets: [],
    }),
    ["~/projects/new.txt"],
  );
});

test("removes exact and recursive overlay files without deleting corpus nodes", () => {
  const workspace = createWorkspaceVirtualFilesystem(filesystem);
  const shadow = writeVirtualFile(
    workspace,
    virtualHomeDirectory(),
    "about.md",
    "shadow",
  );
  const nested = writeVirtualFile(
    workspace,
    virtualHomeDirectory(),
    "projects/new.txt",
    "new",
  );

  if (shadow.kind !== "written" || nested.kind !== "written") {
    assert.fail("Expected removable overlay fixtures.");
  }

  const removedShadow = removeVirtualFiles(workspace, shadow.path, false);
  const removedTree = removeVirtualFiles(
    workspace,
    projectsDirectory().path,
    true,
  );

  assert.equal(removedShadow.kind, "removed");
  assert.equal(removedTree.kind, "removed");
  assert.equal(writableVirtualFileText(workspace, shadow.path), undefined);
  assert.equal(resolveVirtualPath(workspace, virtualHomeDirectory(), "about.md").kind, "found");
  assert.equal(writableVirtualFileText(workspace, nested.path), undefined);
  assert.equal(
    removeVirtualFiles(workspace, nested.path, false).kind,
    "not-found",
  );
});
