import { useCallback, useEffect, useRef, useState } from "react";
import type { ContentCorpus } from "../../api/ContentClient.ts";
import type { ApplicationMode } from "../../ApplicationComposition.ts";
import type { AuthenticationController } from "../../auth/Authentication.ts";
import type { PublicationClient } from "../../api/PublicationClient.ts";
import { AuthoringService } from "../../authoring/AuthoringService.ts";
import { IndexedDbDraftStore } from "../../authoring/DraftStore.ts";
import type { ContentId } from "../../api/ContentContracts.ts";
import {
  isCvViewerContent,
  type ViewerContent,
  type ViewerOpenDisposition,
} from "../../content/ViewerContent.ts";
import {
  createWorkspaceVirtualFilesystem,
  type VirtualFilesystem,
  type VirtualFilesystemOverlay,
} from "../../domain/filesystem/VirtualFilesystem.ts";
import type {
  CommandHistoryEntry,
  ShellAction,
} from "../../domain/terminal/Shell.ts";
import {
  applyPaneOperation,
  createPaneWorkspace,
  createShellPaneContent,
  createViewerPaneContent,
  paneLeaves,
  type Pane,
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
  reconcilePaneShellRuntimes,
  synchronizePaneCommandHistory,
  showPaneShellViewer,
  type PaneShellRuntimes,
} from "./PaneShellRuntimes.ts";
import {
  commandHistoryFromStoredValue,
  commandHistoryStorageKey,
  readCommandHistory,
  writeCommandHistory,
  type CommandHistoryStorageBackend,
  type CommandHistoryStorageResult,
} from "./CommandHistoryStorage.ts";
import {
  readVirtualFilesystemOverlay,
  replaceVirtualFilesystemFromStoredValue,
  virtualFilesystemStorageKey,
  writeVirtualFilesystemOverlay,
  type VirtualFilesystemStorageBackend,
  type VirtualFilesystemStorageResult,
} from "./VirtualFilesystemStorage.ts";
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
import {
  createVimSessionState,
  type VimSessionBinding,
  type VimSessionState,
} from "./VimSessionState.ts";
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
  vimSession: VimSessionBinding;
  filesystem: VirtualFilesystem;
  onFilesystemChange: (overlay: VirtualFilesystemOverlay) => void;
  applyOperation: (operation: PaneOperation) => PaneOperationResult;
  onShellAction: (paneId: PaneId, action: ShellAction) => void;
  onCloseShellPresentation: (
    paneId: PaneId,
    transientDiagnostic?: string,
  ) => void;
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
  openProtectedViewer: (
    paneId: PaneId,
    viewer: ViewerContent,
    disposition: ViewerOpenDisposition,
  ) => void;
  dropCvContent: () => void;
  authoring: AuthoringService | undefined;
}>;
function browserCommandHistoryStorage(): CommandHistoryStorageBackend | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
function browserVirtualFilesystemStorage(): VirtualFilesystemStorageBackend | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
function reportStorageFailure(result: CommandHistoryStorageResult): void {
  if (result.kind === "unavailable") {
    console.warn(result.diagnostic);
  }
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
  applicationMode: ApplicationMode,
  authentication: AuthenticationController,
  publicationClient: PublicationClient | undefined,
): PaneWorkspaceController {
  const currentDirectory = corpus.filesystem.root.path;
  const [authoring] = useState<AuthoringService | undefined>(() => {
    if (applicationMode === "demo" || publicationClient === undefined) return undefined;
    return new AuthoringService(corpus, authentication, new IndexedDbDraftStore(window.indexedDB), publicationClient);
  });
  const [filesystemStorage] = useState<VirtualFilesystemStorageBackend | undefined>(
    browserVirtualFilesystemStorage,
  );
  const [hydratedFilesystem] = useState<VirtualFilesystemStorageResult>(() =>
    readVirtualFilesystemOverlay(filesystemStorage, corpus.filesystem)
  );
  const [filesystem] = useState<VirtualFilesystem>(() =>
    createWorkspaceVirtualFilesystem(
      corpus.filesystem,
      hydratedFilesystem.overlay,
    )
  );
  const [, setFilesystemRevision] = useState(0);
  const [historyStorage] = useState<CommandHistoryStorageBackend | undefined>(
    browserCommandHistoryStorage,
  );
  const [hydratedHistory] = useState<CommandHistoryStorageResult>(() =>
    readCommandHistory(historyStorage, filesystem)
  );
  const [workspace, setWorkspace] = useState<PaneWorkspace>(() =>
    createPaneWorkspace({ initialContent: createShellPaneContent() }),
  );
  const [shellRuntimes, setShellRuntimes] = useState<PaneShellRuntimes>(() =>
    createPaneShellRuntimes({
      workspace,
      currentDirectory,
      commandHistory: hydratedHistory.entries,
    }),
  );
  const [focusVersion, setFocusVersion] = useState(0);
  const [vimSessionState, setVimSessionState] = useState(
    createVimSessionState,
  );
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
  const commandHistoryRef = useRef<ReadonlyArray<CommandHistoryEntry>>(
    hydratedHistory.entries,
  );
  const filesystemStorageFailureReported = useRef(false);
  const reportFilesystemStorageFailure = useCallback(
    (result: VirtualFilesystemStorageResult): void => {
      if (
        result.kind === "unavailable" &&
        !filesystemStorageFailureReported.current
      ) {
        filesystemStorageFailureReported.current = true;
        console.warn(result.diagnostic);
      }
    },
    [],
  );
  useEffect(() => {
    reportStorageFailure(hydratedHistory);
  }, [hydratedHistory]);
  useEffect(() => {
    reportFilesystemStorageFailure(hydratedFilesystem);
  }, [hydratedFilesystem, reportFilesystemStorageFailure]);
  useEffect(() => {
    const receiveStoredHistory = (event: StorageEvent): void => {
      if (event.key !== commandHistoryStorageKey) {
        return;
      }
      const received = commandHistoryFromStoredValue(
        event.newValue,
        filesystem,
      );
      reportStorageFailure(received);
      if (received.kind === "unavailable") {
        return;
      }
      const currentRuntimes = shellRuntimesRef.current;
      commandHistoryRef.current = received.entries;
      const nextRuntimes = synchronizePaneCommandHistory(
        currentRuntimes,
        received.entries,
      );
      if (nextRuntimes === currentRuntimes) {
        return;
      }
      shellRuntimesRef.current = nextRuntimes;
      setShellRuntimes(nextRuntimes);
    };
    window.addEventListener("storage", receiveStoredHistory);
    return () => window.removeEventListener("storage", receiveStoredHistory);
  }, [filesystem]);
  useEffect(() => {
    const receiveStoredFilesystem = (event: StorageEvent): void => {
      if (event.key !== virtualFilesystemStorageKey) {
        return;
      }

      const received = replaceVirtualFilesystemFromStoredValue(
        event.newValue,
        corpus.filesystem,
        filesystem,
        () => setFilesystemRevision((current) => current + 1),
      );
      reportFilesystemStorageFailure(received);
    };

    window.addEventListener("storage", receiveStoredFilesystem);
    return () => window.removeEventListener("storage", receiveStoredFilesystem);
  }, [corpus.filesystem, filesystem, reportFilesystemStorageFailure]);
  const onFilesystemChange = useCallback(
    (overlay: VirtualFilesystemOverlay): void => {
      reportFilesystemStorageFailure(
        writeVirtualFilesystemOverlay(filesystemStorage, overlay),
      );
      setFilesystemRevision((current) => current + 1);
    },
    [filesystemStorage, reportFilesystemStorageFailure],
  );
  const setMobileCtrl = useCallback((modifier: MobileCtrlModifier): void => {
    mobileCtrlModifierRef.current = modifier;
    setMobileCtrlModifier(modifier);
  }, []);

  const onVimSessionStateChange = useCallback((state: VimSessionState): void => {
    setVimSessionState(state);
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
          commandHistory: commandHistoryRef.current,
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
      let historyResult: CommandHistoryStorageResult | undefined;
      const previousCommandHistory = currentShellRuntimes.get(paneId)?.state
        .commandHistory ?? commandHistoryRef.current;
      const reducedCommandHistory = nextRuntimes.get(paneId)?.state.commandHistory ??
        previousCommandHistory;
      if (clearsCommandHistory(action)) {
        historyResult = writeCommandHistory(historyStorage, []);
      } else if (reducedCommandHistory !== previousCommandHistory) {
        historyResult = writeCommandHistory(historyStorage, reducedCommandHistory);
      }
      if (historyResult !== undefined) {
        reportStorageFailure(historyResult);
        commandHistoryRef.current = historyResult.entries;
        nextRuntimes = synchronizePaneCommandHistory(
          nextRuntimes,
          historyResult.entries,
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
      historyStorage,
      onAcceptedContentOpen,
      onConsumeMobileCtrl,
    ],
  );
  const onCloseShellPresentation = useCallback((
    paneId: PaneId,
    transientDiagnostic?: string,
  ): void => {
    const currentShellRuntimes = shellRuntimesRef.current;
    const nextShellRuntimes = closePaneShellPresentation(
      currentShellRuntimes,
      paneId,
      transientDiagnostic,
    );

    if (nextShellRuntimes === currentShellRuntimes) {
      return;
    }

    shellRuntimesRef.current = nextShellRuntimes;
    setShellRuntimes(nextShellRuntimes);
  }, []);

  const openProtectedViewer = useCallback((
    paneId: PaneId,
    viewer: ViewerContent,
    disposition: ViewerOpenDisposition,
  ): void => {
    if (disposition.kind === "split") {
      applyOperation({
        kind: "split",
        paneId,
        orientation: disposition.orientation,
        content: createViewerPaneContent(viewer),
      });
      return;
    }

    const current = shellRuntimesRef.current;
    const next = showPaneShellViewer(current, paneId, viewer);

    if (next !== current) {
      shellRuntimesRef.current = next;
      setShellRuntimes(next);
    }
  }, [applyOperation]);

  const dropCvContent = useCallback((): void => {
    let nextRuntimes = shellRuntimesRef.current;

    for (const [paneId, paneRuntime] of nextRuntimes) {
      if (
        paneRuntime.presentation.kind === "inline-viewer" &&
        isCvViewerContent(paneRuntime.presentation.viewer)
      ) {
        nextRuntimes = closePaneShellPresentation(nextRuntimes, paneId);
      }
    }

    if (nextRuntimes !== shellRuntimesRef.current) {
      shellRuntimesRef.current = nextRuntimes;
      setShellRuntimes(nextRuntimes);
    }

    const cvPaneIds = paneLeaves(workspaceRef.current.tree)
      .filter(
        (pane) =>
          pane.content.kind === "viewer" &&
          isCvViewerContent(pane.content.viewer),
      )
      .map((pane) => pane.id);

    for (const paneId of cvPaneIds) {
      applyOperation({ kind: "focus-pane", paneId });
      applyOperation({ kind: "close" });
    }
  }, [applyOperation]);

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
    vimSession: {
      state: vimSessionState,
      onStateChange: onVimSessionStateChange,
    },
    filesystem,
    onFilesystemChange,
    applyOperation,
    onShellAction,
    onCloseShellPresentation,
    hasShellRuntime,
    onPaneKeyInput,
    onToggleMobileCtrl,
    onConsumeMobileCtrl,
    resolveMobileCtrlInput,
    confirmClose,
    dismissClose,
    openProtectedViewer,
    dropCvContent,
    authoring,
  };
}
