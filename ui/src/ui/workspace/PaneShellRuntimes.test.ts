import assert from "node:assert/strict";
import test from "node:test";
import {
  createPlaceholderViewerContent,
  type ViewerContent,
} from "../../content/ViewerContent.ts";
import { developmentFixtureCorpus } from "../../content/DevelopmentFixtureCorpus.ts";
import {
  resolveVirtualDirectory,
  virtualHomeDirectory,
} from "../../domain/filesystem/VirtualFilesystem.ts";
import type {
  CommandOutcome,
  ShellState,
} from "../../domain/terminal/Shell.ts";
import {
  applyPaneOperation,
  createPaneWorkspace,
  createShellPaneContent,
  paneLeaves,
  type PaneId,
  type PaneOperation,
  type PaneOperationResult,
  type PaneWorkspace,
} from "../../domain/workspace/PaneTree.ts";
import {
  applyPaneShellAction,
  closePaneShellViewer,
  createPaneShellRuntimes,
  disposePaneShellRuntimes,
  hasPaneShellRuntime,
  paneShellRuntime,
  reconcilePaneShellRuntimes,
  reducePaneShellRuntime,
  type PaneShellRuntimes,
} from "./PaneShellRuntimes.ts";

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
  runtimes: PaneShellRuntimes,
  workspace: PaneWorkspace,
): PaneShellRuntimes {
  return reconcilePaneShellRuntimes({
    runtimes,
    workspace,
    currentDirectory: virtualHomeDirectory(),
  });
}

function stateFor(runtimes: PaneShellRuntimes, paneId: PaneId): ShellState {
  return paneShellRuntime(runtimes, paneId).state;
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
  runtimes: PaneShellRuntimes,
  paneId: PaneId,
): PaneShellRuntimes {
  const submitted = reducePaneShellRuntime({
    runtimes: reducePaneShellRuntime({
      runtimes,
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

  return reducePaneShellRuntime({
    runtimes: submitted,
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
  runtimes: PaneShellRuntimes,
  paneId: PaneId,
  text: string,
): PaneShellRuntimes {
  return reducePaneShellRuntime({
    runtimes,
    paneId,
    action: { kind: "input.insert", text },
  });
}

function submitRunningCommand(
  runtimes: PaneShellRuntimes,
  paneId: PaneId,
): PaneShellRuntimes {
  const withInput = reducePaneShellRuntime({
    runtimes,
    paneId,
    action: { kind: "input.insert", text: "find ." },
  });

  return reducePaneShellRuntime({
    runtimes: withInput,
    paneId,
    action: { kind: "prompt.submit" },
  });
}

function successfulCommandOutcome(): CommandOutcome {
  return { kind: "succeeded", outputs: [], effects: [] };
}

function viewerCommandOutcome(
  viewer: ViewerContent,
  disposition: "inline" | "split",
): CommandOutcome {
  return {
    kind: "succeeded",
    outputs: [],
    effects: [
      {
        kind: "open-viewer",
        viewer,
        disposition:
          disposition === "inline"
            ? { kind: "inline" }
            : { kind: "split", orientation: "vertical" },
      },
    ],
  };
}

function deferredCommandOutcome(): Readonly<{
  promise: Promise<CommandOutcome>;
  resolve: (outcome: CommandOutcome) => void;
}> {
  let resolveOutcome: (outcome: CommandOutcome) => void = () => {
    throw new Error("Deferred command outcomes must initialize their resolver.");
  };
  const promise = new Promise<CommandOutcome>((resolve) => {
    resolveOutcome = resolve;
  });

  return { promise, resolve: resolveOutcome };
}

test("keeps shell state and current directory with stable pane IDs through pane tree transforms", () => {
  let workspace = createPaneWorkspace({
    initialContent: createShellPaneContent(),
  });
  let runtimes = createPaneShellRuntimes({
    workspace,
    currentDirectory: virtualHomeDirectory(),
  });
  const firstPaneId = workspace.activePaneId;

  workspace = apply(workspace, {
    kind: "split",
    paneId: workspace.activePaneId,
    orientation: "horizontal",
    content: createShellPaneContent(),
  });
  runtimes = synchronise(runtimes, workspace);
  const secondPaneId = workspace.activePaneId;

  workspace = apply(workspace, {
    kind: "split",
    paneId: workspace.activePaneId,
    orientation: "vertical",
    content: createShellPaneContent(),
  });
  runtimes = synchronise(runtimes, workspace);
  const thirdPaneId = workspace.activePaneId;

  runtimes = settleCurrentDirectory(runtimes, secondPaneId);
  runtimes = insert(runtimes, firstPaneId, "first input");
  runtimes = insert(runtimes, secondPaneId, "second input");
  runtimes = insert(runtimes, thirdPaneId, "third input");

  const beforeTransforms = runtimes;
  const swapped = apply(workspace, { kind: "swap", direction: "previous" });
  runtimes = synchronise(runtimes, swapped);
  const rotated = apply(swapped, { kind: "rotate", direction: "next" });
  runtimes = synchronise(runtimes, rotated);
  const rebuilt = apply(rotated, { kind: "set-layout", layout: "tiled" });
  runtimes = synchronise(runtimes, rebuilt);

  assert.equal(runtimes, beforeTransforms);
  assert.equal(stateFor(runtimes, firstPaneId).input.buffer.value, "first input");
  assert.equal(stateFor(runtimes, secondPaneId).input.buffer.value, "second input");
  assert.equal(stateFor(runtimes, thirdPaneId).input.buffer.value, "third input");
  assert.equal(stateFor(runtimes, secondPaneId).currentDirectory, "~/projects");
  assert.deepEqual(
    paneLeaves(rebuilt.tree).map((pane) => pane.id),
    [thirdPaneId, secondPaneId, firstPaneId],
  );

  const focused = apply(rebuilt, {
    kind: "focus-pane",
    paneId: secondPaneId,
  });
  const closed = apply(focused, { kind: "close" });
  runtimes = synchronise(runtimes, closed);

  assert.equal(hasPaneShellRuntime(runtimes, secondPaneId), false);
  assert.equal(stateFor(runtimes, firstPaneId).input.buffer.value, "first input");
  assert.equal(stateFor(runtimes, thirdPaneId).input.buffer.value, "third input");
});

test("keeps two pane-owned shell runtimes after swap and layout reconstruction", () => {
  let workspace = createPaneWorkspace({
    initialContent: createShellPaneContent(),
  });
  workspace = apply(workspace, {
    kind: "split",
    paneId: workspace.activePaneId,
    orientation: "horizontal",
    content: createShellPaneContent(),
  });
  const [firstPane, secondPane] = paneLeaves(workspace.tree);

  if (firstPane === undefined || secondPane === undefined) {
    assert.fail("Expected two shell panes.");
  }

  let runtimes = createPaneShellRuntimes({
    workspace,
    currentDirectory: virtualHomeDirectory(),
  });
  runtimes = insert(runtimes, firstPane.id, "first pane input");
  runtimes = insert(runtimes, secondPane.id, "second pane input");

  const swapped = apply(workspace, { kind: "swap", direction: "previous" });
  runtimes = synchronise(runtimes, swapped);
  const rebuilt = apply(swapped, {
    kind: "set-layout",
    layout: "main-vertical",
  });
  runtimes = synchronise(runtimes, rebuilt);

  assert.equal(
    stateFor(runtimes, firstPane.id).input.buffer.value,
    "first pane input",
  );
  assert.equal(
    stateFor(runtimes, secondPane.id).input.buffer.value,
    "second pane input",
  );
});

test("preserves runtime controls across transforms and disposes them when a pane closes", () => {
  let workspace = createPaneWorkspace({
    initialContent: createShellPaneContent(),
  });
  let runtimes = createPaneShellRuntimes({
    workspace,
    currentDirectory: virtualHomeDirectory(),
  });

  workspace = apply(workspace, {
    kind: "split",
    paneId: workspace.activePaneId,
    orientation: "horizontal",
    content: createShellPaneContent(),
  });
  runtimes = synchronise(runtimes, workspace);
  const secondPaneId = workspace.activePaneId;
  const secondRuntime = paneShellRuntime(runtimes, secondPaneId);
  runtimes = submitRunningCommand(runtimes, secondPaneId);
  const running = stateFor(runtimes, secondPaneId);

  if (running.lifecycle.kind !== "running") {
    assert.fail("Expected a running command.");
  }

  const commandController = secondRuntime.control.startCommand(
    running.lifecycle.command.id,
  );
  const completionController = secondRuntime.control.startCompletion();

  if (commandController === undefined || completionController === undefined) {
    assert.fail("Expected the shell runtime to start command and completion work.");
  }

  const swapped = apply(workspace, { kind: "swap", direction: "previous" });
  runtimes = synchronise(runtimes, swapped);
  const rotated = apply(swapped, { kind: "rotate", direction: "next" });
  runtimes = synchronise(runtimes, rotated);
  const rebuilt = apply(rotated, { kind: "set-layout", layout: "tiled" });
  runtimes = synchronise(runtimes, rebuilt);

  assert.equal(
    paneShellRuntime(runtimes, secondPaneId).control,
    secondRuntime.control,
  );

  const focused = apply(rebuilt, {
    kind: "focus-pane",
    paneId: secondPaneId,
  });
  const closed = apply(focused, { kind: "close" });
  runtimes = synchronise(runtimes, closed);

  assert.equal(commandController.signal.aborted, true);
  assert.equal(completionController.signal.aborted, true);
  assert.equal(hasPaneShellRuntime(runtimes, secondPaneId), false);
  assert.equal(secondRuntime.control.startCompletion(), undefined);
});

test("releases pane runtime controls when the workspace unmounts", () => {
  const workspace = createPaneWorkspace({
    initialContent: createShellPaneContent(),
  });
  let runtimes = createPaneShellRuntimes({
    workspace,
    currentDirectory: virtualHomeDirectory(),
  });
  const paneId = workspace.activePaneId;
  const runtime = paneShellRuntime(runtimes, paneId);
  runtimes = submitRunningCommand(runtimes, paneId);
  const state = stateFor(runtimes, paneId);

  if (state.lifecycle.kind !== "running") {
    assert.fail("Expected a running command.");
  }

  const commandController = runtime.control.startCommand(state.lifecycle.command.id);
  const completionController = runtime.control.startCompletion();

  if (commandController === undefined || completionController === undefined) {
    assert.fail("Expected the shell runtime to start command and completion work.");
  }

  disposePaneShellRuntimes(runtimes);

  assert.equal(commandController.signal.aborted, true);
  assert.equal(completionController.signal.aborted, true);
  assert.equal(runtime.control.startCompletion(), undefined);
});

test("cancels the original command after its pane moves and rejects a late result", () => {
  let workspace = createPaneWorkspace({
    initialContent: createShellPaneContent(),
  });
  let runtimes = createPaneShellRuntimes({
    workspace,
    currentDirectory: virtualHomeDirectory(),
  });
  const firstPaneId = workspace.activePaneId;

  workspace = apply(workspace, {
    kind: "split",
    paneId: workspace.activePaneId,
    orientation: "horizontal",
    content: createShellPaneContent(),
  });
  runtimes = synchronise(runtimes, workspace);
  runtimes = submitRunningCommand(runtimes, firstPaneId);
  const state = stateFor(runtimes, firstPaneId);

  if (state.lifecycle.kind !== "running") {
    assert.fail("Expected a running command.");
  }

  const originalRuntime = paneShellRuntime(runtimes, firstPaneId);
  const originalController = originalRuntime.control.startCommand(
    state.lifecycle.command.id,
  );

  if (originalController === undefined) {
    assert.fail("Expected the pane runtime to own the command controller.");
  }

  const swapped = apply(workspace, { kind: "swap", direction: "previous" });
  runtimes = synchronise(runtimes, swapped);
  const rotated = apply(swapped, { kind: "rotate", direction: "next" });
  runtimes = synchronise(runtimes, rotated);
  const rebuilt = apply(rotated, { kind: "set-layout", layout: "tiled" });
  runtimes = synchronise(runtimes, rebuilt);

  const movedRuntime = paneShellRuntime(runtimes, firstPaneId);
  movedRuntime.control.abortCommand(state.lifecycle.command.id);

  assert.equal(movedRuntime.control, originalRuntime.control);
  assert.equal(originalController.signal.aborted, true);
  assert.equal(
    movedRuntime.control.finishCommand(
      state.lifecycle.command.id,
      originalController,
      successfulCommandOutcome(),
    ),
    false,
  );
});

test("routes an asynchronous inline viewer resolution to its moved shell runtime", async () => {
  let workspace = createPaneWorkspace({
    initialContent: createShellPaneContent(),
  });
  let runtimes = createPaneShellRuntimes({
    workspace,
    currentDirectory: virtualHomeDirectory(),
  });
  const originPaneId = workspace.activePaneId;

  workspace = apply(workspace, {
    kind: "split",
    paneId: originPaneId,
    orientation: "horizontal",
    content: createShellPaneContent(),
  });
  runtimes = synchronise(runtimes, workspace);
  const otherPaneId = workspace.activePaneId;
  runtimes = submitRunningCommand(runtimes, originPaneId);
  const running = stateFor(runtimes, originPaneId);

  if (running.lifecycle.kind !== "running") {
    assert.fail("Expected the originating shell command to be running.");
  }

  const swapped = apply(workspace, { kind: "swap", direction: "previous" });
  const rotated = apply(swapped, { kind: "rotate", direction: "next" });
  const rebuilt = apply(rotated, { kind: "set-layout", layout: "tiled" });
  workspace = apply(rebuilt, {
    kind: "focus-pane",
    paneId: otherPaneId,
  });
  runtimes = synchronise(runtimes, workspace);
  const delayed = deferredCommandOutcome();
  const viewer = createPlaceholderViewerContent("Inline viewer");

  delayed.resolve(viewerCommandOutcome(viewer, "inline"));
  const outcome = await delayed.promise;
  const settled = applyPaneShellAction({
    workspace,
    runtimes,
    paneId: originPaneId,
    action: {
      kind: "command.settled",
      commandId: running.lifecycle.command.id,
      outcome,
    },
  });
  const movedAgain = apply(settled.workspace, {
    kind: "swap",
    direction: "previous",
  });
  const rebuiltAgain = apply(movedAgain, {
    kind: "set-layout",
    layout: "main-vertical",
  });
  const presentedRuntimes = synchronise(settled.runtimes, rebuiltAgain);
  const presented = paneShellRuntime(presentedRuntimes, originPaneId);

  assert.equal(settled.workspace, workspace);
  assert.equal(presentedRuntimes, settled.runtimes);
  assert.deepEqual(presented.presentation, {
    kind: "inline-viewer",
    viewer,
  });
  assert.equal(
    paneShellRuntime(settled.runtimes, otherPaneId).presentation.kind,
    "shell",
  );

  const returned = closePaneShellViewer(presentedRuntimes, originPaneId);

  assert.equal(paneShellRuntime(returned, originPaneId).presentation.kind, "shell");
  assert.equal(
    paneShellRuntime(returned, originPaneId).state,
    presented.state,
  );
  assert.equal(
    paneShellRuntime(returned, originPaneId).state.sessionId,
    running.sessionId,
  );
});

test("routes an asynchronous split viewer resolution to its originating pane", async () => {
  let workspace = createPaneWorkspace({
    initialContent: createShellPaneContent(),
  });
  let runtimes = createPaneShellRuntimes({
    workspace,
    currentDirectory: virtualHomeDirectory(),
  });
  const originPaneId = workspace.activePaneId;

  workspace = apply(workspace, {
    kind: "split",
    paneId: originPaneId,
    orientation: "horizontal",
    content: createShellPaneContent(),
  });
  runtimes = synchronise(runtimes, workspace);
  const otherPaneId = workspace.activePaneId;
  runtimes = submitRunningCommand(runtimes, originPaneId);
  const running = stateFor(runtimes, originPaneId);

  if (running.lifecycle.kind !== "running") {
    assert.fail("Expected the originating shell command to be running.");
  }

  const swapped = apply(workspace, { kind: "swap", direction: "previous" });
  const rotated = apply(swapped, { kind: "rotate", direction: "next" });
  const rebuilt = apply(rotated, { kind: "set-layout", layout: "tiled" });
  workspace = apply(rebuilt, {
    kind: "focus-pane",
    paneId: otherPaneId,
  });
  runtimes = synchronise(runtimes, workspace);
  const delayed = deferredCommandOutcome();
  const viewer = createPlaceholderViewerContent("Split viewer");

  delayed.resolve(viewerCommandOutcome(viewer, "split"));
  const outcome = await delayed.promise;
  const settled = applyPaneShellAction({
    workspace,
    runtimes,
    paneId: originPaneId,
    action: {
      kind: "command.settled",
      commandId: running.lifecycle.command.id,
      outcome,
    },
  });
  const panes = paneLeaves(settled.workspace.tree);
  const originIndex = panes.findIndex((pane) => pane.id === originPaneId);
  const viewerIndex = panes.findIndex(
    (pane) => pane.content.kind === "viewer" && pane.content.viewer === viewer,
  );

  assert.equal(workspace.activePaneId, otherPaneId);
  assert.equal(settled.workspace.activePaneId, "pane-3");
  assert.equal(viewerIndex, originIndex + 1);
  assert.equal(
    paneShellRuntime(settled.runtimes, originPaneId).presentation.kind,
    "shell",
  );
});
