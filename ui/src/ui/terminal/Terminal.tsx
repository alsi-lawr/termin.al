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
  getShellStatus,
  type ShellAction,
  type ShellState,
} from "../../domain/terminal/Shell.ts";
import { developmentFixtureCorpus } from "../../content/DevelopmentFixtureCorpus.ts";
import type { PaneId } from "../../domain/workspace/PaneTree.ts";
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
import type { SecretPromptOutcomeHandler } from "../../application/commands/SecretPromptDelivery.ts";
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
  MobilePaneControls,
  type MobilePaneControl,
} from "../workspace/MobilePaneControls";
import { ViewerPane } from "../workspace/ViewerPane";

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
  paneCommandHandler: PaneCommandHandler;
  onCloseInlineViewer: (paneId: PaneId) => void;
  prompt?: string;
  secretPromptOutcomeHandler?: SecretPromptOutcomeHandler;
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
  paneCommandHandler,
  onCloseInlineViewer,
  prompt = "$",
  secretPromptOutcomeHandler,
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
          filesystem: developmentFixtureCorpus.filesystem,
          documents: developmentFixtureCorpus.documents,
          recursiveEntryLimit: 100,
        }),
        ...createPortfolioCommandDefinitions({
          filesystem: developmentFixtureCorpus.filesystem,
          documents: developmentFixtureCorpus.documents,
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
    secretPromptOutcomeHandler,
  });
  const activePrompt = getActiveShellPrompt(shell.state);
  const editor =
    activePrompt.kind === "secret"
      ? activePrompt.prompt.editor
      : activePrompt.editor;
  const displayPrompt =
    activePrompt.kind === "secret" ? activePrompt.prompt.request.label : prompt;
  const displayInput =
    activePrompt.kind === "secret"
      ? "•".repeat(editor.buffer.value.length)
      : editor.buffer.value;

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
        if (editor.buffer.mode.kind === "normal") {
          shell.normalKey({ kind: "motion", motion: "left" });
          return;
        }

        shell.moveCursor(
          previousUnicodeCursorOffset(
            editor.buffer.value,
            editor.buffer.cursor,
          ),
        );
        return;
      case "right":
        if (editor.buffer.mode.kind === "normal") {
          shell.normalKey({ kind: "motion", motion: "right" });
          return;
        }

        shell.moveCursor(
          nextUnicodeCursorOffset(editor.buffer.value, editor.buffer.cursor),
        );
        return;
      case "up":
        if (editor.buffer.mode.kind === "normal") {
          shell.normalKey({ kind: "history-older" });
        }
        return;
      case "down":
        if (editor.buffer.mode.kind === "normal") {
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
        onClose={() => {
          onCloseInlineViewer(paneId);
        }}
      />
    );
  }

  return (
    <div
      className="flex h-full min-h-0 min-w-0 w-full flex-col rounded-md border border-neutral-800 bg-neutral-950 text-neutral-100"
      onClick={focusInputFromTerminal}
      onFocusCapture={onActivate}
    >
      <div className="min-h-0 flex-1">
        <TerminalViewport
          rows={shell.state.history}
          prompt={displayPrompt}
          currentInput={displayInput}
          cursorColumn={editor.buffer.cursor}
          status={getShellStatus(shell.state)}
          completion={shell.state.completion}
          transientDiagnostic={shell.transientDiagnostic?.message}
        />
      </div>

      <MobilePaneControls
        onControl={handleMobileControl}
        onPrefix={handleMobilePrefix}
      />

      <InputCapture
        ref={inputRef}
        value={editor.buffer.value}
        cursor={editor.buffer.cursor}
        mode={editor.buffer.mode}
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
      />
    </div>
  );
}
