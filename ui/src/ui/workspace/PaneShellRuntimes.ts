import type { VirtualDirectoryPath } from "../../domain/filesystem/VirtualFilesystem.ts";
import {
  createShellId,
  createShellSessionId,
  createShellState,
  reduceShellState,
  type CommandId,
  type CommandOutcome,
  type ShellAction,
  type ShellState,
} from "../../domain/terminal/Shell.ts";
import {
  paneLeaves,
  type PaneId,
  type PaneWorkspace,
} from "../../domain/workspace/PaneTree.ts";

export type PaneShellRuntimeControl = Readonly<{
  startCommand: (commandId: CommandId) => AbortController | undefined;
  abortCommand: (commandId: CommandId) => void;
  finishCommand: (
    commandId: CommandId,
    controller: AbortController,
    outcome: CommandOutcome,
  ) => boolean;
  startCompletion: () => AbortController | undefined;
  finishCompletion: (controller: AbortController) => boolean;
  dispose: () => void;
}>;

export type PaneShellRuntime = Readonly<{
  state: ShellState;
  control: PaneShellRuntimeControl;
}>;

export type PaneShellRuntimes = ReadonlyMap<PaneId, PaneShellRuntime>;

export type CreatePaneShellRuntimesOptions = Readonly<{
  workspace: PaneWorkspace;
  currentDirectory: VirtualDirectoryPath;
}>;

export type ReconcilePaneShellRuntimesOptions = Readonly<{
  runtimes: PaneShellRuntimes;
  workspace: PaneWorkspace;
  currentDirectory: VirtualDirectoryPath;
}>;

export type ReducePaneShellRuntimeOptions = Readonly<{
  runtimes: PaneShellRuntimes;
  paneId: PaneId;
  action: ShellAction;
}>;

type ActiveCommand = Readonly<{
  id: CommandId;
  controller: AbortController;
}>;

function createPaneShellRuntimeControl(): PaneShellRuntimeControl {
  let activeCommand: ActiveCommand | undefined;
  let activeCompletion: AbortController | undefined;
  let disposed = false;

  return {
    startCommand: (commandId: CommandId): AbortController | undefined => {
      if (disposed || activeCommand !== undefined) {
        return undefined;
      }

      const controller = new AbortController();
      activeCommand = { id: commandId, controller };
      return controller;
    },
    abortCommand: (commandId: CommandId): void => {
      if (activeCommand?.id === commandId) {
        activeCommand.controller.abort();
      }
    },
    finishCommand: (
      commandId: CommandId,
      controller: AbortController,
      outcome: CommandOutcome,
    ): boolean => {
      const command = activeCommand;

      if (
        disposed ||
        command === undefined ||
        command.id !== commandId ||
        command.controller !== controller
      ) {
        return false;
      }

      activeCommand = undefined;
      return !controller.signal.aborted || outcome.kind === "cancelled";
    },
    startCompletion: (): AbortController | undefined => {
      if (disposed) {
        return undefined;
      }

      activeCompletion?.abort();
      const controller = new AbortController();
      activeCompletion = controller;
      return controller;
    },
    finishCompletion: (controller: AbortController): boolean => {
      if (
        disposed ||
        activeCompletion !== controller ||
        controller.signal.aborted
      ) {
        return false;
      }

      activeCompletion = undefined;
      return true;
    },
    dispose: (): void => {
      if (disposed) {
        return;
      }

      disposed = true;
      activeCommand?.controller.abort();
      activeCommand = undefined;
      activeCompletion?.abort();
      activeCompletion = undefined;
    },
  };
}

function createPaneShellState(
  paneId: PaneId,
  currentDirectory: VirtualDirectoryPath,
): ShellState {
  return createShellState({
    id: createShellId("shell-" + paneId),
    sessionId: createShellSessionId("browser-" + paneId),
    currentDirectory,
    scrollbackLimit: 200,
    commandHistoryLimit: 100,
  });
}

function createPaneShellRuntime(
  paneId: PaneId,
  currentDirectory: VirtualDirectoryPath,
): PaneShellRuntime {
  return {
    state: createPaneShellState(paneId, currentDirectory),
    control: createPaneShellRuntimeControl(),
  };
}

function hasSameEntries(
  first: PaneShellRuntimes,
  second: PaneShellRuntimes,
): boolean {
  if (first.size !== second.size) {
    return false;
  }

  for (const [paneId, runtime] of first) {
    if (second.get(paneId) !== runtime) {
      return false;
    }
  }

  return true;
}

export function createPaneShellRuntimes({
  workspace,
  currentDirectory,
}: CreatePaneShellRuntimesOptions): PaneShellRuntimes {
  return reconcilePaneShellRuntimes({
    runtimes: new Map<PaneId, PaneShellRuntime>(),
    workspace,
    currentDirectory,
  });
}

export function reconcilePaneShellRuntimes({
  runtimes,
  workspace,
  currentDirectory,
}: ReconcilePaneShellRuntimesOptions): PaneShellRuntimes {
  const nextRuntimes = new Map<PaneId, PaneShellRuntime>();

  for (const pane of paneLeaves(workspace.tree)) {
    if (pane.content.kind !== "shell") {
      continue;
    }

    const existingRuntime = runtimes.get(pane.id);
    nextRuntimes.set(
      pane.id,
      existingRuntime ?? createPaneShellRuntime(pane.id, currentDirectory),
    );
  }

  if (hasSameEntries(runtimes, nextRuntimes)) {
    return runtimes;
  }

  for (const [paneId, runtime] of runtimes) {
    if (!nextRuntimes.has(paneId)) {
      runtime.control.dispose();
    }
  }

  return nextRuntimes;
}

export function disposePaneShellRuntimes(
  runtimes: PaneShellRuntimes,
): void {
  for (const runtime of runtimes.values()) {
    runtime.control.dispose();
  }
}

export function hasPaneShellRuntime(
  runtimes: PaneShellRuntimes,
  paneId: PaneId,
): boolean {
  return runtimes.has(paneId);
}

export function paneShellRuntime(
  runtimes: PaneShellRuntimes,
  paneId: PaneId,
): PaneShellRuntime {
  const runtime = runtimes.get(paneId);

  if (runtime === undefined) {
    throw new Error("Shell panes must own a shell runtime.");
  }

  return runtime;
}

export function reducePaneShellRuntime({
  runtimes,
  paneId,
  action,
}: ReducePaneShellRuntimeOptions): PaneShellRuntimes {
  const runtime = runtimes.get(paneId);

  if (runtime === undefined) {
    return runtimes;
  }

  const nextState = reduceShellState(runtime.state, action);

  if (nextState === runtime.state) {
    return runtimes;
  }

  const nextRuntimes = new Map(runtimes);
  nextRuntimes.set(paneId, { ...runtime, state: nextState });
  return nextRuntimes;
}
