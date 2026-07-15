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
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
  type SyntheticEvent,
} from "react";
import {
  normalVimPromptKeyFromKeyboard,
  type VimPromptKey,
  type VimPromptMode,
} from "../../domain/vim/VimBuffer.ts";
import {
  moveNativeInputSelectionLeft,
  moveNativeInputSelectionRight,
  normalizeNativeInputSelection,
} from "./UnicodeUiBoundary.ts";
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
  mode: VimPromptMode;
  promptKind: InputCapturePromptKind;
  isActive: boolean;
  focusVersion: number;
  onNativeValueChange: (value: string, cursor: number) => void;
  onMoveCursor: (cursor: number) => void;
  onInsertText: (text: string) => void;
  onNormalKey: (key: VimPromptKey) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onComplete: () => void;
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
      if (props.mode.kind !== "insert") {
        return;
      }

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
      if (props.mode.kind !== "insert" || composing.current) {
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

    const handleBeforeInput = (
      event: FormEvent<NativeInputControlElement>,
    ): void => {
      if (props.mode.kind === "normal" && !composing.current) {
        event.preventDefault();
      }
    };

    const handlePaste = (
      event: ClipboardEvent<NativeInputControlElement>,
    ): void => {
      if (props.mode.kind !== "insert") {
        event.preventDefault();
        return;
      }

      event.preventDefault();
      props.onInsertText(event.clipboardData.getData("text"));
    };

    const handleNormalKey = (input: InputCapturePaneKeyInput): void => {
      const match = normalVimPromptKeyFromKeyboard(
        input.key,
        input.ctrlKey,
        input.metaKey,
      );

      if (match.kind === "recognized") {
        props.onNormalKey(match.key);
      }
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

      if (input.ctrlKey && input.key.toLowerCase() === "c") {
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
        handleNormalKey(input);
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        handleNormalKey(input);
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
      onBeforeInput: handleBeforeInput,
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
