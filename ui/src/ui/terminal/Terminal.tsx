import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactElement,
} from "react";
import {
  getActiveShellPrompt,
  getShellAutosuggestion,
  getShellStatus,
  type ShellAction,
  type ShellState,
} from "../../domain/terminal/Shell.ts";
import type { ProjectReadme } from "../../api/ContentClient.ts";
import type { ContentId } from "../../api/ContentContracts.ts";
import type {
  VirtualDocumentSupplier,
  VirtualFilesystem,
  VirtualFilesystemOverlay,
} from "../../domain/filesystem/VirtualFilesystem.ts";
import { createWorkspaceVirtualDocumentSupplier } from "../../domain/filesystem/VirtualFilesystem.ts";
import type { PaneId } from "../../domain/workspace/PaneTree.ts";
import type { ThemeController } from "../../theme/Theme.ts";
import type {
  PaneShellPresentation,
  PaneShellRuntimeControl,
} from "../workspace/PaneShellRuntimes.ts";
import { createCommandRegistry } from "../../application/commands/CommandRegistry.ts";
import {
  createPaneCommandDefinition,
  type PaneCommandHandler,
} from "../../application/commands/PaneCommand.ts";
import {
  createCompletionService,
  createRegistryCommandCompletionProvider,
  createVirtualFilesystemPathCompletionProvider,
} from "../../application/commands/Completion.ts";
import { createReadOnlyCommandDefinitions } from "../../application/commands/ReadOnlyCommands.ts";
import { createPortfolioCommandDefinitions } from "../../application/commands/PortfolioCommands.ts";
import type { PortfolioStatsReader } from "../../application/commands/PortfolioCommands.ts";
import type { SecretPromptSubmissionHandler } from "../../application/commands/SecretPromptEffectConsumption.ts";
import {
  InputCapture,
  type InputCaptureHandle,
  type InputCapturePaneKeyInput,
  type InputCapturePaneKeyResult,
} from "./InputCapture";
import { TerminalViewport } from "./TerminalViewport";
import { TerminalTranscript } from "./TerminalViewport";
import { useShellEngine } from "./useShellEngine";
import {
  MobilePaneControls,
  type MobilePaneControl,
} from "../workspace/MobilePaneControls";
import type { MobileCtrlInputResolution } from "../workspace/MobileCtrlModifier.ts";
import { ViewerPane } from "../workspace/ViewerPane";
import { HierarchicalCollectionPane } from "../workspace/HierarchicalCollectionPane.tsx";
import { ThemeSelectorPane } from "../workspace/ThemeSelectorPane.tsx";
import { generatedManpageCorpus } from "../../content/ManpageCorpusVite.ts";
import type { VimSessionBinding } from "../workspace/VimSessionState.ts";
import type { AuthenticationController } from "../../auth/Authentication.ts";
import { createAuthenticationCommandDefinitions } from "../../application/commands/AuthenticationCommands.ts";

type TerminalProps = Readonly<{
  paneId: PaneId;
  state: ShellState;
  presentation: PaneShellPresentation;
  runtimeControl: PaneShellRuntimeControl;
  onShellAction: (paneId: PaneId, action: ShellAction) => void;
  hasShellRuntime: (paneId: PaneId) => boolean;
  isActive: boolean;
  focusVersion: number;
  onActivate: () => void;
  onPaneKeyInput: (
    input: InputCapturePaneKeyInput,
  ) => InputCapturePaneKeyResult;
  mobileCtrlPressed: boolean;
  vimSession: VimSessionBinding;
  onToggleMobileCtrl: () => void;
  onConsumeMobileCtrl: () => void;
  resolveMobileCtrlInput: (
    input: InputCapturePaneKeyInput,
  ) => MobileCtrlInputResolution;
  paneCommandHandler: PaneCommandHandler;
  onCloseShellPresentation: (
    paneId: PaneId,
    transientDiagnostic?: string,
  ) => void;
  themeController: ThemeController;
  filesystem: VirtualFilesystem;
  onFilesystemChange: (overlay: VirtualFilesystemOverlay) => void;
  documents: VirtualDocumentSupplier;
  projectReadmes: ReadonlyArray<ProjectReadme>;
  readStats: PortfolioStatsReader;
  onAcceptedContentOpen: (contentId: ContentId) => void;
  secretPromptSubmissionHandler?: SecretPromptSubmissionHandler;
  authentication: AuthenticationController;
  promptIdentity: string;
}>;

export function Terminal({
  paneId,
  state,
  presentation,
  runtimeControl,
  onShellAction,
  hasShellRuntime,
  isActive,
  focusVersion,
  onActivate,
  onPaneKeyInput,
  mobileCtrlPressed,
  vimSession,
  onToggleMobileCtrl,
  onConsumeMobileCtrl,
  resolveMobileCtrlInput,
  paneCommandHandler,
  onCloseShellPresentation,
  themeController,
  filesystem,
  onFilesystemChange,
  documents,
  projectReadmes,
  readStats,
  onAcceptedContentOpen,
  secretPromptSubmissionHandler,
  authentication,
  promptIdentity,
}: TerminalProps): ReactElement {
  const inputRef = useRef<InputCaptureHandle>(null);
  const dispatchShellAction = useCallback(
    (action: ShellAction): void => {
      onShellAction(paneId, action);
    },
    [onShellAction, paneId],
  );
  const isSessionOpen = useCallback(
    (): boolean => hasShellRuntime(paneId),
    [hasShellRuntime, paneId],
  );
  const [registry] = useState(() => {
    const workspaceDocuments = createWorkspaceVirtualDocumentSupplier(
      filesystem,
      documents,
    );

    return createCommandRegistry({
      filesystem,
      documents: workspaceDocuments,
      onFilesystemChange,
      commands: [
        ...createReadOnlyCommandDefinitions({
          filesystem,
          documents: workspaceDocuments,
          manpages: generatedManpageCorpus,
          recursiveEntryLimit: 100,
        }),
        ...createPortfolioCommandDefinitions({
          filesystem,
          documents: workspaceDocuments,
          projectReadmes,
          themes: themeController,
          readStats,
        }),
        ...createAuthenticationCommandDefinitions(authentication),
        createPaneCommandDefinition(paneId, paneCommandHandler),
      ],
    });
  });
  const completionService =
    createCompletionService({
      commands: createRegistryCommandCompletionProvider(registry),
      paths: createVirtualFilesystemPathCompletionProvider({
        filesystem,
        currentDirectory: state.currentDirectory,
      }),
    });
  const shell = useShellEngine({
    state,
    onAction: dispatchShellAction,
    isSessionOpen,
    runtimeControl,
    registry,
    completionService,
    secretPromptSubmissionHandler,
  });
  const activePrompt = getActiveShellPrompt(shell.state);
  const promptLine =
    activePrompt.kind === "secret"
      ? activePrompt.prompt.line
      : activePrompt.line;
  const promptLabel =
    activePrompt.kind === "secret" ? activePrompt.prompt.request.label : undefined;
  const displayInput =
    activePrompt.kind === "secret"
      ? "•".repeat(Array.from(promptLine.text).length)
      : promptLine.text;

  useLayoutEffect(() => {
    if (isActive && presentation.kind === "shell") {
      inputRef.current?.preserveFocus();
    }
  }, [isActive, presentation, shell.state.history, shell.transientDiagnostic]);

  const focusInputFromTerminal = (event: MouseEvent<HTMLDivElement>): void => {
    const target = event.target;

    if (!(target instanceof Element)) {
      return;
    }

    if (target.closest("button, a, input, textarea, select")) {
      return;
    }

    onActivate();
    inputRef.current?.focus();
  };

  const handleMobileControl = (
    control: MobilePaneControl,
    ctrlKey: boolean,
  ): void => {
    if (ctrlKey) {
      return;
    }

    switch (control) {
      case "escape":
        shell.dismissCompletion();
        return;
      case "tab":
        shell.complete("next");
        return;
      case "left":
        shell.moveLeft();
        return;
      case "right":
        shell.moveRight();
        return;
      case "up":
        shell.browseOlderHistory();
        return;
      case "down":
        shell.browseNewerHistory();
        return;
    }
  };

  const handleMobilePrefix = (): void => {
    onPaneKeyInput({
      key: "b",
      ctrlKey: true,
      metaKey: false,
    });
  };

  if (presentation.kind === "inline-viewer") {
    return (
      <ViewerPane
        viewer={presentation.viewer}
        isActive={isActive}
        focusVersion={focusVersion}
        onActivate={onActivate}
        onPaneKeyInput={onPaneKeyInput}
        mobileCtrlPressed={mobileCtrlPressed}
        vimSession={vimSession}
        onToggleMobileCtrl={onToggleMobileCtrl}
        onConsumeMobileCtrl={onConsumeMobileCtrl}
        resolveMobileCtrlInput={resolveMobileCtrlInput}
        onAcceptedContentOpen={onAcceptedContentOpen}
        onClose={() => {
          onCloseShellPresentation(paneId);
        }}
      />
    );
  }

  if (presentation.kind === "inline-collection") {
    return (
      <HierarchicalCollectionPane
        collection={presentation.collection}
        presentation={{
          kind: "inline-terminal",
          transcript: (
            <TerminalTranscript
              rows={shell.state.history}
              promptIdentity={promptIdentity}
              transientDiagnostic={shell.transientDiagnostic?.message}
            />
          ),
        }}
        isActive={isActive}
        focusVersion={focusVersion}
        onActivate={onActivate}
        onPaneKeyInput={onPaneKeyInput}
        onCancel={() => onCloseShellPresentation(paneId)}
        onAcceptedContentOpen={onAcceptedContentOpen}
        renderDocument={(leaf, onReturn) => (
          <ViewerPane
            viewer={{
              kind: "document",
              title: leaf.documentTitle,
              presentation: "inline",
              document: leaf.document,
              statsIdentity: leaf.statsIdentity,
            }}
            isActive={isActive}
            focusVersion={focusVersion}
            onActivate={onActivate}
            onPaneKeyInput={onPaneKeyInput}
            mobileCtrlPressed={mobileCtrlPressed}
            vimSession={vimSession}
            onToggleMobileCtrl={onToggleMobileCtrl}
            onConsumeMobileCtrl={onConsumeMobileCtrl}
            resolveMobileCtrlInput={resolveMobileCtrlInput}
            onAcceptedContentOpen={onAcceptedContentOpen}
            onClose={onReturn}
          />
        )}
      />
    );
  }

  if (presentation.kind === "theme-selector") {
    return (
      <ThemeSelectorPane
        transcript={(
          <TerminalTranscript
            rows={shell.state.history}
            promptIdentity={promptIdentity}
            transientDiagnostic={shell.transientDiagnostic?.message}
          />
        )}
        controller={themeController}
        isActive={isActive}
        focusVersion={focusVersion}
        storageFailureReported={presentation.storageFailureReported}
        onActivate={onActivate}
        onPaneKeyInput={onPaneKeyInput}
        onClose={(transientDiagnostic) =>
          onCloseShellPresentation(paneId, transientDiagnostic)}
      />
    );
  }

  return (
    <div
      className="flex h-full min-h-0 min-w-0 w-full flex-col bg-surface-deepest text-text-primary"
      onClick={focusInputFromTerminal}
      onFocusCapture={onActivate}
    >
      <div className="min-h-0 flex-1">
        <TerminalViewport
          rows={shell.state.history}
          promptIdentity={promptIdentity}
          currentDirectory={shell.state.currentDirectory}
          promptLabel={promptLabel}
          currentInput={displayInput}
          cursorColumn={promptLine.cursor}
          status={getShellStatus(shell.state)}
          completion={shell.state.completion}
          autosuggestion={getShellAutosuggestion(shell.state)}
          transientDiagnostic={
            presentation.transientDiagnostic ?? shell.transientDiagnostic?.message
          }
        />
      </div>

      <MobilePaneControls
        ctrlPressed={mobileCtrlPressed}
        onCtrlToggle={onToggleMobileCtrl}
        onCtrlConsumed={onConsumeMobileCtrl}
        onControl={handleMobileControl}
        onPrefix={handleMobilePrefix}
      />

      <InputCapture
        ref={inputRef}
        value={promptLine.text}
        cursor={promptLine.cursor}
        promptKind={activePrompt.kind}
        isActive={isActive}
        focusVersion={focusVersion}
        onInsertText={shell.insertText}
        onNativeValueChange={shell.replaceInputValue}
        onMoveCursor={shell.moveCursor}
        onMoveLeft={shell.moveLeft}
        onMoveRight={shell.moveRight}
        onMoveStart={shell.moveStart}
        onMoveEnd={shell.moveEnd}
        onMovePreviousWord={shell.movePreviousWord}
        onMoveNextWord={shell.moveNextWord}
        onBackspace={shell.backspace}
        onDelete={shell.delete}
        onDeletePreviousWord={shell.deletePreviousWord}
        onBrowseOlderHistory={shell.browseOlderHistory}
        onBrowseNewerHistory={shell.browseNewerHistory}
        onSubmit={shell.submit}
        onCancel={shell.cancel}
        onDismissCompletion={shell.dismissCompletion}
        onComplete={shell.complete}
        onFocus={onActivate}
        onPaneKeyInput={onPaneKeyInput}
        resolveMobileCtrlInput={resolveMobileCtrlInput}
      />
    </div>
  );
}
