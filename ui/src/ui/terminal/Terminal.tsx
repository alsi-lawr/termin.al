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
import type {
  VirtualDocumentSupplier,
  VirtualFilesystem,
} from "../../domain/filesystem/VirtualFilesystem.ts";
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
  onToggleMobileCtrl: () => void;
  onConsumeMobileCtrl: () => void;
  resolveMobileCtrlInput: (
    input: InputCapturePaneKeyInput,
  ) => MobileCtrlInputResolution;
  paneCommandHandler: PaneCommandHandler;
  onCloseInlineViewer: (paneId: PaneId) => void;
  themeController: ThemeController;
  filesystem: VirtualFilesystem;
  documents: VirtualDocumentSupplier;
  projectReadmes: ReadonlyArray<ProjectReadme>;
  secretPromptSubmissionHandler?: SecretPromptSubmissionHandler;
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
  onToggleMobileCtrl,
  onConsumeMobileCtrl,
  resolveMobileCtrlInput,
  paneCommandHandler,
  onCloseInlineViewer,
  themeController,
  filesystem,
  documents,
  projectReadmes,
  secretPromptSubmissionHandler,
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
  const [registry] = useState(() =>
    createCommandRegistry({
      commands: [
        ...createReadOnlyCommandDefinitions({
          filesystem,
          documents,
          recursiveEntryLimit: 100,
        }),
        ...createPortfolioCommandDefinitions({
          filesystem,
          documents,
          projectReadmes,
          themes: themeController,
        }),
        createPaneCommandDefinition(paneId, paneCommandHandler),
      ],
    }),
  );
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
        onToggleMobileCtrl={onToggleMobileCtrl}
        onConsumeMobileCtrl={onConsumeMobileCtrl}
        resolveMobileCtrlInput={resolveMobileCtrlInput}
        onClose={() => {
          onCloseInlineViewer(paneId);
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
              transientDiagnostic={shell.transientDiagnostic?.message}
            />
          ),
        }}
        isActive={isActive}
        focusVersion={focusVersion}
        onActivate={onActivate}
        onPaneKeyInput={onPaneKeyInput}
        onCancel={() => onCloseInlineViewer(paneId)}
        renderDocument={(leaf, onReturn) => (
          <ViewerPane
            viewer={{
              kind: "document",
              title: leaf.documentTitle,
              presentation: "inline",
              document: leaf.document,
            }}
            isActive={isActive}
            focusVersion={focusVersion}
            onActivate={onActivate}
            onPaneKeyInput={onPaneKeyInput}
            mobileCtrlPressed={mobileCtrlPressed}
            onToggleMobileCtrl={onToggleMobileCtrl}
            onConsumeMobileCtrl={onConsumeMobileCtrl}
            resolveMobileCtrlInput={resolveMobileCtrlInput}
            onClose={onReturn}
          />
        )}
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
          currentDirectory={shell.state.currentDirectory}
          promptLabel={promptLabel}
          currentInput={displayInput}
          cursorColumn={promptLine.cursor}
          status={getShellStatus(shell.state)}
          completion={shell.state.completion}
          autosuggestion={getShellAutosuggestion(shell.state)}
          transientDiagnostic={shell.transientDiagnostic?.message}
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
