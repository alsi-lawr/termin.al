import { normalizeUnicodeCursorOffset } from "../../domain/terminal/UnicodeCursor.ts";
import type { VimBuffer } from "../../domain/vim/VimBuffer.ts";
import { vimVisualRange } from "../../domain/vim/VimVisualSelection.ts";

export type VimEditorBlockMirrorLine = Readonly<{
  lineNumber: number;
  prefix: string;
  selected: string;
  suffix: string;
}>;

export function vimEditorBlockMirrorLines(
  buffer: VimBuffer,
): ReadonlyArray<VimEditorBlockMirrorLine> {
  const range = vimVisualRange(buffer.lines, buffer.selection);

  if (range.kind !== "block") {
    return [];
  }

  return buffer.lines.map((line, lineNumber) => {
    if (lineNumber < range.startLine || lineNumber > range.endLine) {
      return { lineNumber, prefix: line, selected: "", suffix: "" };
    }

    const start = normalizeUnicodeCursorOffset(
      line,
      Math.min(line.length, range.startColumn),
    );
    const end = normalizeUnicodeCursorOffset(
      line,
      Math.min(line.length, range.endColumn),
    );
    const virtualPrefix = " ".repeat(Math.max(0, range.startColumn - line.length));
    const availableSelection = line.slice(start, Math.max(start, end));
    const selected = availableSelection.padEnd(
      range.endColumn - range.startColumn,
      " ",
    );

    return {
      lineNumber,
      prefix: line.slice(0, start) + virtualPrefix,
      selected,
      suffix: line.slice(Math.max(start, end)),
    };
  });
}
