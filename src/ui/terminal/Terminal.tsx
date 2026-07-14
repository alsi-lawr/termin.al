import { useRef, useState, type ReactElement } from "react";
import { InputCapture, type InputCaptureHandle } from "./InputCapture";
import {
  createTerminalHistoryEntry,
  type TerminalHistoryEntry,
} from "./TerminalHistory";
import { TerminalViewport } from "./TerminalViewport";
import {
  backspaceTerminalInput,
  createEmptyTerminalInput,
  deleteTerminalInputAtCursor,
  insertTerminalInputText,
  moveTerminalInputCursorLeft,
  moveTerminalInputCursorRight,
  type TerminalInput,
} from "../../domain/terminal/TerminalInput";

type TerminalProps = Readonly<{
  prompt?: string;
}>;

export function Terminal({ prompt = "$" }: TerminalProps): ReactElement {
  const [rows, setRows] = useState<ReadonlyArray<TerminalHistoryEntry>>([]);
  const [input, setInput] = useState<TerminalInput>(createEmptyTerminalInput);
  const inputRef = useRef<InputCaptureHandle>(null);

  return (
    <div
      className="rounded-md border border-neutral-800 bg-neutral-950 text-neutral-100 w-screen h-screen"
      onClick={() => inputRef.current?.focus()}
    >
      <TerminalViewport
        rows={rows}
        prompt={prompt}
        currentInput={input.value}
        cursorColumn={input.cursor}
      />

      <InputCapture
        ref={inputRef}
        value={input.value}
        onInsertText={(text) =>
          setInput((current) => insertTerminalInputText(current, text))
        }
        onMoveCursorLeft={() =>
          setInput((current) => moveTerminalInputCursorLeft(current))
        }
        onMoveCursorRight={() =>
          setInput((current) => moveTerminalInputCursorRight(current))
        }
        onDeleteAtCursor={() =>
          setInput((current) => deleteTerminalInputAtCursor(current))
        }
        onBackspaceCursor={() =>
          setInput((current) => backspaceTerminalInput(current))
        }
        onSubmit={(execution) => {
          setRows((existingRows) => [
            ...existingRows,
            createTerminalHistoryEntry({
              sequence: existingRows.length + 1,
              execution,
            }),
          ]);
          setInput(createEmptyTerminalInput());
        }}
      />
    </div>
  );
}
