import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { TerminalHistoryState } from "./TerminalHistoryRow";

export type InputCaptureHandle = {
  focus: () => void;
};

type InputCaptureProps = {
  value: string;
  onInsertText: (value: string) => void;
  onMoveCursorLeft: () => void;
  onMoveCursorRight: () => void;
  onDeleteAtCursor: () => void;
  onBackspaceCursor: () => void;
  onSubmit: (
    value: string,
    state: TerminalHistoryState,
    result: string,
  ) => void;
};

export const InputCapture = forwardRef<InputCaptureHandle, InputCaptureProps>(
  function InputCapture(props, ref) {
    const inputRef = useRef<HTMLTextAreaElement | null>(null);

    useImperativeHandle(ref, () => ({
      focus: () => inputRef.current?.focus(),
    }));

    useEffect(() => {
      inputRef.current?.focus();
    }, []);

    const isCtrlC = (e: React.KeyboardEvent<HTMLTextAreaElement>) =>
      e.ctrlKey && e.key.toLowerCase() === "c";

    const isPrintableKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) =>
      e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;

    const specialKeyHandlers: Partial<
      Record<string, (e: React.KeyboardEvent<HTMLTextAreaElement>) => void>
    > = {
      ArrowLeft: (e) => {
        e.preventDefault();
        props.onMoveCursorLeft();
      },
      ArrowRight: (e) => {
        e.preventDefault();
        props.onMoveCursorRight();
      },
      Backspace: (e) => {
        e.preventDefault();
        props.onBackspaceCursor();
      },
      Delete: (e) => {
        e.preventDefault();
        props.onDeleteAtCursor();
      },
      Enter: (e) => {
        e.preventDefault();
        if (e.shiftKey) {
          props.onInsertText("\n");
          return;
        }

        props.onSubmit(props.value, TerminalHistoryState.Success, "");
      },
      Tab: (e) => {
        e.preventDefault();
        props.onInsertText("  ");
      },
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (isCtrlC(e)) {
        e.preventDefault();
        props.onSubmit(props.value, TerminalHistoryState.Cancelled, "");
        return;
      }

      const specialHandler = specialKeyHandlers[e.key];

      if (specialHandler) {
        specialHandler(e);
        return;
      }

      if (isPrintableKey(e)) {
        e.preventDefault();
        props.onInsertText(e.key);
      }
    };

    return (
      <textarea
        ref={inputRef}
        value={props.value}
        onKeyDown={handleKeyDown}
        onChange={() => {}}
        className="absolute left-0 top-0 h-0 w-0 opacity-0 pointer-events-none"
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        aria-hidden="true"
      />
    );
  },
);
