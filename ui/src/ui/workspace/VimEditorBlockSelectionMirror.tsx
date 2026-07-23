import type { ReactElement, RefObject } from "react";
import type { VimBuffer } from "../../domain/vim/VimBuffer.ts";
import { vimEditorBlockMirrorLines } from "./VimEditorBlockSelectionMirrorData.ts";

type VimEditorBlockSelectionMirrorProps = Readonly<{
  buffer: VimBuffer;
  mirrorRef: RefObject<HTMLDivElement | null>;
}>;

export function VimEditorBlockSelectionMirror({
  buffer,
  mirrorRef,
}: VimEditorBlockSelectionMirrorProps): ReactElement {
  const lines = vimEditorBlockMirrorLines(buffer);

  return (
    <div
      ref={mirrorRef}
      className="pointer-events-none absolute inset-0 overflow-hidden rounded border border-transparent p-2 font-mono text-sm leading-normal whitespace-pre-wrap break-words text-transparent [scrollbar-gutter:stable]"
      aria-hidden="true"
    >
      {lines.map((line, lineIndex) => (
        <span key={`logical-line-${line.lineNumber}`}>
          {line.prefix}
          {line.selected.length === 0 ? null : (
            <span className="bg-surface-selected text-transparent">
              {line.selected}
            </span>
          )}
          {line.suffix}
          {lineIndex === lines.length - 1 ? null : "\n"}
        </span>
      ))}
    </div>
  );
}
