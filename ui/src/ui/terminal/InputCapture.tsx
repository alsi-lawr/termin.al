import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type ChangeEvent,
  type ClipboardEvent,
  type CompositionEvent,
  type KeyboardEvent,
  type ReactElement,
  type SyntheticEvent,
} from "react";
import type { CompletionCycleDirection } from "../../domain/terminal/Shell.ts";
import { normalizeNativeInputSelection } from "./UnicodeUiBoundary.ts";
import {
  selectInputCaptureControl,
  type InputCapturePromptKind,
} from "./InputCaptureControl.ts";
import type {
  MobileCtrlInputResolution,
  MobileCtrlKeyInput,
} from "../workspace/MobileCtrlModifier.ts";

export type InputCaptureHandle = Readonly<{
  focus: () => void;
  preserveFocus: () => void;
}>;

export type InputCapturePaneKeyInput = MobileCtrlKeyInput;

export type InputCapturePaneKeyResult =
  | Readonly<{ kind: "handled" }>
  | Readonly<{ kind: "unhandled" }>;

type InputCaptureProps = Readonly<{
  value: string;
  cursor: number;
  promptKind: InputCapturePromptKind;
  isActive: boolean;
  focusVersion: number;
  onNativeValueChange: (value: string, cursor: number) => void;
  onMoveCursor: (cursor: number) => void;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  onMoveStart: () => void;
  onMoveEnd: () => void;
  onMovePreviousWord: () => void;
  onMoveNextWord: () => void;
  onBackspace: () => void;
  onDelete: () => void;
  onDeletePreviousWord: () => void;
  onBrowseOlderHistory: () => void;
  onBrowseNewerHistory: () => void;
  onInsertText: (text: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onDismissCompletion: () => void;
  onComplete: (direction: CompletionCycleDirection) => void;
  onFocus: () => void;
  onPaneKeyInput: (
    input: InputCapturePaneKeyInput,
  ) => InputCapturePaneKeyResult;
  resolveMobileCtrlInput: (
    input: InputCapturePaneKeyInput,
  ) => MobileCtrlInputResolution;
}>;

type NativeInputControlElement = HTMLInputElement | HTMLTextAreaElement;

function selectionCursor(element: NativeInputControlElement): number {
  return normalizeNativeInputSelection(
    element.value,
    element.selectionEnd ?? element.value.length,
  );
}

function isControlKey(input: InputCapturePaneKeyInput, key: string): boolean {
  return input.ctrlKey && input.key.toLowerCase() === key;
}

export const InputCapture = forwardRef<InputCaptureHandle, InputCaptureProps>(
  function InputCapture(props, ref): ReactElement {
    const control = selectInputCaptureControl(props.promptKind);
    const inputRef = useRef<NativeInputControlElement | null>(null);
    const composing = useRef(false);
    const setInputRef = useCallback(
      (element: NativeInputControlElement | null): void => {
        inputRef.current = element;
      },
      [],
    );

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
    }, [control.element, props.focusVersion, props.isActive]);

    useLayoutEffect(() => {
      const input = inputRef.current;

      if (!input || composing.current) {
        return;
      }

      const cursor = normalizeNativeInputSelection(props.value, props.cursor);
      input.setSelectionRange(cursor, cursor);
    }, [control.element, props.cursor, props.value]);

    const synchroniseNativeValue = (
      event: SyntheticEvent<NativeInputControlElement>,
    ): void => {
      const input = event.currentTarget;
      props.onNativeValueChange(input.value, selectionCursor(input));
    };

    const handleChange = (
      event: ChangeEvent<NativeInputControlElement>,
    ): void => {
      synchroniseNativeValue(event);
    };

    const handleSelectionChange = (
      event: SyntheticEvent<NativeInputControlElement>,
    ): void => {
      if (composing.current) {
        return;
      }

      props.onMoveCursor(selectionCursor(event.currentTarget));
    };

    const handleCompositionStart = (): void => {
      composing.current = true;
    };

    const handleCompositionEnd = (
      event: CompositionEvent<NativeInputControlElement>,
    ): void => {
      composing.current = false;
      synchroniseNativeValue(event);
    };

    const handlePaste = (
      event: ClipboardEvent<NativeInputControlElement>,
    ): void => {
      event.preventDefault();
      props.onInsertText(event.clipboardData.getData("text"));
    };

    const handleKeyDown = (
      event: KeyboardEvent<NativeInputControlElement>,
    ): void => {
      if (event.nativeEvent.isComposing || composing.current) {
        return;
      }

      const mobileCtrlInput = props.resolveMobileCtrlInput({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
      });
      const input = mobileCtrlInput.input;
      const paneKeyResult = props.onPaneKeyInput(input);

      if (paneKeyResult.kind === "handled") {
        event.preventDefault();
        return;
      }

      if (isControlKey(input, "c")) {
        event.preventDefault();
        props.onCancel();
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        props.onSubmit();
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        props.onDismissCompletion();
        return;
      }

      if (event.key === "Tab") {
        event.preventDefault();
        props.onComplete(event.shiftKey ? "previous" : "next");
        return;
      }

      if (isControlKey(input, "a") || event.key === "Home") {
        event.preventDefault();
        props.onMoveStart();
        return;
      }

      if (isControlKey(input, "e") || event.key === "End") {
        event.preventDefault();
        props.onMoveEnd();
        return;
      }

      if (isControlKey(input, "h")) {
        event.preventDefault();
        props.onBackspace();
        return;
      }

      if (isControlKey(input, "w")) {
        event.preventDefault();
        props.onDeletePreviousWord();
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();

        if (input.ctrlKey) {
          props.onMovePreviousWord();
          return;
        }

        props.onMoveLeft();
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();

        if (input.ctrlKey) {
          props.onMoveNextWord();
          return;
        }

        props.onMoveRight();
        return;
      }

      if (event.key === "ArrowUp" && !input.ctrlKey) {
        event.preventDefault();
        props.onBrowseOlderHistory();
        return;
      }

      if (event.key === "ArrowDown" && !input.ctrlKey) {
        event.preventDefault();
        props.onBrowseNewerHistory();
        return;
      }

      if (event.key === "Backspace") {
        event.preventDefault();
        props.onBackspace();
        return;
      }

      if (event.key === "Delete") {
        event.preventDefault();
        props.onDelete();
        return;
      }

      if (mobileCtrlInput.mobileCtrlApplied) {
        event.preventDefault();
      }
    };

    const sharedControlProps = {
      ref: setInputRef,
      value: props.value,
      onKeyDown: handleKeyDown,
      onChange: handleChange,
      onSelect: handleSelectionChange,
      onCompositionStart: handleCompositionStart,
      onCompositionEnd: handleCompositionEnd,
      onPaste: handlePaste,
      onFocus: props.onFocus,
      className: "sr-only",
      autoCapitalize: "off",
      autoComplete: "off",
      autoCorrect: "off",
      spellCheck: false,
      "aria-label": control.accessibleName,
    };

    if (control.element === "input") {
      return <input {...sharedControlProps} type={control.inputType} />;
    }

    return <textarea {...sharedControlProps} />;
  },
);
