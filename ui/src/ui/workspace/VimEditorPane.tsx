import {
  useEffect,
  useLayoutEffect,
  useRef,
  type ChangeEvent,
  type CompositionEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
  type SyntheticEvent,
} from "react";
import {
  appendVimCommandInput,
  applyNormalVimKey,
  backspaceVimCommandInput,
  insertVimText,
  moveVimInsertCursor,
  moveVimInsertCursorToTextOffset,
  normalVimKeyFromKeyboard,
  replaceVimInsertText,
  submitVimCommand,
  vimBufferCursorOffset,
  vimBufferText,
  type VimBuffer,
} from "../../domain/vim/VimBuffer.ts";
import {
  nextUnicodeCursorOffset,
  previousUnicodeCursorOffset,
} from "../../domain/terminal/UnicodeCursor.ts";
import type {
  InputCapturePaneKeyInput,
  InputCapturePaneKeyResult,
} from "../terminal/InputCapture";
import {
  MobilePaneControls,
  type MobilePaneControl,
} from "./MobilePaneControls";

type VimEditorPaneProps = Readonly<{
  title: string;
  buffer: VimBuffer;
  isActive: boolean;
  focusVersion: number;
  onBufferChange: (buffer: VimBuffer) => void;
  onActivate: () => void;
  onPaneKeyInput: (
    input: InputCapturePaneKeyInput,
  ) => InputCapturePaneKeyResult;
}>;

function modeLabel(buffer: VimBuffer): string {
  switch (buffer.mode.kind) {
    case "normal":
      return "NORMAL";
    case "insert":
      return "INSERT";
    case "visual":
      return "VISUAL LINE";
    case "command":
      return buffer.mode.prompt === ":" ? "COMMAND" : "SEARCH";
  }
}

function commandEffectLabel(buffer: VimBuffer): string | undefined {
  switch (buffer.commandEffect.kind) {
    case "none":
      return undefined;
    case "write":
      return "Write requested";
    case "quit":
      return "Quit requested";
    case "force-quit":
      return "Force quit requested";
    case "unrecognized-command":
      return "Unknown command";
  }
}

function moveInsertCursorForMobile(
  buffer: VimBuffer,
  control: Extract<MobilePaneControl, "left" | "right" | "up" | "down">,
): VimBuffer {
  const line = buffer.lines[buffer.cursor.line];

  if (line === undefined) {
    throw new Error("Vim editor cursors must reference an existing line.");
  }

  switch (control) {
    case "left":
      return moveVimInsertCursor(buffer, {
        line: buffer.cursor.line,
        column: previousUnicodeCursorOffset(line, buffer.cursor.column),
      });
    case "right":
      return moveVimInsertCursor(buffer, {
        line: buffer.cursor.line,
        column: nextUnicodeCursorOffset(line, buffer.cursor.column),
      });
    case "up": {
      const targetLine = Math.max(0, buffer.cursor.line - 1);
      const target = buffer.lines[targetLine];

      if (target === undefined) {
        throw new Error("Vim editor cursors must reference an existing line.");
      }

      return moveVimInsertCursor(buffer, {
        line: targetLine,
        column: Math.min(target.length, buffer.cursor.column),
      });
    }
    case "down": {
      const targetLine = Math.min(
        buffer.lines.length - 1,
        buffer.cursor.line + 1,
      );
      const target = buffer.lines[targetLine];

      if (target === undefined) {
        throw new Error("Vim editor cursors must reference an existing line.");
      }

      return moveVimInsertCursor(buffer, {
        line: targetLine,
        column: Math.min(target.length, buffer.cursor.column),
      });
    }
  }
}

export function VimEditorPane({
  title,
  buffer,
  isActive,
  focusVersion,
  onBufferChange,
  onActivate,
  onPaneKeyInput,
}: VimEditorPaneProps): ReactElement {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const composing = useRef(false);
  const commandEffect = commandEffectLabel(buffer);

  useEffect(() => {
    if (isActive) {
      inputRef.current?.focus({ preventScroll: true });
    }
  }, [focusVersion, isActive]);

  useLayoutEffect(() => {
    const input = inputRef.current;

    if (input === null || composing.current) {
      return;
    }

    const cursor = vimBufferCursorOffset(buffer);
    input.setSelectionRange(cursor, cursor);
  }, [buffer]);

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    if (buffer.mode.kind !== "insert") {
      return;
    }

    onBufferChange(
      replaceVimInsertText(
        buffer,
        event.currentTarget.value,
        event.currentTarget.selectionEnd,
      ),
    );
  };

  const handleSelect = (event: SyntheticEvent<HTMLTextAreaElement>): void => {
    if (buffer.mode.kind !== "insert" || composing.current) {
      return;
    }

    onBufferChange(
      moveVimInsertCursorToTextOffset(
        buffer,
        event.currentTarget.selectionEnd,
      ),
    );
  };

  const handleCompositionStart = (): void => {
    composing.current = true;
  };

  const handleCompositionEnd = (
    event: CompositionEvent<HTMLTextAreaElement>,
  ): void => {
    composing.current = false;

    if (buffer.mode.kind === "insert") {
      onBufferChange(
        replaceVimInsertText(
          buffer,
          event.currentTarget.value,
          event.currentTarget.selectionEnd,
        ),
      );
    }
  };

  const handleBeforeInput = (event: FormEvent<HTMLTextAreaElement>): void => {
    if (buffer.mode.kind !== "insert" && !composing.current) {
      event.preventDefault();
    }
  };

  const handleCommandKey = (
    event: KeyboardEvent<HTMLTextAreaElement>,
  ): void => {
    event.preventDefault();

    switch (event.key) {
      case "Escape":
        onBufferChange(applyNormalVimKey(buffer, { kind: "escape" }));
        return;
      case "Enter":
        onBufferChange(submitVimCommand(buffer));
        return;
      case "Backspace":
        onBufferChange(backspaceVimCommandInput(buffer));
        return;
      default:
        if (
          event.key.length === 1 &&
          !event.ctrlKey &&
          !event.metaKey
        ) {
          onBufferChange(appendVimCommandInput(buffer, event.key));
        }
    }
  };

  const handleNormalKey = (
    event: KeyboardEvent<HTMLTextAreaElement>,
  ): void => {
    event.preventDefault();
    const key = normalVimKeyFromKeyboard(
      event.key,
      event.ctrlKey,
      event.metaKey,
    );

    if (key.kind === "recognized") {
      onBufferChange(applyNormalVimKey(buffer, key.key));
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.nativeEvent.isComposing || composing.current) {
      return;
    }

    const paneKeyResult = onPaneKeyInput({
      key: event.key,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
    });

    if (paneKeyResult.kind === "handled") {
      event.preventDefault();
      return;
    }

    if (buffer.mode.kind === "command") {
      handleCommandKey(event);
      return;
    }

    if (buffer.mode.kind === "normal" || buffer.mode.kind === "visual") {
      handleNormalKey(event);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      onBufferChange(applyNormalVimKey(buffer, { kind: "escape" }));
      return;
    }

    if (event.key === "Tab") {
      event.preventDefault();
      onBufferChange(insertVimText(buffer, "\t"));
    }
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
        onBufferChange(applyNormalVimKey(buffer, { kind: "escape" }));
        return;
      case "tab":
        if (buffer.mode.kind === "command") {
          onBufferChange(appendVimCommandInput(buffer, "\t"));
          return;
        }

        onBufferChange(insertVimText(buffer, "\t"));
        return;
      case "left":
      case "right":
      case "up":
      case "down":
        if (buffer.mode.kind === "insert") {
          onBufferChange(moveInsertCursorForMobile(buffer, control));
          return;
        }

        if (buffer.mode.kind === "normal" || buffer.mode.kind === "visual") {
          const key = normalVimKeyFromKeyboard(
            {
              left: "ArrowLeft",
              right: "ArrowRight",
              up: "ArrowUp",
              down: "ArrowDown",
            }[control],
            false,
            false,
          );

          if (key.kind === "recognized") {
            onBufferChange(applyNormalVimKey(buffer, key.key));
          }
        }
    }
  };

  const handleMobilePrefix = (): void => {
    onPaneKeyInput({
      key: "b",
      ctrlKey: true,
      metaKey: false,
    });
  };

  return (
    <section
      className="flex h-full min-h-0 flex-col rounded-md bg-neutral-950 font-mono text-sm text-neutral-100"
      aria-label={title + " editor"}
      onFocus={onActivate}
    >
      <div className="flex min-h-0 flex-1 flex-col p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="font-semibold text-green-400">{title}</h2>
          <span className="text-neutral-500">{modeLabel(buffer)}</span>
        </div>
        <textarea
          ref={inputRef}
          className="min-h-0 flex-1 resize-none rounded border border-neutral-800 bg-neutral-950 p-2 text-neutral-100 outline-none focus:border-green-500"
          value={vimBufferText(buffer)}
          aria-label={title + " editor text"}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onBeforeInput={handleBeforeInput}
          onChange={handleChange}
          onSelect={handleSelect}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          onKeyDown={handleKeyDown}
          onFocus={onActivate}
        />
        {buffer.mode.kind === "command" ? (
          <div className="mt-2 text-neutral-300" role="status" aria-live="polite">
            {buffer.mode.prompt}
            {buffer.mode.input}
          </div>
        ) : null}
        {commandEffect === undefined ? null : (
          <div className="mt-2 text-neutral-500" role="status" aria-live="polite">
            {commandEffect}
          </div>
        )}
      </div>
      <MobilePaneControls
        onControl={handleMobileControl}
        onPrefix={handleMobilePrefix}
      />
    </section>
  );
}
