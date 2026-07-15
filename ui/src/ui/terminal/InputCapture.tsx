import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type ChangeEvent,
  type ClipboardEvent,
  type CompositionEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
  type SyntheticEvent,
} from "react";
import {
  normalPromptKeyFromKeyboard,
  type NormalPromptKey,
} from "../../domain/terminal/PromptEditor.ts";
import type { PromptMode } from "../../domain/terminal/PromptBuffer.ts";
import {
  moveNativeInputSelectionLeft,
  moveNativeInputSelectionRight,
  normalizeNativeInputSelection,
} from "./UnicodeUiBoundary.ts";

export type InputCaptureHandle = Readonly<{
  focus: () => void;
  preserveFocus: () => void;
}>;

export type InputCapturePaneKeyInput = Readonly<{
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
}>;

export type InputCapturePaneKeyResult =
  | Readonly<{ kind: "handled" }>
  | Readonly<{ kind: "unhandled" }>;

type InputCaptureProps = Readonly<{
  value: string;
  cursor: number;
  mode: PromptMode;
  isSecret: boolean;
  isActive: boolean;
  focusVersion: number;
  onNativeValueChange: (value: string, cursor: number) => void;
  onMoveCursor: (cursor: number) => void;
  onInsertText: (text: string) => void;
  onNormalKey: (key: NormalPromptKey) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onComplete: () => void;
  onFocus: () => void;
  onPaneKeyInput: (
    input: InputCapturePaneKeyInput,
  ) => InputCapturePaneKeyResult;
}>;

function selectionCursor(element: HTMLTextAreaElement): number {
  return normalizeNativeInputSelection(
    element.value,
    element.selectionEnd ?? element.value.length,
  );
}

export const InputCapture = forwardRef<InputCaptureHandle, InputCaptureProps>(
  function InputCapture(props, ref): ReactElement {
    const inputRef = useRef<HTMLTextAreaElement | null>(null);
    const composing = useRef(false);

    useImperativeHandle(ref, () => ({
      focus: () => inputRef.current?.focus(),
      preserveFocus: () => {
        const input = inputRef.current;

        if (input && document.activeElement === input) {
          input.focus({ preventScroll: true });
        }
      },
    }));

    useEffect(() => {
      if (props.isActive) {
        inputRef.current?.focus({ preventScroll: true });
      }
    }, [props.focusVersion, props.isActive]);

    useLayoutEffect(() => {
      const input = inputRef.current;

      if (!input || composing.current) {
        return;
      }

      const cursor = normalizeNativeInputSelection(props.value, props.cursor);
      input.setSelectionRange(cursor, cursor);
    }, [props.cursor, props.value]);

    const synchroniseNativeValue = (
      event: SyntheticEvent<HTMLTextAreaElement>,
    ): void => {
      if (props.mode.kind !== "insert") {
        return;
      }

      const input = event.currentTarget;
      props.onNativeValueChange(input.value, selectionCursor(input));
    };

    const handleChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
      synchroniseNativeValue(event);
    };

    const handleSelectionChange = (
      event: SyntheticEvent<HTMLTextAreaElement>,
    ): void => {
      if (props.mode.kind !== "insert" || composing.current) {
        return;
      }

      props.onMoveCursor(selectionCursor(event.currentTarget));
    };

    const handleCompositionStart = (): void => {
      composing.current = true;
    };

    const handleCompositionEnd = (
      event: CompositionEvent<HTMLTextAreaElement>,
    ): void => {
      composing.current = false;
      synchroniseNativeValue(event);
    };

    const handleBeforeInput = (event: FormEvent<HTMLTextAreaElement>): void => {
      if (props.mode.kind === "normal" && !composing.current) {
        event.preventDefault();
      }
    };

    const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
      if (props.mode.kind !== "insert") {
        event.preventDefault();
        return;
      }

      event.preventDefault();
      props.onInsertText(event.clipboardData.getData("text"));
    };

    const handleNormalKey = (
      event: KeyboardEvent<HTMLTextAreaElement>,
    ): void => {
      const match = normalPromptKeyFromKeyboard(
        event.key,
        event.ctrlKey,
        event.metaKey,
      );

      if (match.kind === "recognized") {
        props.onNormalKey(match.key);
      }
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
      if (event.nativeEvent.isComposing || composing.current) {
        return;
      }

      const paneKeyResult = props.onPaneKeyInput({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
      });

      if (paneKeyResult.kind === "handled") {
        event.preventDefault();
        return;
      }

      if (event.ctrlKey && event.key.toLowerCase() === "c") {
        event.preventDefault();
        props.onCancel();
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        props.onSubmit();
        return;
      }

      if (props.mode.kind === "normal") {
        event.preventDefault();
        handleNormalKey(event);
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        handleNormalKey(event);
        return;
      }

      if (event.key === "Tab") {
        event.preventDefault();
        props.onComplete();
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        props.onMoveCursor(
          moveNativeInputSelectionLeft(props.value, props.cursor),
        );
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        props.onMoveCursor(
          moveNativeInputSelectionRight(props.value, props.cursor),
        );
        return;
      }

      if (event.key === "Home") {
        event.preventDefault();
        props.onMoveCursor(0);
        return;
      }

      if (event.key === "End") {
        event.preventDefault();
        props.onMoveCursor(props.value.length);
      }
    };

    const inputLabel = props.isSecret
      ? "Secret terminal input"
      : "Terminal command input";

    return (
      <textarea
        ref={inputRef}
        value={props.value}
        onKeyDown={handleKeyDown}
        onBeforeInput={handleBeforeInput}
        onChange={handleChange}
        onSelect={handleSelectionChange}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onPaste={handlePaste}
        onFocus={props.onFocus}
        className="sr-only"
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        aria-label={inputLabel}
      />
    );
  },
);
