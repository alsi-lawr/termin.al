import {
  isVimBufferDirty,
  type VimBuffer,
  type VimMode,
} from "../../domain/vim/VimBuffer.ts";
import { vimVisualRange } from "../../domain/vim/VimVisualSelection.ts";

type VimEditorStatusLine = Readonly<{
  mode:
    | "NORMAL"
    | "INSERT"
    | "VISUAL"
    | "VISUAL LINE"
    | "VISUAL BLOCK"
    | "COMMAND"
    | "SEARCH";
  title: string;
  position: string;
  progress: string;
}>;

function modeLabel(mode: VimMode): VimEditorStatusLine["mode"] {
  switch (mode.kind) {
    case "normal":
      return "NORMAL";
    case "insert":
      return "INSERT";
    case "visual-character":
      return "VISUAL";
    case "visual-line":
      return "VISUAL LINE";
    case "visual-block":
      return "VISUAL BLOCK";
    case "command":
      return "COMMAND";
    case "search":
      return "SEARCH";
  }
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
  const label = modeLabel(buffer.mode);

  switch (buffer.mode.kind) {
    case "visual-character":
      return label + visualBounds(buffer);
    case "visual-line":
      return label + visualBounds(buffer);
    case "visual-block":
      return label + visualBounds(buffer);
    case "normal":
    case "insert":
    case "command":
    case "search":
      return label;
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
    mode: modeLabel(buffer.mode),
    title: title + marker,
    position: `${buffer.cursor.line + 1}:${buffer.cursor.column + 1}`,
    progress: `${progress}%`,
  };
}
