import assert from "node:assert/strict";
import test from "node:test";
import { insertVimText } from "../vim/VimBuffer.ts";
import {
  applyPaneOperation,
  createEditorPaneContent,
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
