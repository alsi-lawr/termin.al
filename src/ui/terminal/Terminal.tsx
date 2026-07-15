import {
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactElement,
} from "react";
import {
  createShellId,
  createShellSessionId,
  createShellState,
  getActiveShellPrompt,
  getShellStatus,
} from "../../domain/terminal/Shell.ts";
import { createCommandRegistry } from "../../application/commands/CommandRegistry.ts";
import {
  createCompletionService,
  createEmptyPathCompletionProvider,
  createRegistryCommandCompletionProvider,
} from "../../application/commands/Completion.ts";
import type { SecretPromptOutcomeHandler } from "../../application/commands/SecretPromptDelivery.ts";
import { InputCapture, type InputCaptureHandle } from "./InputCapture";
import { TerminalViewport } from "./TerminalViewport";
import { useShellEngine } from "./useShellEngine";

type TerminalProps = Readonly<{
  prompt?: string;
  secretPromptOutcomeHandler?: SecretPromptOutcomeHandler;
}>;

export function Terminal({
  prompt = "$",
  secretPromptOutcomeHandler,
}: TerminalProps): ReactElement {
  const inputRef = useRef<InputCaptureHandle>(null);
  const [initialState] = useState(() =>
    createShellState({
      id: createShellId("main-terminal"),
      sessionId: createShellSessionId("browser-session"),
      scrollbackLimit: 200,
      commandHistoryLimit: 100,
    }),
  );
  const [registry] = useState(() => createCommandRegistry({ commands: [] }));
  const [completionService] = useState(() =>
    createCompletionService({
      commands: createRegistryCommandCompletionProvider(registry),
      paths: createEmptyPathCompletionProvider(),
    }),
  );
  const shell = useShellEngine({
    initialState,
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
    inputRef.current?.preserveFocus();
  }, [shell.state.history, shell.transientDiagnostic]);

  const focusInputFromTerminal = (event: MouseEvent<HTMLDivElement>): void => {
    const target = event.target;

    if (!(target instanceof Element)) {
      return;
    }

    if (target.closest("button, a, input, textarea, select")) {
      return;
    }

    inputRef.current?.focus();
  };

  return (
    <div
      className="h-screen w-screen rounded-md border border-neutral-800 bg-neutral-950 text-neutral-100"
      onClick={focusInputFromTerminal}
    >
      <TerminalViewport
        rows={shell.state.history}
        prompt={displayPrompt}
        currentInput={displayInput}
        cursorColumn={editor.buffer.cursor}
        status={getShellStatus(shell.state)}
        completion={shell.state.completion}
        transientDiagnostic={shell.transientDiagnostic?.message}
      />

      <InputCapture
        ref={inputRef}
        value={editor.buffer.value}
        cursor={editor.buffer.cursor}
        mode={editor.buffer.mode}
        isSecret={activePrompt.kind === "secret"}
        onInsertText={shell.insertText}
        onNativeValueChange={shell.replaceInputValue}
        onMoveCursor={shell.moveCursor}
        onNormalKey={shell.normalKey}
        onSubmit={shell.submit}
        onCancel={shell.cancel}
        onComplete={shell.complete}
      />
    </div>
  );
}
