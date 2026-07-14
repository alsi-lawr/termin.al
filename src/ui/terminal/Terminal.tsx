import { useRef, useState, type ReactElement } from "react";
import {
  createShellId,
  createShellSessionId,
  createShellState,
} from "../../domain/terminal/Shell.ts";
import { createCommandRegistry } from "../../application/commands/CommandRegistry.ts";
import { InputCapture, type InputCaptureHandle } from "./InputCapture";
import { TerminalViewport } from "./TerminalViewport";
import { useShellEngine } from "./useShellEngine";

type TerminalProps = Readonly<{
  prompt?: string;
}>;

export function Terminal({ prompt = "$" }: TerminalProps): ReactElement {
  const inputRef = useRef<InputCaptureHandle>(null);
  const [initialState] = useState(() =>
    createShellState({
      id: createShellId("main-terminal"),
      sessionId: createShellSessionId("browser-session"),
      historyLimit: 200,
    }),
  );
  const [registry] = useState(() => createCommandRegistry({ commands: [] }));
  const shell = useShellEngine({ initialState, registry });

  return (
    <div
      className="h-screen w-screen rounded-md border border-neutral-800 bg-neutral-950 text-neutral-100"
      onClick={() => inputRef.current?.focus()}
    >
      <TerminalViewport
        rows={shell.state.history}
        prompt={prompt}
        currentInput={shell.state.input.value}
        cursorColumn={shell.state.input.cursor}
      />

      <InputCapture
        ref={inputRef}
        value={shell.state.input.value}
        onInsertText={shell.insertText}
        onMoveCursorLeft={shell.moveCursorLeft}
        onMoveCursorRight={shell.moveCursorRight}
        onDeleteAtCursor={shell.deleteAtCursor}
        onBackspaceCursor={shell.backspace}
        onSubmit={shell.submit}
        onCancel={shell.cancel}
      />
    </div>
  );
}
