import { useRef, useState } from "react";
import { TerminalViewport } from "./TerminalViewport";
import { InputCapture, type InputCaptureHandle } from "./InputCapture";
import { type TerminalHistoryProps } from "./TerminalHistoryRow";

type TerminalProps = {
  prompt?: string;
};

export function Terminal({ prompt = "$" }: TerminalProps) {
  const [rows, setRows] = useState<TerminalHistoryProps[]>([]);
  const [currentInput, setCurrentInput] = useState("");
  const [cursorIndex, setCursorIndex] = useState(0);
  const inputRef = useRef<InputCaptureHandle>(null);

  const insertTextAtCursor = (text: string) => {
    setCurrentInput((current) => {
      const next =
        current.slice(0, cursorIndex) + text + current.slice(cursorIndex);
      return next;
    });
    setCursorIndex((x) => x + text.length);
  };
  const moveCursorLeft = () => {
    setCursorIndex((x) => Math.max(0, x - 1));
  };

  const moveCursorRight = () => {
    setCursorIndex((x) => Math.min(x + 1, currentInput.length));
  };

  const backspaceCursor = () => {
    if (cursorIndex === 0) {
      return;
    }
    setCurrentInput((x) => x.slice(0, cursorIndex - 1) + x.slice(cursorIndex));
    moveCursorLeft();
  };

  const deleteAtCursor = () => {
    setCurrentInput((current) => {
      if (cursorIndex >= current.length) {
        return current;
      }

      return current.slice(0, cursorIndex) + current.slice(cursorIndex + 1);
    });
  };

  return (
    <div
      className="rounded-md border border-neutral-800 bg-neutral-950 text-neutral-100 w-screen h-screen"
      onClick={() => inputRef.current?.focus()}
    >
      <TerminalViewport
        rows={rows}
        prompt={prompt}
        currentInput={currentInput}
        cursorColumn={cursorIndex}
      />

      <InputCapture
        ref={inputRef}
        value={currentInput}
        onInsertText={insertTextAtCursor}
        onMoveCursorLeft={moveCursorLeft}
        onMoveCursorRight={moveCursorRight}
        onDeleteAtCursor={deleteAtCursor}
        onBackspaceCursor={backspaceCursor}
        onSubmit={(value, state, result) => {
          setRows((x) => [...x, { value, state, result }]);
          setCurrentInput("");
        }}
      />
    </div>
  );
}
