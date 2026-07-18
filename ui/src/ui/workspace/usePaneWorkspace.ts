import { useCallback, useEffect, useRef, useState } from "react";
import type { ContentCorpus } from "../../api/ContentClient.ts";
import type { ContentId } from "../../api/ContentContracts.ts";
import type {
  CommandHistoryEntry,
  ShellAction,
} from "../../domain/terminal/Shell.ts";
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
  hasPaneShellRuntime,
  reconcilePaneShellRuntimes,
  synchronizePaneCommandHistory,
  type PaneShellRuntimes,
} from "./PaneShellRuntimes.ts";
import {
  clearPersistedCommandHistory,
  commandHistoryFromStoredValue,
  commandHistoryStorageKey,
  mergeCommandHistory,
  persistCommandHistory,
  readCommandHistory,
  type CommandHistoryStorageBackend,
  type CommandHistoryStorageResult,
} from "./CommandHistoryStorage.ts";
import {
  applyPaneKeyInput,
  initialPanePrefixState,
  type PanePrefixState,
} from "../../domain/workspace/PaneKeyBindings.ts";
import {
  consumeMobileCtrlModifier,
  initialMobileCtrlModifier,
  toggleMobileCtrlModifier,
  type MobileCtrlInputResolution,
  type MobileCtrlModifier,
} from "./MobileCtrlModifier.ts";
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
  mobileCtrlPressed: boolean;
  applyOperation: (operation: PaneOperation) => PaneOperationResult;
  onShellAction: (paneId: PaneId, action: ShellAction) => void;
  onCloseInlineViewer: (paneId: PaneId) => void;
  hasShellRuntime: (paneId: PaneId) => boolean;
  onPaneKeyInput: (
    input: InputCapturePaneKeyInput,
  ) => InputCapturePaneKeyResult;
  onToggleMobileCtrl: () => void;
  onConsumeMobileCtrl: () => void;
  resolveMobileCtrlInput: (
    input: InputCapturePaneKeyInput,
  ) => MobileCtrlInputResolution;
  confirmClose: () => void;
  dismissClose: () => void;
}>;

function browserCommandHistoryStorage(): CommandHistoryStorageBackend | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function sharedCommandHistory(
  runtimes: PaneShellRuntimes,
): ReadonlyArray<CommandHistoryEntry> {
  return runtimes.values().next().value?.state.commandHistory ?? [];
}

function paneCommandHistory(
  runtimes: PaneShellRuntimes,
  paneId: PaneId,
): ReadonlyArray<CommandHistoryEntry> {
  return runtimes.get(paneId)?.state.commandHistory ??
    sharedCommandHistory(runtimes);
}

function clearsCommandHistory(action: ShellAction): boolean {
  return action.kind === "command.settled" && action.outcome.events.some(
    (event) =>
      event.kind === "effect" && event.effect.kind === "clear-command-history",
  );
}

export function usePaneWorkspace(
  corpus: ContentCorpus,
  onAcceptedContentOpen: (contentId: ContentId) => void,
): PaneWorkspaceController {
  const currentDirectory = corpus.filesystem.root.path;
  const [historyStorage] = useState<CommandHistoryStorageBackend | undefined>(
    browserCommandHistoryStorage,
  );
  const [hydratedHistory] = useState<CommandHistoryStorageResult>(() =>
    readCommandHistory(historyStorage, corpus.filesystem)
  );
  const initialCommandHistory = hydratedHistory.kind === "available"
    ? hydratedHistory.entries
    : [];
  const [workspace, setWorkspace] = useState<PaneWorkspace>(() =>
    createPaneWorkspace({ initialContent: createShellPaneContent() }),
  );
  const [shellRuntimes, setShellRuntimes] = useState<PaneShellRuntimes>(() =>
    createPaneShellRuntimes({
      workspace,
      currentDirectory,
      commandHistory: initialCommandHistory,
    }),
  );
  const [focusVersion, setFocusVersion] = useState(0);
  const [closeConfirmation, setCloseConfirmation] =
    useState<PaneCloseConfirmation>({ kind: "none" });
  const [mobileCtrlModifier, setMobileCtrlModifier] =
    useState<MobileCtrlModifier>(initialMobileCtrlModifier);
  const workspaceRef = useRef(workspace);
  const shellRuntimesRef = useRef(shellRuntimes);
  const prefixState = useRef<PanePrefixState>(initialPanePrefixState);
  const mobileCtrlModifierRef = useRef<MobileCtrlModifier>(
    initialMobileCtrlModifier,
  );
  const storageFailureReported = useRef(false);

  const reportStorageFailure = useCallback(
    (result: CommandHistoryStorageResult): void => {
      if (result.kind === "available" || storageFailureReported.current) {
        return;
      }

      storageFailureReported.current = true;
      console.warn(result.diagnostic);
    },
    [],
  );

  useEffect(() => {
    reportStorageFailure(hydratedHistory);
  }, [hydratedHistory, reportStorageFailure]);

  useEffect(() => {
    const receiveStoredHistory = (event: StorageEvent): void => {
      if (event.key !== commandHistoryStorageKey) {
        return;
      }

      const received = commandHistoryFromStoredValue(
        event.newValue,
        corpus.filesystem,
      );

      if (received.kind === "unavailable") {
        reportStorageFailure(received);
        return;
      }

      const currentRuntimes = shellRuntimesRef.current;
      let commandHistory = event.newValue === null || received.entries.length === 0
        ? []
        : mergeCommandHistory(
            sharedCommandHistory(currentRuntimes),
            received.entries,
          );

      if (commandHistory.length > 0) {
        const persisted = persistCommandHistory(
          historyStorage,
          corpus.filesystem,
          commandHistory,
        );
        reportStorageFailure(persisted);
        if (persisted.kind === "available") {
          commandHistory = mergeCommandHistory(
            commandHistory,
            persisted.entries,
          );
        }
      }
      const nextRuntimes = synchronizePaneCommandHistory(
        currentRuntimes,
        commandHistory,
      );

      if (nextRuntimes !== currentRuntimes) {
        shellRuntimesRef.current = nextRuntimes;
        setShellRuntimes(nextRuntimes);
      }
    };

    window.addEventListener("storage", receiveStoredHistory);
    return () => window.removeEventListener("storage", receiveStoredHistory);
  }, [corpus.filesystem, historyStorage, reportStorageFailure]);

  const setMobileCtrl = useCallback((modifier: MobileCtrlModifier): void => {
    mobileCtrlModifierRef.current = modifier;
    setMobileCtrlModifier(modifier);
  }, []);

  const onToggleMobileCtrl = useCallback((): void => {
    setMobileCtrl(toggleMobileCtrlModifier(mobileCtrlModifierRef.current));
  }, [setMobileCtrl]);

  const onConsumeMobileCtrl = useCallback((): void => {
    if (mobileCtrlModifierRef.current.kind === "armed") {
      setMobileCtrl(initialMobileCtrlModifier);
    }
  }, [setMobileCtrl]);

  const resolveMobileCtrlInput = useCallback(
    (input: InputCapturePaneKeyInput): MobileCtrlInputResolution => {
      const transition = consumeMobileCtrlModifier(
        mobileCtrlModifierRef.current,
        input,
      );

      if (transition.resolution.mobileCtrlApplied) {
        setMobileCtrl(transition.modifier);
      }

      return transition.resolution;
    },
    [setMobileCtrl],
  );

  const applyOperation = useCallback(
    (operation: PaneOperation): PaneOperationResult => {
      const currentWorkspace = workspaceRef.current;
      const result = applyPaneOperation(currentWorkspace, operation);

      if (result.kind === "applied") {
        if (result.workspace === currentWorkspace) {
          return result;
        }

        const currentShellRuntimes = shellRuntimesRef.current;
        const nextShellRuntimes = reconcilePaneShellRuntimes({
          runtimes: currentShellRuntimes,
          workspace: result.workspace,
          currentDirectory,
          commandHistory: sharedCommandHistory(currentShellRuntimes),
        });
        workspaceRef.current = result.workspace;
        shellRuntimesRef.current = nextShellRuntimes;
        setWorkspace(result.workspace);
        if (result.workspace.activePaneId !== currentWorkspace.activePaneId) {
          onConsumeMobileCtrl();
        }
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
    [currentDirectory, onConsumeMobileCtrl],
  );

  const onShellAction = useCallback(
    (paneId: PaneId, action: ShellAction): void => {
      const currentWorkspace = workspaceRef.current;
      const currentShellRuntimes = shellRuntimesRef.current;
      const applied = applyPaneShellAction({
        workspace: currentWorkspace,
        runtimes: currentShellRuntimes,
        paneId,
        action,
      });

      let nextRuntimes = applied.runtimes;
      const previousCommandHistory = paneCommandHistory(
        currentShellRuntimes,
        paneId,
      );
      const reducedCommandHistory = paneCommandHistory(nextRuntimes, paneId);

      if (clearsCommandHistory(action)) {
        reportStorageFailure(clearPersistedCommandHistory(historyStorage));
        nextRuntimes = synchronizePaneCommandHistory(nextRuntimes, []);
      } else if (reducedCommandHistory !== previousCommandHistory) {
        let commandHistory = reducedCommandHistory;

        if (
          action.kind === "prompt.submit" &&
          action.submission.kind === "command" &&
          action.submission.persistence.kind === "persistent"
        ) {
          const persisted = persistCommandHistory(
            historyStorage,
            corpus.filesystem,
            reducedCommandHistory,
          );
          reportStorageFailure(persisted);
          if (persisted.kind === "available") {
            commandHistory = mergeCommandHistory(
              reducedCommandHistory,
              persisted.entries,
            );
          }
        }

        nextRuntimes = synchronizePaneCommandHistory(
          nextRuntimes,
          commandHistory,
        );
      }

      const next = { ...applied, runtimes: nextRuntimes };

      for (const contentId of next.acceptedContentIds) {
        onAcceptedContentOpen(contentId);
      }

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
        if (next.workspace.activePaneId !== currentWorkspace.activePaneId) {
          onConsumeMobileCtrl();
        }
        setFocusVersion((current) => current + 1);
      }
      if (next.runtimes !== currentShellRuntimes) {
        setShellRuntimes(next.runtimes);
      }
    },
    [
      corpus.filesystem,
      historyStorage,
      onAcceptedContentOpen,
      onConsumeMobileCtrl,
      reportStorageFailure,
    ],
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
    mobileCtrlPressed: mobileCtrlModifier.kind === "armed",
    applyOperation,
    onShellAction,
    onCloseInlineViewer,
    hasShellRuntime,
    onPaneKeyInput,
    onToggleMobileCtrl,
    onConsumeMobileCtrl,
    resolveMobileCtrlInput,
    confirmClose,
    dismissClose,
  };
}
