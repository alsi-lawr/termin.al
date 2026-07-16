import type { VimBuffer } from "../../domain/vim/VimBuffer.ts";
import { vimVisualRange } from "../../domain/vim/VimVisualSelection.ts";

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
  switch (buffer.mode.kind) {
    case "normal":
      return "NORMAL";
    case "insert":
      return "INSERT";
    case "visual-character":
      return "VISUAL" + visualBounds(buffer);
    case "visual-line":
      return "VISUAL LINE" + visualBounds(buffer);
    case "visual-block":
      return "VISUAL BLOCK" + visualBounds(buffer);
    case "command":
      return buffer.mode.prompt === ":" ? "COMMAND" : "SEARCH";
  }
}
