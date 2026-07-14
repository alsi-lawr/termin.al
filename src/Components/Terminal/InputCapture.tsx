import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import {
  TerminalHistoryState,
  type TerminalSubmission,
} from "./TerminalHistory";

export type InputCaptureHandle = Readonly<{
  focus: () => void;
}>;

type InputCaptureProps = Readonly<{
  value: string;
  onInsertText: (value: string) => void;
  onMoveCursorLeft: () => void;
  onMoveCursorRight: () => void;
  onDeleteAtCursor: () => void;
  onBackspaceCursor: () => void;
  onSubmit: (submission: TerminalSubmission) => void;
}>;

export const InputCapture = forwardRef<InputCaptureHandle, InputCaptureProps>(
  function InputCapture(props, ref): ReactElement {
    const inputRef = useRef<HTMLTextAreaElement | null>(null);

    useImperativeHandle(ref, () => ({
      focus: () => inputRef.current?.focus(),
    }));

    useEffect(() => {
      inputRef.current?.focus();
    }, []);

    const isCtrlC = (event: KeyboardEvent<HTMLTextAreaElement>): boolean =>
      event.ctrlKey && event.key.toLowerCase() === "c";

    const isPrintableKey = (
      event: KeyboardEvent<HTMLTextAreaElement>,
    ): boolean =>
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey;

    const specialKeyHandlers: Partial<
      Record<string, (event: KeyboardEvent<HTMLTextAreaElement>) => void>
    > = {
      ArrowLeft: (event) => {
        event.preventDefault();
        props.onMoveCursorLeft();
      },
      ArrowRight: (event) => {
        event.preventDefault();
        props.onMoveCursorRight();
      },
      Backspace: (event) => {
        event.preventDefault();
        props.onBackspaceCursor();
      },
      Delete: (event) => {
        event.preventDefault();
        props.onDeleteAtCursor();
      },
      Enter: (event) => {
        event.preventDefault();
        if (event.shiftKey) {
          props.onInsertText("\n");
          return;
        }

        props.onSubmit({
          value: props.value,
          state: TerminalHistoryState.Success,
          result: "",
        });
      },
      Tab: (event) => {
        event.preventDefault();
        props.onInsertText("  ");
      },
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
      if (isCtrlC(event)) {
        event.preventDefault();
        props.onSubmit({
          value: props.value,
          state: TerminalHistoryState.Cancelled,
          result: "",
        });
        return;
      }

      const specialHandler = specialKeyHandlers[event.key];

      if (specialHandler) {
        specialHandler(event);
        return;
      }

      if (isPrintableKey(event)) {
        event.preventDefault();
        props.onInsertText(event.key);
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
