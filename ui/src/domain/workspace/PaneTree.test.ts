import assert from "node:assert/strict";
import test from "node:test";
import { createVimBuffer, insertVimText, vimBufferText } from "../vim/VimBuffer.ts";
import { minimalPublicationSource, validatePublicationSource, type PublicationDraft } from "../../authoring/PublicationDraft.ts";
import {
  applyPaneOperation,
  createEditorPaneContent,
  createAuthoringEditorPaneContent,
  createPaneWorkspace,
  createPlaceholderViewerPaneContent,
  createShellPaneContent,
  paneGeometries,
  paneLeaves,
  type PaneOperationResult,
  type PaneWorkspace,
} from "./PaneTree.ts";

function applied(result: PaneOperationResult): PaneWorkspace {
  if (result.kind !== "applied") {
    assert.fail("Expected the pane operation to apply.");
  }

  return result.workspace;
}

function split(
  workspace: PaneWorkspace,
  orientation: "horizontal" | "vertical",
  content = createShellPaneContent(),
): PaneWorkspace {
  return applied(
    applyPaneOperation(workspace, {
      kind: "split",
      paneId: workspace.activePaneId,
      orientation,
      content,
    }),
  );
}

test("models stable pane IDs, binary split geometry, and directional focus", () => {
  const horizontal = split(
    createPaneWorkspace({ initialContent: createShellPaneContent() }),
    "horizontal",
  );
  const workspace = split(
    horizontal,
    "vertical",
    createPlaceholderViewerPaneContent("Viewer"),
  );
  const geometries = paneGeometries(workspace);
  const left = applied(
    applyPaneOperation(workspace, {
      kind: "focus-direction",
      direction: "left",
    }),
  );
  const up = applied(
    applyPaneOperation(workspace, {
      kind: "focus-direction",
      direction: "up",
    }),
  );
  const selected = applied(
    applyPaneOperation(workspace, { kind: "focus-number", number: 1 }),
  );

  assert.deepEqual(
    paneLeaves(workspace.tree).map((pane) => pane.id),
    ["pane-1", "pane-2", "pane-3"],
  );
  assert.deepEqual(geometries, [
    { paneId: "pane-1", x: 0, y: 0, width: 0.5, height: 1 },
    { paneId: "pane-2", x: 0.5, y: 0, width: 0.5, height: 0.5 },
    { paneId: "pane-3", x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
  ]);
  assert.equal(left.activePaneId, "pane-1");
  assert.equal(up.activePaneId, "pane-2");
  assert.equal(selected.activePaneId, "pane-1");
});

test("splits an explicit pane target after focus changes", () => {
  const first = createPaneWorkspace({
    initialContent: createShellPaneContent(),
  });
  const second = split(first, "horizontal");
  const focused = applied(
    applyPaneOperation(second, {
      kind: "focus-pane",
      paneId: first.activePaneId,
    }),
  );
  const splitTarget = applied(
    applyPaneOperation(focused, {
      kind: "split",
      paneId: second.activePaneId,
      orientation: "vertical",
      content: createPlaceholderViewerPaneContent("Viewer"),
    }),
  );

  assert.deepEqual(
    paneLeaves(splitTarget.tree).map((pane) => pane.id),
    ["pane-1", "pane-2", "pane-3"],
  );
  assert.deepEqual(paneGeometries(splitTarget), [
    { paneId: "pane-1", x: 0, y: 0, width: 0.5, height: 1 },
    { paneId: "pane-2", x: 0.5, y: 0, width: 0.5, height: 0.5 },
    { paneId: "pane-3", x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
  ]);
  assert.equal(splitTarget.activePaneId, "pane-3");
});

test("resizes by five percent, protects the minimum ratio, and protects the last pane", () => {
  const initial = createPaneWorkspace({
    initialContent: createShellPaneContent(),
  });
  const horizontal = split(initial, "horizontal");
  let resized = horizontal;

  for (let count = 0; count < 8; count += 1) {
    resized = applied(
      applyPaneOperation(resized, {
        kind: "resize",
        direction: "left",
      }),
    );
  }

  const limited = applyPaneOperation(resized, {
    kind: "resize",
    direction: "left",
  });
  const closed = applied(applyPaneOperation(horizontal, { kind: "close" }));
  const closeLast = applyPaneOperation(initial, { kind: "close" });

  if (resized.tree.kind !== "split") {
    assert.fail("Expected a split tree after resize.");
  }

  assert.equal(resized.tree.ratio, 10);
  assert.deepEqual(limited, {
    kind: "rejected",
    reason: "minimum-pane-size",
  });
  assert.deepEqual(paneLeaves(closed.tree).map((pane) => pane.id), ["pane-1"]);
  assert.equal(closed.activePaneId, "pane-1");
  assert.deepEqual(closeLast, {
    kind: "rejected",
    reason: "close-last-pane",
  });
});

test("swaps, rotates, zooms, and reconstructs named layouts without viewport state", () => {
  const first = createPaneWorkspace({
    initialContent: createShellPaneContent(),
  });
  const second = split(
    first,
    "horizontal",
    createPlaceholderViewerPaneContent("Viewer"),
  );
  const third = split(
    second,
    "vertical",
    createPlaceholderViewerPaneContent("Second"),
  );
  const swapped = applied(
    applyPaneOperation(third, {
      kind: "swap",
      direction: "previous",
    }),
  );
  const rotated = applied(
    applyPaneOperation(swapped, {
      kind: "rotate",
      direction: "next",
    }),
  );
  const zoomed = applied(applyPaneOperation(rotated, { kind: "toggle-zoom" }));
  const tiled = applied(
    applyPaneOperation(zoomed, {
      kind: "set-layout",
      layout: "tiled",
    }),
  );
  const main = applied(
    applyPaneOperation(tiled, {
      kind: "set-layout",
      layout: "main-vertical",
    }),
  );

  assert.deepEqual(
    paneLeaves(swapped.tree).map((pane) => pane.id),
    ["pane-1", "pane-3", "pane-2"],
  );
  assert.deepEqual(
    paneLeaves(rotated.tree).map((pane) => pane.id),
    ["pane-3", "pane-2", "pane-1"],
  );
  assert.deepEqual(zoomed.zoom, { kind: "active", paneId: "pane-3" });
  assert.equal(tiled.layout, "tiled");
  assert.equal(main.layout, "main-vertical");
  assert.equal(main.zoom.kind, "none");
});

test("requires confirmation before closing a dirty editor pane", () => {
  const shell = createPaneWorkspace({
    initialContent: createShellPaneContent(),
  });
  const editorWorkspace = split(
    shell,
    "vertical",
    createEditorPaneContent("Untitled"),
  );
  const editor = paneLeaves(editorWorkspace.tree).find(
    (pane) => pane.id === editorWorkspace.activePaneId,
  );

  if (editor === undefined || editor.content.kind !== "editor") {
    assert.fail("Expected the new active pane to be an editor.");
  }

  const dirty = applied(
    applyPaneOperation(editorWorkspace, {
      kind: "replace-editor-buffer",
      paneId: editor.id,
      buffer: insertVimText(editor.content.buffer, "draft"),
    }),
  );
  const requested = applyPaneOperation(dirty, { kind: "close" });
  const confirmed = applied(
    applyPaneOperation(dirty, { kind: "confirm-close" }),
  );

  assert.equal(requested.kind, "confirmation-required");
  assert.deepEqual(paneLeaves(confirmed.tree).map((pane) => pane.id), [
    "pane-1",
  ]);
});

function authoringDraft(source: string, recordRevision = 0): PublicationDraft {
  const frontMatter = validatePublicationSource(source);
  if (frontMatter.kind === "invalid") assert.fail(frontMatter.message);
  return {
    schemaVersion: 1,
    recordRevision,
    kind: "note",
    repositoryPath: "notes/runtime/example.md",
    virtualPath: "~/notes/runtime/example.md",
    frontMatter: frontMatter.value,
    source,
    base: { kind: "new", defaultBranch: "main", headSha: "a".repeat(40) },
    dirty: true,
    unpublished: true,
    stagedAssets: [],
  };
}

test("async authoring completions preserve the current buffer and conditionally close wq", () => {
  const source = minimalPublicationSource("example");
  const submittedSource = source + "\nSubmitted.";
  const newerSource = submittedSource + "\nTyped while saving.";
  const initial = split(
    createPaneWorkspace({ initialContent: createShellPaneContent() }),
    "vertical",
    createAuthoringEditorPaneContent(authoringDraft(source)),
  );
  const editorId = initial.activePaneId;
  const withNewerBuffer = applied(applyPaneOperation(initial, {
    kind: "replace-editor-buffer",
    paneId: editorId,
    buffer: createVimBuffer({ text: newerSource, mode: { kind: "normal" } }),
  }));
  const completed = applied(applyPaneOperation(withNewerBuffer, {
    kind: "complete-authoring-save",
    paneId: editorId,
    draft: authoringDraft(submittedSource, 1),
    savedSource: submittedSource,
    message: "saved",
    closeIfBufferMatchesSavedSource: true,
  }));
  const retained = paneLeaves(completed.tree).find((pane) => pane.id === editorId);
  if (retained?.content.kind !== "authoring-editor") assert.fail("A newer buffer must keep the editor open.");
  assert.equal(vimBufferText(retained.content.buffer), newerSource);
  assert.equal(retained.content.savedSource, submittedSource);
  assert.equal(retained.content.draft.recordRevision, 1);

  const messaged = applied(applyPaneOperation(completed, {
    kind: "set-authoring-message",
    paneId: editorId,
    message: "stale",
  }));
  const afterMessage = paneLeaves(messaged.tree).find((pane) => pane.id === editorId);
  assert.equal(
    afterMessage?.content.kind === "authoring-editor" ? vimBufferText(afterMessage.content.buffer) : undefined,
    newerSource,
  );

  const matching = applied(applyPaneOperation(initial, {
    kind: "replace-editor-buffer",
    paneId: editorId,
    buffer: createVimBuffer({ text: submittedSource, mode: { kind: "normal" } }),
  }));
  const closed = applied(applyPaneOperation(matching, {
    kind: "complete-authoring-save",
    paneId: editorId,
    draft: authoringDraft(submittedSource, 1),
    savedSource: submittedSource,
    message: "saved",
    closeIfBufferMatchesSavedSource: true,
  }));
  assert.equal(paneLeaves(closed.tree).some((pane) => pane.id === editorId), false);
});

test("async media completion inserts at the submitted cursor without replacing a concurrently edited buffer", () => {
  const source = minimalPublicationSource("example");
  const link = "![image](/assets/notes/runtime/example/image.png)";
  const stagedSource = source + link;
  const stagedDraft = {
    ...authoringDraft(stagedSource, 1),
    stagedAssets: [{ destinationPath: "assets/notes/runtime/example/image.png", mediaType: "image/png" }],
  } satisfies PublicationDraft;
  const initial = split(
    createPaneWorkspace({ initialContent: createShellPaneContent() }),
    "vertical",
    createAuthoringEditorPaneContent(authoringDraft(source)),
  );
  const editorId = initial.activePaneId;
  const inserted = applied(applyPaneOperation(initial, {
    kind: "complete-authoring-media",
    paneId: editorId,
    draft: stagedDraft,
    submittedSource: source,
    completedBuffer: createVimBuffer({ text: stagedSource, mode: { kind: "normal" } }),
    message: "staged",
  }));
  const insertedPane = paneLeaves(inserted.tree).find((pane) => pane.id === editorId);
  assert.equal(
    insertedPane?.content.kind === "authoring-editor" ? vimBufferText(insertedPane.content.buffer) : undefined,
    stagedSource,
  );

  const newerSource = source + "Typed while staging.";
  const concurrent = applied(applyPaneOperation(initial, {
    kind: "replace-editor-buffer",
    paneId: editorId,
    buffer: createVimBuffer({ text: newerSource, mode: { kind: "normal" } }),
  }));
  const preserved = applied(applyPaneOperation(concurrent, {
    kind: "complete-authoring-media",
    paneId: editorId,
    draft: stagedDraft,
    submittedSource: source,
    completedBuffer: createVimBuffer({ text: stagedSource, mode: { kind: "normal" } }),
    message: "staged",
  }));
  const preservedPane = paneLeaves(preserved.tree).find((pane) => pane.id === editorId);
  if (preservedPane?.content.kind !== "authoring-editor") assert.fail("Expected the authoring editor.");
  assert.equal(vimBufferText(preservedPane.content.buffer), newerSource);
  assert.equal(preservedPane.content.savedSource, stagedSource);
  assert.equal(preservedPane.content.draft.recordRevision, 1);
});

test("publication completion can close an unchanged submitted buffer and retains concurrent text against the published base", () => {
  const source = minimalPublicationSource("example");
  const concurrentSource = source + "\nTyped while publishing.";
  const initial = split(
    createPaneWorkspace({ initialContent: createShellPaneContent() }),
    "vertical",
    createAuthoringEditorPaneContent(authoringDraft(source)),
  );
  const editorId = initial.activePaneId;
  const publishedDraft = {
    ...authoringDraft(source),
    base: { kind: "existing", defaultBranch: "main", headSha: "b".repeat(40), blobSha: "c".repeat(40) },
    dirty: false,
    unpublished: false,
  } satisfies PublicationDraft;
  const closed = applied(applyPaneOperation(initial, {
    kind: "complete-authoring-publication",
    paneId: editorId,
    draft: publishedDraft,
    submittedSource: source,
    message: "published",
    closeIfBufferMatchesSubmittedSource: true,
  }));
  assert.equal(paneLeaves(closed.tree).some((pane) => pane.id === editorId), false);

  const concurrent = applied(applyPaneOperation(initial, {
    kind: "replace-editor-buffer",
    paneId: editorId,
    buffer: createVimBuffer({ text: concurrentSource, mode: { kind: "normal" } }),
  }));
  const retained = applied(applyPaneOperation(concurrent, {
    kind: "complete-authoring-publication",
    paneId: editorId,
    draft: publishedDraft,
    submittedSource: source,
    message: "published",
    closeIfBufferMatchesSubmittedSource: true,
  }));
  const pane = paneLeaves(retained.tree).find((candidate) => candidate.id === editorId);
  if (pane?.content.kind !== "authoring-editor") assert.fail("Concurrent publication typing must remain open.");
  assert.equal(vimBufferText(pane.content.buffer), concurrentSource);
  assert.equal(pane.content.savedSource, source);
  assert.deepEqual(pane.content.draft.base, publishedDraft.base);
});

test("conflict completion wraps concurrent typing in the LOCAL side of whole-document markers", () => {
  const submitted = minimalPublicationSource("example");
  const concurrent = submitted + "\nTyped while awaiting conflict.";
  const upstream = minimalPublicationSource("upstream");
  const currentDraft = {
    ...authoringDraft(submitted, 3),
    stagedAssets: [{ destinationPath: "assets/notes/runtime/example/image.png", mediaType: "image/png" }],
  } satisfies PublicationDraft;
  const latestBase = {
    kind: "existing" as const,
    defaultBranch: "main",
    headSha: "b".repeat(40),
    blobSha: "c".repeat(40),
  };
  const initial = split(
    createPaneWorkspace({ initialContent: createShellPaneContent() }),
    "vertical",
    createAuthoringEditorPaneContent(currentDraft),
  );
  const editorId = initial.activePaneId;
  const changed = applied(applyPaneOperation(initial, {
    kind: "replace-editor-buffer",
    paneId: editorId,
    buffer: createVimBuffer({ text: concurrent, mode: { kind: "normal" } }),
  }));
  const conflicted = applied(applyPaneOperation(changed, {
    kind: "complete-authoring-conflict",
    paneId: editorId,
    draft: {
      ...authoringDraft(submitted),
      base: latestBase,
    },
    submittedSource: submitted,
    conflictBuffer: createVimBuffer({ text: "unused submitted markers", mode: { kind: "normal" } }),
    upstreamMarkdown: upstream,
    message: "conflict",
  }));
  const pane = paneLeaves(conflicted.tree).find((candidate) => candidate.id === editorId);
  if (pane?.content.kind !== "authoring-editor") assert.fail("Conflict must retain the authoring editor.");
  assert.equal(
    vimBufferText(pane.content.buffer),
    `<<<<<<< LOCAL\n${concurrent}\n=======\n${upstream}\n>>>>>>> UPSTREAM`,
  );
  assert.equal(pane.content.draft.recordRevision, 3);
  assert.deepEqual(pane.content.draft.stagedAssets, currentDraft.stagedAssets);
  assert.deepEqual(pane.content.draft.base, latestBase);
  assert.equal(pane.content.draft.dirty, true);
  assert.equal(pane.content.draft.unpublished, true);
});
