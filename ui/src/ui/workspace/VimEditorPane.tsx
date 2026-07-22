import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type CompositionEvent,
  type DragEvent,
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
  replaceVimCommandInput,
  replaceVimInsertText,
  vimBufferCursorOffset,
  vimBufferText,
  vimCommandPreview,
  type VimBuffer,
  type VimCommandEffect,
} from "../../domain/vim/VimBuffer.ts";
import { vimVisualRange } from "../../domain/vim/VimVisualSelection.ts";
import { vimLineStartOffset } from "../../domain/vim/VimMotion.ts";
import {
  applyVimCommandInput,
  type VimCommandInput,
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
import {
  vimEditorModePresentation,
  vimEditorModeStatus,
  vimEditorStatusLine,
} from "./VimEditorModeStatus.ts";
import { VimEditorBlockSelectionMirror } from "./VimEditorBlockSelectionMirror.tsx";
import { VimEditorHighlightLayer } from "./VimEditorHighlightLayer.tsx";
import { routeEditorAssetFiles } from "./EditorAssetFiles.ts";
import {
  emptyVimSessionListing,
  initialVimHistoryNavigation,
  navigateVimHistory,
  recordVimSubmission,
  vimCommandEffectMessage,
  vimHistory,
  vimSessionListing,
  vimStatusMessage,
  type VimHistoryDirection,
  type VimHistoryNavigation,
  type VimSessionBinding,
  type VimSessionListing,
} from "./VimSessionState.ts";

type VimEditorSyntax =
  | Readonly<{ kind: "markdown" }>
  | Readonly<{ kind: "plain" }>;

type VimEditorPaneProps = Readonly<{
  title: string;
  buffer: VimBuffer;
  syntax: VimEditorSyntax;
  isActive: boolean;
  focusVersion: number;
  onBufferChange: (buffer: VimBuffer) => void;
  onCommandEffect?: (effect: VimCommandEffect, buffer: VimBuffer) => void;
  onAssetFiles?: (files: ReadonlyArray<File>) => void;
  externalMessage?: string;
  onActivate: () => void;
  onPaneKeyInput: (
    input: InputCapturePaneKeyInput,
  ) => InputCapturePaneKeyResult;
  mobileCtrlPressed: boolean;
  vimSession: VimSessionBinding;
  onToggleMobileCtrl: () => void;
  onConsumeMobileCtrl: () => void;
  resolveMobileCtrlInput: (
    input: InputCapturePaneKeyInput,
  ) => MobileCtrlInputResolution;
}>;

function editorTextareaClass(
  mode: VimBuffer["mode"]["kind"],
  compositionActive: boolean,
): string {
  if (compositionActive) {
    return "relative min-h-0 flex-1 resize-none rounded border border-surface-border bg-transparent p-2 font-mono text-sm leading-normal whitespace-pre-wrap break-words text-text-primary outline-none focus:border-ui-focus";
  }

  if (mode === "command" || mode === "search") {
    return "relative min-h-0 flex-1 resize-none rounded border border-surface-border bg-transparent p-2 font-mono text-sm leading-normal whitespace-pre-wrap break-words text-transparent caret-transparent outline-none selection:bg-surface-selected selection:text-text-primary focus:border-ui-focus";
  }

  return "relative min-h-0 flex-1 resize-none rounded border border-surface-border bg-transparent p-2 font-mono text-sm leading-normal whitespace-pre-wrap break-words text-transparent caret-ui-cursor outline-none selection:bg-surface-selected selection:text-text-primary focus:border-ui-focus";
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
  syntax,
  isActive,
  focusVersion,
  onBufferChange,
  onCommandEffect,
  onAssetFiles,
  externalMessage,
  onActivate,
  onPaneKeyInput,
  mobileCtrlPressed,
  vimSession,
  onToggleMobileCtrl,
  onConsumeMobileCtrl,
  resolveMobileCtrlInput,
}: VimEditorPaneProps): ReactElement {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const assetInputRef = useRef<HTMLInputElement | null>(null);
  const highlightLayerRef = useRef<HTMLDivElement | null>(null);
  const mirrorRef = useRef<HTMLDivElement | null>(null);
  const composing = useRef(false);
  const [compositionActive, setCompositionActive] = useState(false);
  const [historyNavigation, setHistoryNavigation] =
    useState<VimHistoryNavigation>(initialVimHistoryNavigation);
  const [listing, setListing] =
    useState<VimSessionListing>(emptyVimSessionListing);
  const modeStatusId = useId();
  const modeStatus = vimEditorModeStatus(buffer);
  const modePresentation = vimEditorModePresentation(buffer.mode);
  const statusLine = vimEditorStatusLine(buffer, title);
  const commandEffect = vimCommandEffectMessage(buffer.commandEffect);
  const bufferStatus = vimStatusMessage(buffer.status);
  const source = vimBufferText(buffer);
  const preview = vimCommandPreview(buffer);
  const textareaClass = editorTextareaClass(buffer.mode.kind, compositionActive);

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

    const highlightLayer = highlightLayerRef.current;

    if (highlightLayer !== null) {
      highlightLayer.scrollTop = input.scrollTop;
      highlightLayer.scrollLeft = input.scrollLeft;
    }

    const mirror = mirrorRef.current;

    if (mirror !== null) {
      mirror.scrollTop = input.scrollTop;
      mirror.scrollLeft = input.scrollLeft;
    }
  }, [buffer]);

  const handleScroll = (event: UIEvent<HTMLTextAreaElement>): void => {
    const highlightLayer = highlightLayerRef.current;

    if (highlightLayer !== null) {
      highlightLayer.scrollTop = event.currentTarget.scrollTop;
      highlightLayer.scrollLeft = event.currentTarget.scrollLeft;
    }

    const mirror = mirrorRef.current;

    if (mirror === null) {
      return;
    }

    mirror.scrollTop = event.currentTarget.scrollTop;
    mirror.scrollLeft = event.currentTarget.scrollLeft;
  };

  const applyEditorBuffer = (next: VimBuffer): void => {
    setHistoryNavigation(initialVimHistoryNavigation);
    setListing(emptyVimSessionListing);
    onBufferChange(next);
  };

  const handleCommandInput = (input: VimCommandInput): void => {
    if (
      input.kind === "submit" &&
      (buffer.mode.kind === "command" || buffer.mode.kind === "search")
    ) {
      const history = buffer.mode.kind;
      const source = buffer.mode.input;
      const next = applyVimCommandInput(buffer, input);
      const nextSession = recordVimSubmission(vimSession.state, {
        history,
        source,
        previous: buffer,
        next,
      });
      setHistoryNavigation(initialVimHistoryNavigation);
      setListing(vimSessionListing(nextSession, next.commandEffect));
      vimSession.onStateChange(nextSession);
      onBufferChange(next);
      if (next.commandEffect.kind !== "none") onCommandEffect?.(next.commandEffect, next);
      if (next.commandEffect.kind === "asset" && onAssetFiles !== undefined) assetInputRef.current?.click();
      return;
    }

    setHistoryNavigation(initialVimHistoryNavigation);
    setListing(emptyVimSessionListing);
    onBufferChange(applyVimCommandInput(buffer, input));
  };

  const handleHistory = (direction: VimHistoryDirection): void => {
    if (buffer.mode.kind !== "command" && buffer.mode.kind !== "search") {
      return;
    }

    const transition = navigateVimHistory(
      vimHistory(vimSession.state, buffer.mode.kind),
      buffer.mode.input,
      historyNavigation,
      direction,
    );
    setHistoryNavigation(transition.navigation);
    setListing(emptyVimSessionListing);
    onBufferChange(replaceVimCommandInput(buffer, transition.input));
  };

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    if (buffer.mode.kind !== "insert") {
      return;
    }

    applyEditorBuffer(
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

    applyEditorBuffer(
      moveVimInsertCursorToTextOffset(
        buffer,
        event.currentTarget.selectionEnd,
      ),
    );
  };

  const handleCompositionStart = (): void => {
    composing.current = true;
    setCompositionActive(true);
  };

  const handleCompositionEnd = (
    event: CompositionEvent<HTMLTextAreaElement>,
  ): void => {
    composing.current = false;
    setCompositionActive(false);

    if (buffer.mode.kind === "command" || buffer.mode.kind === "search") {
      handleCommandInput({ kind: "text", text: event.data });
      return;
    }

    if (buffer.mode.kind === "insert") {
      applyEditorBuffer(
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
    if (routeEditorAssetFiles(Array.from(event.clipboardData.files), onAssetFiles, () => { event.preventDefault(); })) {
      return;
    }
    if (buffer.mode.kind === "normal" || isVimVisualMode(buffer.mode)) {
      event.preventDefault();
      applyEditorBuffer(applyNormalVimKey(buffer, { kind: "paste-after" }));
      return;
    }

    if (buffer.mode.kind !== "command" && buffer.mode.kind !== "search") {
      return;
    }

    handleVimEditorPaneCommandInput({
      input: { kind: "paste", text: event.clipboardData.getData("text") },
      onCommandInput: handleCommandInput,
      onHistory: handleHistory,
      onPaneKeyInput,
      preventDefault: () => {
        event.preventDefault();
      },
    });
  };

  const handleDrop = (event: DragEvent<HTMLTextAreaElement>): void => {
    routeEditorAssetFiles(Array.from(event.dataTransfer.files), onAssetFiles, () => { event.preventDefault(); });
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
      applyEditorBuffer(applyNormalVimKey(buffer, key.key));
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
        input: {
          kind: "keydown",
          key: input.key,
          ctrlKey: input.ctrlKey,
          metaKey: input.metaKey,
        },
        onCommandInput: handleCommandInput,
        onHistory: handleHistory,
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
      applyEditorBuffer(applyNormalVimKey(buffer, { kind: "escape" }));
      return;
    }

    if (event.key === "Tab") {
      event.preventDefault();
      applyEditorBuffer(insertVimText(buffer, "\t"));
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
        <span
          id={modeStatusId}
          className="sr-only"
          role="status"
          aria-live="polite"
        >
          {modeStatus}
        </span>
        <div className="relative flex min-h-0 flex-1">
          <VimEditorHighlightLayer
            preview={preview}
            syntax={syntax.kind}
            layerRef={highlightLayerRef}
          />
          {buffer.mode.kind === "visual-block" ? (
            <VimEditorBlockSelectionMirror
              buffer={buffer}
              mirrorRef={mirrorRef}
            />
          ) : null}
          <textarea
            ref={inputRef}
            className={textareaClass}
            value={source}
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
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes("Files") && onAssetFiles !== undefined) event.preventDefault();
            }}
            onDrop={handleDrop}
            onKeyDown={handleKeyDown}
            onScroll={handleScroll}
            onFocus={onActivate}
          />
          {onAssetFiles === undefined ? null : (
            <input
              ref={assetInputRef}
              className="sr-only"
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif"
              aria-label={title + " staged asset files"}
              onChange={(event) => {
                routeEditorAssetFiles(Array.from(event.currentTarget.files ?? []), onAssetFiles, () => {});
                event.currentTarget.value = "";
              }}
            />
          )}
        </div>
        <div className="mt-2 flex min-w-0 shrink-0 items-center bg-surface-raised text-xs text-text-muted">
          <span className={modePresentation.className}>
            {statusLine.mode}
          </span>
          <span className="min-w-0 flex-1 truncate px-2" title={statusLine.title}>
            {statusLine.title}
          </span>
          <span className="shrink-0 whitespace-nowrap px-2">
            {statusLine.position} {statusLine.progress}
          </span>
        </div>
        {buffer.mode.kind === "command" || buffer.mode.kind === "search" ? (
          <div className="mt-2 text-text-bright" role="status" aria-live="polite">
            {buffer.mode.kind === "command" ? ":" : buffer.mode.prompt}
            {buffer.mode.input}
          </div>
        ) : null}
        {listing.kind === "none" ? null : (
          <div className="mt-2 whitespace-pre-wrap text-text-muted" role="status" aria-live="polite">
            {listing.lines.join("\n")}
          </div>
        )}
        {commandEffect.kind === "none" ? null : (
          <div className="mt-2 text-text-muted" role="status" aria-live="polite">
            {commandEffect.message.text}
          </div>
        )}
        {bufferStatus.kind === "none" ? null : (
          <div className="mt-2 text-text-muted" role="status" aria-live="polite">
            {bufferStatus.message.text}
          </div>
        )}
        {externalMessage === undefined ? null : (
          <div className="mt-2 text-text-muted" role="status" aria-live="polite">{externalMessage}</div>
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
