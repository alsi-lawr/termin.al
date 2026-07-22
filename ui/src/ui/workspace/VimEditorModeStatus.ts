import {
  isVimBufferDirty,
  type VimBuffer,
  type VimMode,
} from "../../domain/vim/VimBuffer.ts";
import { vimVisualRange } from "../../domain/vim/VimVisualSelection.ts";

type VimEditorModeLabel =
  | "NORMAL"
  | "INSERT"
  | "VISUAL"
  | "VISUAL LINE"
  | "VISUAL BLOCK"
  | "COMMAND"
  | "SEARCH";

type VimEditorModePresentation = Readonly<{
  label: VimEditorModeLabel;
  className: string;
}>;

type VimEditorStatusLine = Readonly<{
  mode: VimEditorModeLabel;
  title: string;
  position: string;
  progress: string;
}>;

const modePresentations = {
  normal: { label: "NORMAL", className: "shrink-0 whitespace-nowrap bg-surface-muted px-2 py-1 font-semibold text-text-bright" },
  insert: { label: "INSERT", className: "shrink-0 whitespace-nowrap bg-surface-addition px-2 py-1 font-semibold text-text-bright" },
  "visual-character": { label: "VISUAL", className: "shrink-0 whitespace-nowrap bg-surface-selected px-2 py-1 font-semibold text-text-bright" },
  "visual-line": { label: "VISUAL LINE", className: "shrink-0 whitespace-nowrap bg-surface-selected px-2 py-1 font-semibold text-text-bright" },
  "visual-block": { label: "VISUAL BLOCK", className: "shrink-0 whitespace-nowrap bg-surface-selected px-2 py-1 font-semibold text-text-bright" },
  command: { label: "COMMAND", className: "shrink-0 whitespace-nowrap bg-surface-dark px-2 py-1 font-semibold text-text-bright" },
  search: { label: "SEARCH", className: "shrink-0 whitespace-nowrap bg-ui-search px-2 py-1 font-semibold text-text-on-accent" },
} as const satisfies Readonly<Record<VimMode["kind"], VimEditorModePresentation>>;

export function vimEditorModePresentation(
  mode: VimMode,
): VimEditorModePresentation {
  return modePresentations[mode.kind];
}

function visualBounds(buffer: VimBuffer): string {
  const range = vimVisualRange(buffer.lines, buffer.selection);

  switch (range.kind) {
    case "character":
      if (buffer.selection.kind !== "character") {
        throw new Error("Character visual status requires character bounds.");
      }

      const anchor = buffer.selection.anchor;
      const active = buffer.selection.active;
      const anchorFirst = anchor.line < active.line ||
        (anchor.line === active.line && anchor.column <= active.column);
      const start = anchorFirst ? anchor : active;
      const end = anchorFirst ? active : anchor;

      return `, line ${start.line + 1} column ${start.column + 1} through line ${end.line + 1} column ${end.column + 1}`;
    case "line":
      return `, lines ${range.startLine + 1} through ${range.endLine + 1}`;
    case "block":
      return `, lines ${range.startLine + 1} through ${range.endLine + 1}, columns ${range.startColumn + 1} through ${range.endColumn}`;
  }
}

export function vimEditorModeStatus(buffer: VimBuffer): string {
  const mode = vimEditorModePresentation(buffer.mode);

  switch (buffer.mode.kind) {
    case "visual-character":
      return mode.label + visualBounds(buffer);
    case "visual-line":
      return mode.label + visualBounds(buffer);
    case "visual-block":
      return mode.label + visualBounds(buffer);
    case "normal":
    case "insert":
    case "command":
    case "search":
      return mode.label;
  }
}

export function vimEditorStatusLine(
  buffer: VimBuffer,
  title: string,
): VimEditorStatusLine {
  const marker = (() => {
    if (buffer.capability.kind === "read-only") {
      return " [RO]";
    }

    return isVimBufferDirty(buffer) ? " [+]" : "";
  })();
  const progress = buffer.lines.length === 1
    ? 100
    : Math.round(buffer.cursor.line / (buffer.lines.length - 1) * 100);

  return {
    mode: vimEditorModePresentation(buffer.mode).label,
    title: title + marker,
    position: `${buffer.cursor.line + 1}:${buffer.cursor.column + 1}`,
    progress: `${progress}%`,
  };
}
