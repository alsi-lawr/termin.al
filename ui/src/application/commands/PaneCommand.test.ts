import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPaneOperation,
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
  const split = parsePaneCommand(["split", "vertical", "editor"]);
  const focus = parsePaneCommand(["focus", "3"]);
  const layout = parsePaneCommand(["layout", "tiled"]);
  const invalid = parsePaneCommand(["resize", "diagonal"]);

  if (split.kind !== "parsed") {
    assert.fail("Expected a pane split command.");
  }

  assert.deepEqual(split.operation.kind, "split");
  if (split.operation.kind === "split") {
    assert.equal(split.operation.orientation, "vertical");
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
  const command = createPaneCommandDefinition((operation) => {
    received = operation;
    return applyPaneOperation(workspace, operation);
  });
  const registry = createCommandRegistry({ commands: [command] });
  const outcome = await command.execute(
    {
      source: "pane split horizontal viewer",
      name: "pane",
      arguments: ["split", "horizontal", "viewer"],
      optionTerminator: { kind: "absent" },
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
    orientation: "horizontal",
    content: { kind: "viewer", title: "Viewer" },
  });
  assert.equal(outcome.kind, "succeeded");
});
