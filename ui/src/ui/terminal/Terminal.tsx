import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactElement,
} from "react";
import type { ApplicationMode } from "../../ApplicationComposition.ts";
import {
  getActiveShellPrompt,
  getShellStatus,
  type ShellAction,
  type ShellState,
} from "../../domain/terminal/Shell.ts";
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
  createEmptyPathCompletionProvider,
  createRegistryCommandCompletionProvider,
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
import { useShellEngine } from "./useShellEngine";
import {
  nextUnicodeCursorOffset,
  previousUnicodeCursorOffset,
} from "../../domain/terminal/UnicodeCursor.ts";
import {
  vimBufferCursorOffset,
  vimBufferText,
} from "../../domain/vim/VimBuffer.ts";
import { vimPromptMode } from "../../domain/terminal/VimPrompt.ts";
import {
  MobilePaneControls,
  type MobilePaneControl,
} from "../workspace/MobilePaneControls";
import type { MobileCtrlInputResolution } from "../workspace/MobileCtrlModifier.ts";
import { ViewerPane } from "../workspace/ViewerPane";

type TerminalProps = Readonly<{
  paneId: PaneId;
  applicationMode: ApplicationMode;
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
  prompt?: string;
  secretPromptSubmissionHandler?: SecretPromptSubmissionHandler;
}>;

export function Terminal({
  paneId,
  applicationMode,
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
  prompt = "$",
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
          themes: themeController,
        }),
        createPaneCommandDefinition(paneId, paneCommandHandler),
      ],
    }),
  );
  const [completionService] = useState(() =>
    createCompletionService({
      commands: createRegistryCommandCompletionProvider(registry),
      paths: createEmptyPathCompletionProvider(),
    }),
  );
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
  const promptBuffer =
    activePrompt.kind === "secret"
      ? activePrompt.prompt.buffer
      : activePrompt.buffer;
  const displayPrompt =
    activePrompt.kind === "secret" ? activePrompt.prompt.request.label : prompt;
  const displayInput =
    activePrompt.kind === "secret"
      ? "•".repeat(vimBufferText(promptBuffer).length)
      : vimBufferText(promptBuffer);

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
        shell.normalKey({ kind: "escape" });
        return;
      case "tab":
        shell.complete();
        return;
      case "left":
        if (vimPromptMode(promptBuffer).kind === "normal") {
          shell.normalKey({ kind: "motion", motion: "left" });
          return;
        }

        shell.moveCursor(
          previousUnicodeCursorOffset(
            vimBufferText(promptBuffer),
            vimBufferCursorOffset(promptBuffer),
          ),
        );
        return;
      case "right":
        if (vimPromptMode(promptBuffer).kind === "normal") {
          shell.normalKey({ kind: "motion", motion: "right" });
          return;
        }

        shell.moveCursor(
          nextUnicodeCursorOffset(
            vimBufferText(promptBuffer),
            vimBufferCursorOffset(promptBuffer),
          ),
        );
        return;
      case "up":
        if (vimPromptMode(promptBuffer).kind === "normal") {
          shell.normalKey({ kind: "history-older" });
        }
        return;
      case "down":
        if (vimPromptMode(promptBuffer).kind === "normal") {
          shell.normalKey({ kind: "history-newer" });
        }
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

  return (
    <div
      className="flex h-full min-h-0 min-w-0 w-full flex-col rounded-md border border-surface-border bg-surface-deepest text-text-primary"
      onClick={focusInputFromTerminal}
      onFocusCapture={onActivate}
    >
      <div className="min-h-0 flex-1">
        <TerminalViewport
          rows={shell.state.history}
          applicationMode={applicationMode}
          prompt={displayPrompt}
          currentInput={displayInput}
          cursorColumn={vimBufferCursorOffset(promptBuffer)}
          status={getShellStatus(shell.state)}
          completion={shell.state.completion}
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
        value={vimBufferText(promptBuffer)}
        cursor={vimBufferCursorOffset(promptBuffer)}
        mode={vimPromptMode(promptBuffer)}
        promptKind={activePrompt.kind}
        isActive={isActive}
        focusVersion={focusVersion}
        onInsertText={shell.insertText}
        onNativeValueChange={shell.replaceInputValue}
        onMoveCursor={shell.moveCursor}
        onNormalKey={shell.normalKey}
        onSubmit={shell.submit}
        onCancel={shell.cancel}
        onComplete={shell.complete}
        onFocus={onActivate}
        onPaneKeyInput={onPaneKeyInput}
        resolveMobileCtrlInput={resolveMobileCtrlInput}
      />
    </div>
  );
}
