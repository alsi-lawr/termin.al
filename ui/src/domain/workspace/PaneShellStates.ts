import type { VirtualDirectoryPath } from "../filesystem/VirtualFilesystem.ts";
import {
  createShellId,
  createShellSessionId,
  createShellState,
  reduceShellState,
  type ShellAction,
  type ShellState,
} from "../terminal/Shell.ts";
import { paneLeaves, type PaneId, type PaneWorkspace } from "./PaneTree.ts";

export type PaneShellStates = ReadonlyMap<PaneId, ShellState>;

export type CreatePaneShellStatesOptions = Readonly<{
  workspace: PaneWorkspace;
  currentDirectory: VirtualDirectoryPath;
}>;

export type ReconcilePaneShellStatesOptions = Readonly<{
  states: PaneShellStates;
  workspace: PaneWorkspace;
  currentDirectory: VirtualDirectoryPath;
}>;

export type ReducePaneShellStateOptions = Readonly<{
  states: PaneShellStates;
  paneId: PaneId;
  action: ShellAction;
}>;

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

function hasSameEntries(
  first: PaneShellStates,
  second: PaneShellStates,
): boolean {
  if (first.size !== second.size) {
    return false;
  }

  for (const [paneId, state] of first) {
    if (second.get(paneId) !== state) {
      return false;
    }
  }

  return true;
}

export function createPaneShellStates({
  workspace,
  currentDirectory,
}: CreatePaneShellStatesOptions): PaneShellStates {
  return reconcilePaneShellStates({
    states: new Map<PaneId, ShellState>(),
    workspace,
    currentDirectory,
  });
}

export function reconcilePaneShellStates({
  states,
  workspace,
  currentDirectory,
}: ReconcilePaneShellStatesOptions): PaneShellStates {
  const nextStates = new Map<PaneId, ShellState>();

  for (const pane of paneLeaves(workspace.tree)) {
    if (pane.content.kind !== "shell") {
      continue;
    }

    const existingState = states.get(pane.id);
    nextStates.set(
      pane.id,
      existingState ?? createPaneShellState(pane.id, currentDirectory),
    );
  }

  return hasSameEntries(states, nextStates) ? states : nextStates;
}

export function hasPaneShellState(
  states: PaneShellStates,
  paneId: PaneId,
): boolean {
  return states.has(paneId);
}

export function paneShellState(
  states: PaneShellStates,
  paneId: PaneId,
): ShellState {
  const state = states.get(paneId);

  if (state === undefined) {
    throw new Error("Shell panes must own a shell state.");
  }

  return state;
}

export function reducePaneShellState({
  states,
  paneId,
  action,
}: ReducePaneShellStateOptions): PaneShellStates {
  const state = states.get(paneId);

  if (state === undefined) {
    return states;
  }

  const nextState = reduceShellState(state, action);

  if (nextState === state) {
    return states;
  }

  const nextStates = new Map(states);
  nextStates.set(paneId, nextState);
  return nextStates;
}
