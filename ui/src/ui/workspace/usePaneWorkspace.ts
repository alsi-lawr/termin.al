import { useCallback, useEffect, useRef, useState } from "react";
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
  applyPaneShellAction,
  closePaneShellViewer,
  createPaneShellRuntimes,
  disposePaneShellRuntimes,
  hasPaneShellRuntime,
  reconcilePaneShellRuntimes,
  type PaneShellRuntimes,
} from "./PaneShellRuntimes.ts";
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
  shellRuntimes: PaneShellRuntimes;
  focusVersion: number;
  closeConfirmation: PaneCloseConfirmation;
  applyOperation: (operation: PaneOperation) => PaneOperationResult;
  onShellAction: (paneId: PaneId, action: ShellAction) => void;
  onCloseInlineViewer: (paneId: PaneId) => void;
  hasShellRuntime: (paneId: PaneId) => boolean;
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
  const [shellRuntimes, setShellRuntimes] = useState<PaneShellRuntimes>(() =>
    createPaneShellRuntimes({
      workspace,
      currentDirectory: developmentFixtureCorpus.filesystem.root.path,
    }),
  );
  const [focusVersion, setFocusVersion] = useState(0);
  const [closeConfirmation, setCloseConfirmation] =
    useState<PaneCloseConfirmation>({ kind: "none" });
  const workspaceRef = useRef(workspace);
  const shellRuntimesRef = useRef(shellRuntimes);
  const prefixState = useRef<PanePrefixState>(initialPanePrefixState);

  useEffect(
    () => () => {
      disposePaneShellRuntimes(shellRuntimesRef.current);
    },
    [],
  );

  const applyOperation = useCallback(
    (operation: PaneOperation): PaneOperationResult => {
      const result = applyPaneOperation(workspaceRef.current, operation);

      if (result.kind === "applied") {
        if (result.workspace === workspaceRef.current) {
          return result;
        }

        const currentShellRuntimes = shellRuntimesRef.current;
        const nextShellRuntimes = reconcilePaneShellRuntimes({
          runtimes: currentShellRuntimes,
          workspace: result.workspace,
          currentDirectory: developmentFixtureCorpus.filesystem.root.path,
        });
        workspaceRef.current = result.workspace;
        shellRuntimesRef.current = nextShellRuntimes;
        setWorkspace(result.workspace);
        if (nextShellRuntimes !== currentShellRuntimes) {
          setShellRuntimes(nextShellRuntimes);
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
      const currentWorkspace = workspaceRef.current;
      const currentShellRuntimes = shellRuntimesRef.current;
      const next = applyPaneShellAction({
        workspace: currentWorkspace,
        runtimes: currentShellRuntimes,
        paneId,
        action,
      });

      if (
        next.workspace === currentWorkspace &&
        next.runtimes === currentShellRuntimes
      ) {
        return;
      }

      workspaceRef.current = next.workspace;
      shellRuntimesRef.current = next.runtimes;
      if (next.workspace !== currentWorkspace) {
        setWorkspace(next.workspace);
        setFocusVersion((current) => current + 1);
      }
      if (next.runtimes !== currentShellRuntimes) {
        setShellRuntimes(next.runtimes);
      }
    },
    [],
  );

  const onCloseInlineViewer = useCallback((paneId: PaneId): void => {
    const currentShellRuntimes = shellRuntimesRef.current;
    const nextShellRuntimes = closePaneShellViewer(
      currentShellRuntimes,
      paneId,
    );

    if (nextShellRuntimes === currentShellRuntimes) {
      return;
    }

    shellRuntimesRef.current = nextShellRuntimes;
    setShellRuntimes(nextShellRuntimes);
  }, []);

  const hasShellRuntime = useCallback(
    (paneId: PaneId): boolean =>
      hasPaneShellRuntime(shellRuntimesRef.current, paneId),
    [],
  );

  const onPaneKeyInput = useCallback(
    (input: InputCapturePaneKeyInput): InputCapturePaneKeyResult => {
      const previousState = prefixState.current;
      const result = applyPaneKeyInput(
        previousState,
        input,
        workspaceRef.current.activePaneId,
      );
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
    shellRuntimes,
    focusVersion,
    closeConfirmation,
    applyOperation,
    onShellAction,
    onCloseInlineViewer,
    hasShellRuntime,
    onPaneKeyInput,
    confirmClose,
    dismissClose,
  };
}
