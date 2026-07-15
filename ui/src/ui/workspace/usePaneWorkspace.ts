import { useCallback, useRef, useState } from "react";
import { developmentFixtureCorpus } from "../../content/DevelopmentFixtureCorpus.ts";
import type { ShellAction } from "../../domain/terminal/Shell.ts";
import {
  applyPaneOperation,
  createPaneWorkspace,
  createShellPaneContent,
  type Pane,
  type PaneId,
  type PaneOperation,
  type PaneOperationResult,
  type PaneWorkspace,
} from "../../domain/workspace/PaneTree.ts";
import {
  createPaneShellStates,
  hasPaneShellState,
  reconcilePaneShellStates,
  reducePaneShellState,
  type PaneShellStates,
} from "../../domain/workspace/PaneShellStates.ts";
import {
  applyPaneKeyInput,
  initialPanePrefixState,
  type PanePrefixState,
} from "../../domain/workspace/PaneKeyBindings.ts";
import type {
  InputCapturePaneKeyInput,
  InputCapturePaneKeyResult,
} from "../terminal/InputCapture";

export type PaneCloseConfirmation =
  | Readonly<{ kind: "none" }>
  | Readonly<{
      kind: "requested";
      pane: Pane;
    }>;

export type PaneWorkspaceController = Readonly<{
  workspace: PaneWorkspace;
  shellStates: PaneShellStates;
  focusVersion: number;
  closeConfirmation: PaneCloseConfirmation;
  applyOperation: (operation: PaneOperation) => PaneOperationResult;
  onShellAction: (paneId: PaneId, action: ShellAction) => void;
  hasShellState: (paneId: PaneId) => boolean;
  onPaneKeyInput: (
    input: InputCapturePaneKeyInput,
  ) => InputCapturePaneKeyResult;
  confirmClose: () => void;
  dismissClose: () => void;
}>;

export function usePaneWorkspace(): PaneWorkspaceController {
  const [workspace, setWorkspace] = useState<PaneWorkspace>(() =>
    createPaneWorkspace({ initialContent: createShellPaneContent() }),
  );
  const [shellStates, setShellStates] = useState<PaneShellStates>(() =>
    createPaneShellStates({
      workspace,
      currentDirectory: developmentFixtureCorpus.filesystem.root.path,
    }),
  );
  const [focusVersion, setFocusVersion] = useState(0);
  const [closeConfirmation, setCloseConfirmation] =
    useState<PaneCloseConfirmation>({ kind: "none" });
  const workspaceRef = useRef(workspace);
  const shellStatesRef = useRef(shellStates);
  const prefixState = useRef<PanePrefixState>(initialPanePrefixState);

  const applyOperation = useCallback(
    (operation: PaneOperation): PaneOperationResult => {
      const result = applyPaneOperation(workspaceRef.current, operation);

      if (result.kind === "applied") {
        if (result.workspace === workspaceRef.current) {
          return result;
        }

        const currentShellStates = shellStatesRef.current;
        const nextShellStates = reconcilePaneShellStates({
          states: currentShellStates,
          workspace: result.workspace,
          currentDirectory: developmentFixtureCorpus.filesystem.root.path,
        });
        workspaceRef.current = result.workspace;
        shellStatesRef.current = nextShellStates;
        setWorkspace(result.workspace);
        if (nextShellStates !== currentShellStates) {
          setShellStates(nextShellStates);
        }
        setFocusVersion((current) => current + 1);
        return result;
      }

      if (result.kind === "confirmation-required") {
        setCloseConfirmation({
          kind: "requested",
          pane: result.pane,
        });
      }

      return result;
    },
    [],
  );

  const onShellAction = useCallback(
    (paneId: PaneId, action: ShellAction): void => {
      const nextShellStates = reducePaneShellState({
        states: shellStatesRef.current,
        paneId,
        action,
      });

      if (nextShellStates === shellStatesRef.current) {
        return;
      }

      shellStatesRef.current = nextShellStates;
      setShellStates(nextShellStates);
    },
    [],
  );

  const hasShellState = useCallback(
    (paneId: PaneId): boolean =>
      hasPaneShellState(shellStatesRef.current, paneId),
    [],
  );

  const onPaneKeyInput = useCallback(
    (input: InputCapturePaneKeyInput): InputCapturePaneKeyResult => {
      const previousState = prefixState.current;
      const result = applyPaneKeyInput(previousState, input);
      prefixState.current = result.state;

      switch (result.kind) {
        case "operation":
          applyOperation(result.operation);
          return { kind: "handled" };
        case "prefix-entered":
        case "selection-pending":
          return { kind: "handled" };
        case "ignored":
          return previousState.kind === "idle"
            ? { kind: "unhandled" }
            : { kind: "handled" };
      }
    },
    [applyOperation],
  );

  const dismissClose = useCallback((): void => {
    setCloseConfirmation({ kind: "none" });
    setFocusVersion((current) => current + 1);
  }, []);

  const confirmClose = useCallback((): void => {
    if (closeConfirmation.kind === "none") {
      return;
    }

    if (workspaceRef.current.activePaneId !== closeConfirmation.pane.id) {
      dismissClose();
      return;
    }

    setCloseConfirmation({ kind: "none" });
    applyOperation({ kind: "confirm-close" });
  }, [applyOperation, closeConfirmation, dismissClose]);

  return {
    workspace,
    shellStates,
    focusVersion,
    closeConfirmation,
    applyOperation,
    onShellAction,
    hasShellState,
    onPaneKeyInput,
    confirmClose,
    dismissClose,
  };
}
