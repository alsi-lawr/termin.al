import assert from "node:assert/strict";
import test from "node:test";
import { developmentFixtureCorpus } from "../../content/DevelopmentFixtureCorpus.ts";
import {
  resolveVirtualDirectory,
  virtualHomeDirectory,
} from "../filesystem/VirtualFilesystem.ts";
import type { ShellState } from "../terminal/Shell.ts";
import {
  applyPaneOperation,
  createPaneWorkspace,
  createShellPaneContent,
  paneLeaves,
  type PaneId,
  type PaneOperation,
  type PaneOperationResult,
  type PaneWorkspace,
} from "./PaneTree.ts";
import {
  createPaneShellStates,
  hasPaneShellState,
  paneShellState,
  reconcilePaneShellStates,
  reducePaneShellState,
  type PaneShellStates,
} from "./PaneShellStates.ts";

function applied(result: PaneOperationResult): PaneWorkspace {
  if (result.kind !== "applied") {
    assert.fail("Expected the pane operation to apply.");
  }

  return result.workspace;
}

function apply(
  workspace: PaneWorkspace,
  operation: PaneOperation,
): PaneWorkspace {
  return applied(applyPaneOperation(workspace, operation));
}

function synchronise(
  states: PaneShellStates,
  workspace: PaneWorkspace,
): PaneShellStates {
  return reconcilePaneShellStates({
    states,
    workspace,
    currentDirectory: virtualHomeDirectory(),
  });
}

function stateFor(states: PaneShellStates, paneId: PaneId): ShellState {
  return paneShellState(states, paneId);
}

function projectsDirectoryPath() {
  const resolution = resolveVirtualDirectory(
    developmentFixtureCorpus.filesystem,
    virtualHomeDirectory(),
    "projects",
  );

  if (resolution.kind !== "found") {
    assert.fail("Expected the development projects directory.");
  }

  return resolution.directory.path;
}

function settleCurrentDirectory(
  states: PaneShellStates,
  paneId: PaneId,
): PaneShellStates {
  const submitted = reducePaneShellState({
    states: reducePaneShellState({
      states,
      paneId,
      action: { kind: "input.insert", text: "cd projects" },
    }),
    paneId,
    action: { kind: "prompt.submit" },
  });
  const state = stateFor(submitted, paneId);

  if (state.lifecycle.kind !== "running") {
    assert.fail("Expected the shell command to be running.");
  }

  return reducePaneShellState({
    states: submitted,
    paneId,
    action: {
      kind: "command.settled",
      commandId: state.lifecycle.command.id,
      outcome: {
        kind: "succeeded",
        outputs: [],
        effects: [
          {
            kind: "set-current-directory",
            directory: projectsDirectoryPath(),
          },
        ],
      },
    },
  });
}

function insert(
  states: PaneShellStates,
  paneId: PaneId,
  text: string,
): PaneShellStates {
  return reducePaneShellState({
    states,
    paneId,
    action: { kind: "input.insert", text },
  });
}

test("keeps shell state and current directory with stable pane IDs through pane tree transforms", () => {
  let workspace = createPaneWorkspace({
    initialContent: createShellPaneContent(),
  });
  let states = createPaneShellStates({
    workspace,
    currentDirectory: virtualHomeDirectory(),
  });
  const firstPaneId = workspace.activePaneId;

  workspace = apply(workspace, {
    kind: "split",
    orientation: "horizontal",
    content: createShellPaneContent(),
  });
  states = synchronise(states, workspace);
  const secondPaneId = workspace.activePaneId;

  workspace = apply(workspace, {
    kind: "split",
    orientation: "vertical",
    content: createShellPaneContent(),
  });
  states = synchronise(states, workspace);
  const thirdPaneId = workspace.activePaneId;

  states = settleCurrentDirectory(states, secondPaneId);
  states = insert(states, firstPaneId, "first input");
  states = insert(states, secondPaneId, "second input");
  states = insert(states, thirdPaneId, "third input");

  const beforeTransforms = states;
  const swapped = apply(workspace, { kind: "swap", direction: "previous" });
  states = synchronise(states, swapped);
  const rotated = apply(swapped, { kind: "rotate", direction: "next" });
  states = synchronise(states, rotated);
  const rebuilt = apply(rotated, { kind: "set-layout", layout: "tiled" });
  states = synchronise(states, rebuilt);

  assert.equal(states, beforeTransforms);
  assert.equal(stateFor(states, firstPaneId).input.buffer.value, "first input");
  assert.equal(stateFor(states, secondPaneId).input.buffer.value, "second input");
  assert.equal(stateFor(states, thirdPaneId).input.buffer.value, "third input");
  assert.equal(stateFor(states, secondPaneId).currentDirectory, "~/projects");
  assert.deepEqual(
    paneLeaves(rebuilt.tree).map((pane) => pane.id),
    [thirdPaneId, secondPaneId, firstPaneId],
  );

  const focused = apply(rebuilt, {
    kind: "focus-pane",
    paneId: secondPaneId,
  });
  const closed = apply(focused, { kind: "close" });
  states = synchronise(states, closed);

  assert.equal(hasPaneShellState(states, secondPaneId), false);
  assert.equal(stateFor(states, firstPaneId).input.buffer.value, "first input");
  assert.equal(stateFor(states, thirdPaneId).input.buffer.value, "third input");
});
