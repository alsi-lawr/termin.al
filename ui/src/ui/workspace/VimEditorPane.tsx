import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type ChangeEvent,
  type ClipboardEvent,
  type CompositionEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
  type SyntheticEvent,
  type UIEvent,
} from "react";
import {
  applyNormalVimKey,
  insertVimText,
  isVimVisualMode,
  moveVimInsertCursor,
  moveVimInsertCursorToTextOffset,
  normalVimKeyFromKeyboard,
  replaceVimInsertText,
  vimBufferCursorOffset,
  vimBufferText,
  type VimBuffer,
} from "../../domain/vim/VimBuffer.ts";
import { vimVisualRange } from "../../domain/vim/VimVisualSelection.ts";
import { vimLineStartOffset } from "../../domain/vim/VimMotion.ts";
import {
  applyVimCommandInput,
} from "./VimCommandInput.ts";
import { handleVimEditorPaneCommandInput } from "./VimEditorPaneCommandHandler.ts";
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
import type { MobileCtrlInputResolution } from "./MobileCtrlModifier.ts";
import { vimEditorModeStatus } from "./VimEditorModeStatus.ts";
import { VimEditorBlockSelectionMirror } from "./VimEditorBlockSelectionMirror.tsx";

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
  mobileCtrlPressed: boolean;
  onToggleMobileCtrl: () => void;
  onConsumeMobileCtrl: () => void;
  resolveMobileCtrlInput: (
    input: InputCapturePaneKeyInput,
  ) => MobileCtrlInputResolution;
}>;

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

function bufferStatusLabel(buffer: VimBuffer): string | undefined {
  switch (buffer.status.kind) {
    case "none":
      return undefined;
    case "invalid-input":
      return `Invalid input: ${buffer.status.source}`;
    case "invalid-search":
      return `Invalid pattern: ${buffer.status.query}`;
    case "no-search-match":
      return `Pattern not found: ${buffer.status.query}`;
    case "read-only":
      return `Read-only: ${buffer.status.source}`;
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
  mobileCtrlPressed,
  onToggleMobileCtrl,
  onConsumeMobileCtrl,
  resolveMobileCtrlInput,
}: VimEditorPaneProps): ReactElement {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const mirrorRef = useRef<HTMLDivElement | null>(null);
  const composing = useRef(false);
  const modeStatusId = useId();
  const modeStatus = vimEditorModeStatus(buffer);
  const commandEffect = commandEffectLabel(buffer);
  const bufferStatus = bufferStatusLabel(buffer);

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

    if (buffer.mode.kind === "visual-character") {
      const range = vimVisualRange(buffer.lines, buffer.selection);

      if (range.kind !== "character") {
        throw new Error("Character visual mode requires a character range.");
      }

      const direction = buffer.selection.kind === "character" &&
          (buffer.selection.active.line < buffer.selection.anchor.line ||
            (buffer.selection.active.line === buffer.selection.anchor.line &&
              buffer.selection.active.column < buffer.selection.anchor.column))
        ? "backward"
        : "forward";
      input.setSelectionRange(range.start, range.end, direction);
    } else if (buffer.mode.kind === "visual-line") {
      const range = vimVisualRange(buffer.lines, buffer.selection);

      if (range.kind !== "line") {
        throw new Error("Line visual mode requires a line range.");
      }

      const start = vimLineStartOffset(buffer.lines, range.startLine);
      const end = range.endLine === buffer.lines.length - 1
        ? vimBufferText(buffer).length
        : vimLineStartOffset(buffer.lines, range.endLine + 1);
      const direction = buffer.selection.kind === "line" &&
          buffer.selection.activeLine < buffer.selection.anchorLine
        ? "backward"
        : "forward";
      input.setSelectionRange(start, end, direction);
    } else {
      input.setSelectionRange(cursor, cursor);
    }

    const mirror = mirrorRef.current;

    if (mirror !== null) {
      mirror.scrollTop = input.scrollTop;
      mirror.scrollLeft = input.scrollLeft;
    }
  }, [buffer]);

  const handleScroll = (event: UIEvent<HTMLTextAreaElement>): void => {
    const mirror = mirrorRef.current;

    if (mirror === null) {
      return;
    }

    mirror.scrollTop = event.currentTarget.scrollTop;
    mirror.scrollLeft = event.currentTarget.scrollLeft;
  };

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

    if (buffer.mode.kind === "command" || buffer.mode.kind === "search") {
      onBufferChange(
        applyVimCommandInput(buffer, {
          kind: "text",
          text: event.data,
        }),
      );
      return;
    }

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

  const handlePaste = (
    event: ClipboardEvent<HTMLTextAreaElement>,
  ): void => {
    if (
      buffer.capability.kind === "read-only" &&
      buffer.mode.kind !== "command" &&
      buffer.mode.kind !== "search"
    ) {
      event.preventDefault();
      onBufferChange(applyNormalVimKey(buffer, { kind: "paste-after" }));
      return;
    }

    if (buffer.mode.kind !== "command" && buffer.mode.kind !== "search") {
      return;
    }

    handleVimEditorPaneCommandInput({
      buffer,
      input: { kind: "paste", text: event.clipboardData.getData("text") },
      onBufferChange,
      onPaneKeyInput,
      preventDefault: () => {
        event.preventDefault();
      },
    });
  };

  const handleBeforeInput = (event: FormEvent<HTMLTextAreaElement>): void => {
    if (buffer.mode.kind !== "insert" && !composing.current) {
      event.preventDefault();
    }
  };

  const handleNormalKey = (
    event: KeyboardEvent<HTMLTextAreaElement>,
    input: InputCapturePaneKeyInput,
  ): void => {
    event.preventDefault();
    const key = normalVimKeyFromKeyboard(
      input.key,
      input.ctrlKey,
      input.metaKey,
    );

    if (key.kind === "recognized") {
      onBufferChange(applyNormalVimKey(buffer, key.key));
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.nativeEvent.isComposing || composing.current) {
      return;
    }

    const mobileCtrlInput = resolveMobileCtrlInput({
      key: event.key,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
    });
    const input = mobileCtrlInput.input;

    if (buffer.mode.kind === "command" || buffer.mode.kind === "search") {
      handleVimEditorPaneCommandInput({
        buffer,
        input: {
          kind: "keydown",
          key: input.key,
          ctrlKey: input.ctrlKey,
          metaKey: input.metaKey,
        },
        onBufferChange,
        onPaneKeyInput,
        preventDefault: () => {
          event.preventDefault();
        },
      });
      return;
    }

    const paneKeyResult = onPaneKeyInput(input);

    if (paneKeyResult.kind === "handled") {
      event.preventDefault();
      return;
    }

    if (buffer.mode.kind === "normal" || isVimVisualMode(buffer.mode)) {
      handleNormalKey(event, input);
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
      return;
    }

    if (mobileCtrlInput.mobileCtrlApplied) {
      event.preventDefault();
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
        if (buffer.mode.kind === "command" || buffer.mode.kind === "search") {
          onBufferChange(
            applyVimCommandInput(buffer, { kind: "text", text: "\t" }),
          );
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

        if (buffer.mode.kind === "normal" || isVimVisualMode(buffer.mode)) {
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
      className="flex h-full min-h-0 flex-col bg-surface-deepest font-mono text-sm text-text-primary"
      aria-label={title + " editor"}
      onFocus={onActivate}
    >
      <div className="flex min-h-0 flex-1 flex-col p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="font-semibold text-ui-accent">{title}</h2>
          <span
            id={modeStatusId}
            className="text-text-muted"
            role="status"
            aria-live="polite"
          >
            {modeStatus}
          </span>
        </div>
        <div className="relative flex min-h-0 flex-1">
          {buffer.mode.kind === "visual-block" ? (
            <VimEditorBlockSelectionMirror
              buffer={buffer}
              mirrorRef={mirrorRef}
            />
          ) : null}
          <textarea
            ref={inputRef}
            className={buffer.mode.kind === "visual-block"
              ? "relative min-h-0 flex-1 resize-none rounded border border-surface-border bg-transparent p-2 font-mono text-sm leading-normal text-text-primary outline-none focus:border-ui-focus"
              : "relative min-h-0 flex-1 resize-none rounded border border-surface-border bg-surface-deepest p-2 font-mono text-sm leading-normal text-text-primary outline-none focus:border-ui-focus"}
            value={vimBufferText(buffer)}
            aria-readonly={buffer.capability.kind === "read-only"}
            aria-label={title + " editor text"}
            aria-describedby={modeStatusId}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            onBeforeInput={handleBeforeInput}
            onChange={handleChange}
            onSelect={handleSelect}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            onPaste={handlePaste}
            onKeyDown={handleKeyDown}
            onScroll={handleScroll}
            onFocus={onActivate}
          />
        </div>
        {buffer.mode.kind === "command" || buffer.mode.kind === "search" ? (
          <div className="mt-2 text-text-bright" role="status" aria-live="polite">
            {buffer.mode.kind === "command" ? ":" : buffer.mode.prompt}
            {buffer.mode.input}
          </div>
        ) : null}
        {commandEffect === undefined ? null : (
          <div className="mt-2 text-text-muted" role="status" aria-live="polite">
            {commandEffect}
          </div>
        )}
        {bufferStatus === undefined ? null : (
          <div className="mt-2 text-text-muted" role="status" aria-live="polite">
            {bufferStatus}
          </div>
        )}
      </div>
      <MobilePaneControls
        ctrlPressed={mobileCtrlPressed}
        onCtrlToggle={onToggleMobileCtrl}
        onCtrlConsumed={onConsumeMobileCtrl}
        onControl={handleMobileControl}
        onPrefix={handleMobilePrefix}
      />
    </section>
  );
}
