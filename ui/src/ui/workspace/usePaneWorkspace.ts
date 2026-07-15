import { useCallback, useRef, useState } from "react";
import {
  applyPaneOperation,
  createPaneWorkspace,
  createShellPaneContent,
  type Pane,
  type PaneOperation,
  type PaneOperationResult,
  type PaneWorkspace,
} from "../../domain/workspace/PaneTree.ts";
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
  focusVersion: number;
  closeConfirmation: PaneCloseConfirmation;
  applyOperation: (operation: PaneOperation) => PaneOperationResult;
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
  const [focusVersion, setFocusVersion] = useState(0);
  const [closeConfirmation, setCloseConfirmation] =
    useState<PaneCloseConfirmation>({ kind: "none" });
  const workspaceRef = useRef(workspace);
  const prefixState = useRef<PanePrefixState>(initialPanePrefixState);

  const applyOperation = useCallback(
    (operation: PaneOperation): PaneOperationResult => {
      const result = applyPaneOperation(workspaceRef.current, operation);

      if (result.kind === "applied") {
        if (result.workspace === workspaceRef.current) {
          return result;
        }

        workspaceRef.current = result.workspace;
        setWorkspace(result.workspace);
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
    focusVersion,
    closeConfirmation,
    applyOperation,
    onPaneKeyInput,
    confirmClose,
    dismissClose,
  };
}
