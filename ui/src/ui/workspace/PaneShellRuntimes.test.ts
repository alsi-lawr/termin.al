import assert from "node:assert/strict";
import test from "node:test";
import { ContentId } from "../../api/ContentContracts.ts";
import {
  createCollectionViewerContent,
  createDocumentViewerContent,
  createPlaceholderViewerContent,
  type ViewerContent,
} from "../../content/ViewerContent.ts";
import { demoContentCorpus } from "../../content/DemoContentCorpus.ts";
import {
  resolveVirtualDirectory,
  virtualHomeDirectory,
} from "../../domain/filesystem/VirtualFilesystem.ts";
import type {
  CommandHistoryEntry,
  CommandLineOutcome,
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
  closePaneShellPresentation,
  createPaneShellRuntimes,
  hasPaneShellRuntime,
  paneShellRuntime,
  reconcilePaneShellRuntimes,
  reducePaneShellRuntime,
  synchronizePaneCommandHistory,
  type PaneShellRuntimes,
} from "./PaneShellRuntimes.ts";
import {
  commandHistoryFromStoredValue,
  commandHistoryStorageKey,
  readCommandHistory,
  writeCommandHistory,
} from "./CommandHistoryStorage.ts";

function applied(result: PaneOperationResult): PaneWorkspace {
  if (result.kind !== "applied") {
    assert.fail("Expected the pane operation to apply.");
  }

  return result.workspace;
}

test("keeps collection commands in one shell history row and removes transient selection on return", () => {
  const workspace = createPaneWorkspace({
    initialContent: createShellPaneContent(),
  });
  const paneId = workspace.activePaneId;
  const initial = createPaneShellRuntimes({
    workspace,
    currentDirectory: virtualHomeDirectory(),
    commandHistory: [],
  });
  const withInput = insert(initial, paneId, "projects");
  const submitted = reducePaneShellRuntime({
    runtimes: withInput,
    paneId,
    action: {
      kind: "prompt.submit",
      submission: {
        kind: "command",
        persistence: { kind: "persistent" },
      },
    },
  });
  const running = stateFor(submitted, paneId);

  if (running.lifecycle.kind !== "running") {
    assert.fail("Expected projects to be running.");
  }

  const collection = createCollectionViewerContent({
    title: "Projects",
    emptyMessage: "No projects. Press Esc to return.",
    roots: [],
  });
  const settled = applyPaneShellAction({
    workspace,
    runtimes: submitted,
    paneId,
    action: {
      kind: "command.settled",
      commandId: running.lifecycle.command.id,
      outcome: viewerCommandOutcome(collection, "inline"),
    },
  });
  const presented = paneShellRuntime(settled.runtimes, paneId);

  assert.equal(presented.presentation.kind, "inline-collection");
  assert.equal(presented.state.history.length, 1);
  assert.equal(presented.state.history[0]?.command.source, "projects");
  assert.equal(presented.state.commandHistory.length, 1);
  assert.equal(presented.state.input.text, "");

  const returned = closePaneShellPresentation(settled.runtimes, paneId);
  const shell = paneShellRuntime(returned, paneId);
  assert.equal(shell.presentation.kind, "shell");
  assert.equal(shell.state.history.length, 1);
  assert.equal(shell.state.input.text, "");
});

test("keeps theme select in one history row and scopes its presentation to the invoking pane", () => {
  let workspace = createPaneWorkspace({ initialContent: createShellPaneContent() });
  const paneId = workspace.activePaneId;
  workspace = apply(workspace, {
    kind: "split",
    paneId,
    orientation: "horizontal",
    content: createShellPaneContent(),
  });
  let runtimes = createPaneShellRuntimes({
    workspace,
    currentDirectory: virtualHomeDirectory(),
    commandHistory: [],
  });
  runtimes = insert(runtimes, paneId, "theme select");
  runtimes = reducePaneShellRuntime({
    runtimes,
    paneId,
    action: {
      kind: "prompt.submit",
      submission: { kind: "command", persistence: { kind: "persistent" } },
    },
  });
  const running = stateFor(runtimes, paneId);

  if (running.lifecycle.kind !== "running") {
    assert.fail("Expected theme select to be running.");
  }

  const settled = applyPaneShellAction({
    workspace,
    runtimes,
    paneId,
    action: {
      kind: "command.settled",
      commandId: running.lifecycle.command.id,
      outcome: {
        kind: "succeeded",
        events: [{ kind: "effect", effect: { kind: "open-theme-selector" } }],
      },
    },
  });
  const presented = paneShellRuntime(settled.runtimes, paneId);
  const otherPaneId = paneLeaves(workspace.tree).find((pane) => pane.id !== paneId)?.id;

  if (otherPaneId === undefined) {
    assert.fail("Expected the split shell pane.");
  }

  assert.equal(presented.presentation.kind, "theme-selector");
  assert.equal(presented.state.history.length, 1);
  assert.equal(presented.state.history[0]?.command.source, "theme select");
  assert.equal(paneShellRuntime(settled.runtimes, otherPaneId).presentation.kind, "shell");

  let concurrent = insert(settled.runtimes, otherPaneId, "theme select");
  concurrent = reducePaneShellRuntime({
    runtimes: concurrent,
    paneId: otherPaneId,
    action: {
      kind: "prompt.submit",
      submission: { kind: "command", persistence: { kind: "persistent" } },
    },
  });
  const otherRunning = stateFor(concurrent, otherPaneId);

  if (otherRunning.lifecycle.kind !== "running") {
    assert.fail("Expected the concurrent theme selector to be running.");
  }

  const bothPresented = applyPaneShellAction({
    workspace,
    runtimes: concurrent,
    paneId: otherPaneId,
    action: {
      kind: "command.settled",
      commandId: otherRunning.lifecycle.command.id,
      outcome: {
        kind: "succeeded",
        events: [{ kind: "effect", effect: { kind: "open-theme-selector" } }],
      },
    },
  });
  assert.equal(paneShellRuntime(bothPresented.runtimes, paneId).presentation.kind, "theme-selector");
  assert.equal(paneShellRuntime(bothPresented.runtimes, otherPaneId).presentation.kind, "theme-selector");
  assert.equal(paneShellRuntime(bothPresented.runtimes, otherPaneId).state.history.length, 1);

  const closed = closePaneShellPresentation(
    bothPresented.runtimes,
    paneId,
    "Theme storage is unavailable; the active theme remains usable.",
  );
  const shell = paneShellRuntime(closed, paneId);
  assert.equal(shell.presentation.kind, "shell");
  assert.equal(
    shell.presentation.kind === "shell"
      ? shell.presentation.transientDiagnostic
      : undefined,
    "Theme storage is unavailable; the active theme remains usable.",
  );
  assert.equal(shell.state.history.length, 1);
  assert.equal(
    paneShellRuntime(closed, otherPaneId).presentation.kind,
    "theme-selector",
  );
});

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
    commandHistory:
      runtimes.values().next().value?.state.commandHistory ?? [],
  });
}

function stateFor(runtimes: PaneShellRuntimes, paneId: PaneId): ShellState {
  return paneShellRuntime(runtimes, paneId).state;
}

test("hydrates new panes and projects one shared history into existing panes", () => {
  const hydratedEntry: CommandHistoryEntry = {
    source: "echo hydrated 😀",
    currentDirectory: virtualHomeDirectory(),
    persistence: { kind: "persistent" },
  };
  let workspace = createPaneWorkspace({
    initialContent: createShellPaneContent(),
  });
  let runtimes = createPaneShellRuntimes({
    workspace,
    currentDirectory: virtualHomeDirectory(),
    commandHistory: [hydratedEntry],
  });

  workspace = apply(workspace, {
    kind: "split",
    paneId: workspace.activePaneId,
    orientation: "horizontal",
    content: createShellPaneContent(),
  });
  runtimes = reconcilePaneShellRuntimes({
    runtimes,
    workspace,
    currentDirectory: virtualHomeDirectory(),
    commandHistory: [hydratedEntry],
  });

  for (const pane of paneLeaves(workspace.tree)) {
    assert.equal(
      stateFor(runtimes, pane.id).commandHistory[0]?.source,
      "echo hydrated 😀",
    );
  }

  const nextHistory = [
    hydratedEntry,
    {
      ...hydratedEntry,
      source: "pwd",
    },
  ];
  const synchronized = synchronizePaneCommandHistory(runtimes, nextHistory);

  for (const pane of paneLeaves(workspace.tree)) {
    assert.equal(stateFor(synchronized, pane.id).commandHistory, nextHistory);
  }
});

test("validates, bounds, and parses replacement browser history records", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string): string | null => values.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      values.set(key, value);
    },
  };
  const entry: CommandHistoryEntry = {
    source: "echo 0",
    currentDirectory: virtualHomeDirectory(),
    persistence: { kind: "persistent" },
  };
  const written = writeCommandHistory(
    storage,
    Array.from({ length: 101 }, (_, index) => ({
      ...entry,
      source: `echo ${index}`,
    })),
  );
  const hydrated = readCommandHistory(storage, demoContentCorpus.filesystem);
  const replacement = commandHistoryFromStoredValue(
    JSON.stringify({
      version: 1,
      entries: [{ source: "echo remote", currentDirectory: "~" }],
    }),
    demoContentCorpus.filesystem,
  );

  assert.equal(written.kind, "available");
  assert.equal(hydrated.kind, "available");
  assert.equal(hydrated.entries.length, 100);
  assert.equal(hydrated.entries[0]?.source, "echo 1");
  assert.deepEqual(
    replacement.entries.map((candidate) => candidate.source),
    ["echo remote"],
  );
  assert.equal(
    commandHistoryFromStoredValue("{", demoContentCorpus.filesystem).kind,
    "unavailable",
  );
  assert.equal(
    commandHistoryFromStoredValue(
      JSON.stringify({ version: 2, entries: [] }),
      demoContentCorpus.filesystem,
    ).kind,
    "unavailable",
  );
  assert.equal(
    commandHistoryFromStoredValue(
      "x".repeat(128 * 1024 + 1),
      demoContentCorpus.filesystem,
    ).kind,
    "unavailable",
  );
});

test("clear, credential exclusion, and storage failures keep memory functional", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string): string | null => values.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      values.set(key, value);
    },
  };
  const secretSource = "credential-command private-token";
  const entries: ReadonlyArray<CommandHistoryEntry> = [
    {
      source: "echo public",
      currentDirectory: virtualHomeDirectory(),
      persistence: { kind: "persistent" },
    },
    {
      source: secretSource,
      currentDirectory: virtualHomeDirectory(),
      persistence: {
        kind: "memory-only",
        reason: "credential-arguments",
      },
    },
  ];
  const persisted = writeCommandHistory(storage, entries);
  const stored = values.get(commandHistoryStorageKey) ?? "";
  const cleared = writeCommandHistory(storage, []);
  const blocked = readCommandHistory(
    {
      getItem: () => {
        throw new Error(secretSource);
      },
      setItem: () => undefined,
    },
    demoContentCorpus.filesystem,
  );
  const quotaSecret = "quota-private-payload";
  const quotaFailed = writeCommandHistory(
    {
      getItem: () => null,
      setItem: () => {
        throw new Error(quotaSecret);
      },
    },
    entries,
  );

  assert.equal(persisted.kind, "available");
  assert.equal(stored, JSON.stringify({
    version: 1,
    entries: [{ source: "echo public", currentDirectory: "~" }],
  }));
  assert.equal(cleared.kind, "available");
  assert.equal(
    values.get(commandHistoryStorageKey),
    JSON.stringify({ version: 1, entries: [] }),
  );
  assert.equal(blocked.kind, "unavailable");
  assert.equal(quotaFailed.kind, "unavailable");
  assert.equal(quotaFailed.entries, entries);
  if (blocked.kind === "unavailable" && quotaFailed.kind === "unavailable") {
    assert.equal(blocked.diagnostic.includes(secretSource), false);
    assert.equal(quotaFailed.diagnostic.includes(quotaSecret), false);
  }
});

function projectsDirectoryPath() {
  const resolution = resolveVirtualDirectory(
    demoContentCorpus.filesystem,
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
  const withInput = reducePaneShellRuntime({
    runtimes,
    paneId,
    action: { kind: "input.insert", text: "cd projects" },
  });
  const submitted = reducePaneShellRuntime({
    runtimes: withInput,
    paneId,
    action: {
      kind: "prompt.submit",
      submission: {
        kind: "command",
        persistence: { kind: "persistent" },
      },
    },
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
        events: [
          {
            kind: "effect",
            effect: {
              kind: "set-current-directory",
              directory: projectsDirectoryPath(),
            },
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
    action: {
      kind: "prompt.submit",
      submission: {
        kind: "command",
        persistence: { kind: "persistent" },
      },
    },
  });
}

function successfulCommandOutcome(): CommandLineOutcome {
  return { kind: "succeeded", events: [] };
}

function viewerCommandOutcome(
  viewer: ViewerContent,
  disposition: "inline" | "split",
): CommandLineOutcome {
  return {
    kind: "succeeded",
    events: [
      {
        kind: "effect",
        effect: {
          kind: "open-viewer",
          viewer,
          disposition:
            disposition === "inline"
              ? { kind: "inline" }
              : { kind: "split", orientation: "vertical" },
        },
      },
    ],
  };
}

function contentId(value: string): ContentId {
  const validation = ContentId.tryCreate(value, "pane runtime test content");

  if (validation.kind === "invalid") {
    assert.fail(validation.message);
  }

  return validation.value;
}

function deferredCommandOutcome(): Readonly<{
  promise: Promise<CommandLineOutcome>;
  resolve: (outcome: CommandLineOutcome) => void;
}> {
  let resolveOutcome: (outcome: CommandLineOutcome) => void = () => {
    throw new Error("Deferred command outcomes must initialize their resolver.");
  };
  const promise = new Promise<CommandLineOutcome>((resolve) => {
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
    commandHistory: [],
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
  assert.equal(stateFor(runtimes, firstPaneId).input.text, "first input");
  assert.equal(stateFor(runtimes, secondPaneId).input.text, "second input");
  assert.equal(stateFor(runtimes, thirdPaneId).input.text, "third input");
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
  assert.equal(stateFor(runtimes, firstPaneId).input.text, "first input");
  assert.equal(stateFor(runtimes, thirdPaneId).input.text, "third input");
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
    commandHistory: [],
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

  assert.equal(stateFor(runtimes, firstPane.id).input.text, "first pane input");
  assert.equal(stateFor(runtimes, secondPane.id).input.text, "second pane input");
});

test("preserves runtime controls across transforms and disposes them when a pane closes", () => {
  let workspace = createPaneWorkspace({
    initialContent: createShellPaneContent(),
  });
  let runtimes = createPaneShellRuntimes({
    workspace,
    currentDirectory: virtualHomeDirectory(),
    commandHistory: [],
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
  assert.equal(
    secondRuntime.control.finishCommand(
      running.lifecycle.command.id,
      commandController,
      successfulCommandOutcome(),
    ),
    false,
  );
  assert.equal(secondRuntime.control.finishCompletion(completionController), false);
});

test("cancels the original command after its pane moves and rejects a late result", () => {
  let workspace = createPaneWorkspace({
    initialContent: createShellPaneContent(),
  });
  let runtimes = createPaneShellRuntimes({
    workspace,
    currentDirectory: virtualHomeDirectory(),
    commandHistory: [],
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

test("returns an asynchronous raw pager to its moved shell runtime", async () => {
  let workspace = createPaneWorkspace({
    initialContent: createShellPaneContent(),
  });
  let runtimes = createPaneShellRuntimes({
    workspace,
    currentDirectory: virtualHomeDirectory(),
    commandHistory: [],
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
  const viewer = createDocumentViewerContent({
    title: "Raw pager",
    presentation: "raw-pager",
    document: {
      text: "one\ntwo\nthree",
      source: { path: "~/notes/raw.txt" },
    },
    statsIdentity: { kind: "uncounted" },
  });

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

  const returned = closePaneShellPresentation(presentedRuntimes, originPaneId);

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
    commandHistory: [],
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

test("reports countable IDs only when inline and split document opens settle successfully", () => {
  const createRunning = (): Readonly<{
    workspace: PaneWorkspace;
    runtimes: PaneShellRuntimes;
    paneId: PaneId;
    commandId: Extract<ShellState["lifecycle"], { kind: "running" }>["command"]["id"];
  }> => {
    const workspace = createPaneWorkspace({
      initialContent: createShellPaneContent(),
    });
    const paneId = workspace.activePaneId;
    const runtimes = submitRunningCommand(
      createPaneShellRuntimes({
        workspace,
        currentDirectory: virtualHomeDirectory(),
        commandHistory: [],
      }),
      paneId,
    );
    const state = stateFor(runtimes, paneId);

    if (state.lifecycle.kind !== "running") {
      assert.fail("Expected a running command.");
    }

    return { workspace, runtimes, paneId, commandId: state.lifecycle.command.id };
  };
  const aboutId = contentId("about");
  const viewer = createDocumentViewerContent({
    title: "About",
    presentation: "inline",
    document: { text: "# About", source: { path: "~/about.md" } },
    statsIdentity: { kind: "countable", contentId: aboutId },
  });
  const inline = createRunning();
  const inlineResult = applyPaneShellAction({
    workspace: inline.workspace,
    runtimes: inline.runtimes,
    paneId: inline.paneId,
    action: {
      kind: "command.settled",
      commandId: inline.commandId,
      outcome: viewerCommandOutcome(viewer, "inline"),
    },
  });
  const split = createRunning();
  const splitResult = applyPaneShellAction({
    workspace: split.workspace,
    runtimes: split.runtimes,
    paneId: split.paneId,
    action: {
      kind: "command.settled",
      commandId: split.commandId,
      outcome: viewerCommandOutcome(viewer, "split"),
    },
  });

  assert.deepEqual(inlineResult.acceptedContentIds, [aboutId]);
  assert.deepEqual(splitResult.acceptedContentIds, [aboutId]);
});

test("does not report collection roots, uncounted viewers, failed commands, or cancelled commands", () => {
  const workspace = createPaneWorkspace({
    initialContent: createShellPaneContent(),
  });
  const paneId = workspace.activePaneId;
  const initial = createPaneShellRuntimes({
    workspace,
    currentDirectory: virtualHomeDirectory(),
    commandHistory: [],
  });
  const submitted = submitRunningCommand(initial, paneId);
  const running = stateFor(submitted, paneId);

  if (running.lifecycle.kind !== "running") {
    assert.fail("Expected a running command.");
  }

  const collection = createCollectionViewerContent({
    title: "Projects",
    emptyMessage: "No projects.",
    roots: [],
  });
  const collectionResult = applyPaneShellAction({
    workspace,
    runtimes: submitted,
    paneId,
    action: {
      kind: "command.settled",
      commandId: running.lifecycle.command.id,
      outcome: viewerCommandOutcome(collection, "inline"),
    },
  });
  const nextSubmitted = submitRunningCommand(collectionResult.runtimes, paneId);
  const nextRunning = stateFor(nextSubmitted, paneId);

  if (nextRunning.lifecycle.kind !== "running") {
    assert.fail("Expected a second running command.");
  }

  const uncounted = createDocumentViewerContent({
    title: "Synthetic",
    presentation: "raw-pager",
    document: { text: "synthetic", source: { path: "synthetic" } },
    statsIdentity: { kind: "uncounted" },
  });
  const uncountedResult = applyPaneShellAction({
    workspace: collectionResult.workspace,
    runtimes: nextSubmitted,
    paneId,
    action: {
      kind: "command.settled",
      commandId: nextRunning.lifecycle.command.id,
      outcome: viewerCommandOutcome(uncounted, "inline"),
    },
  });

  assert.deepEqual(collectionResult.acceptedContentIds, []);
  assert.deepEqual(uncountedResult.acceptedContentIds, []);

  const staleFailure = applyPaneShellAction({
    workspace: uncountedResult.workspace,
    runtimes: uncountedResult.runtimes,
    paneId,
    action: {
      kind: "command.settled",
      commandId: nextRunning.lifecycle.command.id,
      outcome: {
        kind: "failed",
        failure: {
          kind: "command-rejected",
          commandName: "open",
          message: "failed",
        },
        events: [],
      },
    },
  });
  const staleCancellation = applyPaneShellAction({
    workspace: uncountedResult.workspace,
    runtimes: uncountedResult.runtimes,
    paneId,
    action: {
      kind: "command.settled",
      commandId: nextRunning.lifecycle.command.id,
      outcome: {
        kind: "cancelled",
        events: [],
      },
    },
  });

  assert.deepEqual(staleFailure.acceptedContentIds, []);
  assert.deepEqual(staleCancellation.acceptedContentIds, []);
});
