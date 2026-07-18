import assert from "node:assert/strict";
import test from "node:test";
import { demoContentCorpus } from "../../content/DemoContentCorpus.ts";
import {
  applyPaneOperation,
  createPaneId,
  createPaneWorkspace,
  createShellPaneContent,
  type PaneOperation,
} from "../../domain/workspace/PaneTree.ts";
import {
  createShellId,
  createShellSessionId,
} from "../../domain/terminal/Shell.ts";
import { virtualHomeDirectory } from "../../domain/filesystem/VirtualFilesystem.ts";
import {
  createPaneCommandDefinition,
  parsePaneCommand,
} from "./PaneCommand.ts";
import { createCommandRegistry } from "./CommandRegistry.ts";

test("parses the full pane-management command seam", () => {
  const paneId = createPaneId("pane-1");
  const split = parsePaneCommand(["split", "vertical", "editor"], paneId);
  const focus = parsePaneCommand(["focus", "3"], paneId);
  const layout = parsePaneCommand(["layout", "tiled"], paneId);
  const invalid = parsePaneCommand(["resize", "diagonal"], paneId);

  if (split.kind !== "parsed") {
    assert.fail("Expected a pane split command.");
  }

  assert.deepEqual(split.operation.kind, "split");
  if (split.operation.kind === "split") {
    assert.equal(split.operation.orientation, "vertical");
    assert.equal(split.operation.paneId, paneId);
    assert.equal(split.operation.content.kind, "editor");
  }
  assert.deepEqual(focus, {
    kind: "parsed",
    operation: { kind: "focus-number", number: 3 },
  });
  assert.deepEqual(layout, {
    kind: "parsed",
    operation: { kind: "set-layout", layout: "tiled" },
  });
  assert.equal(invalid.kind, "invalid");
});

test("executes parsed pane operations through the existing command registry contract", async () => {
  const workspace = createPaneWorkspace({
    initialContent: createShellPaneContent(),
  });
  let received: PaneOperation | undefined;
  const command = createPaneCommandDefinition(workspace.activePaneId, (operation) => {
    received = operation;
    return applyPaneOperation(workspace, operation);
  });
  const registry = createCommandRegistry({
    commands: [command],
    filesystem: demoContentCorpus.filesystem,
  });
  const outcome = await command.execute(
    {
      source: "pane split horizontal viewer",
      name: "pane",
      arguments: ["split", "horizontal", "viewer"],
      optionTerminator: { kind: "absent" },
      stdin: { kind: "none" },
    },
    {
      shellId: createShellId("shell"),
      sessionId: createShellSessionId("session"),
      currentDirectory: virtualHomeDirectory(),
      commandHistory: [],
      registry,
      signal: new AbortController().signal,
    },
  );

  assert.deepEqual(received, {
    kind: "split",
    paneId: workspace.activePaneId,
    orientation: "horizontal",
    content: {
      kind: "viewer",
      viewer: { kind: "placeholder", title: "Viewer" },
    },
  });
  assert.equal(outcome.kind, "succeeded");
});
