import { useEffect, useState, type ReactElement, type RefObject } from "react";
import { browserHighlightingAssetLoader } from "../../highlighting/FenceHighlighting.ts";
import { currentMarkdownEditorRanges, highlightMarkdownEditorSource, type CompletedMarkdownEditorHighlight } from "../../highlighting/MarkdownEditorHighlighting.ts";
import { SyntaxHighlightedText } from "../../highlighting/SyntaxHighlightedText.tsx";

type VimEditorHighlightLayerProps = Readonly<{
  source: string;
  layerRef: RefObject<HTMLDivElement | null>;
}>;

export function VimEditorHighlightLayer({ source, layerRef }: VimEditorHighlightLayerProps): ReactElement {
  const [completed, setCompleted] = useState<CompletedMarkdownEditorHighlight | undefined>();
  const visible = currentMarkdownEditorRanges(completed, source);

  useEffect(() => {
    const controller = new AbortController();
    let timeout: number | undefined;
    const frame = window.requestAnimationFrame(() => {
      timeout = window.setTimeout(() => {
        void highlightMarkdownEditorSource(browserHighlightingAssetLoader, source, controller.signal).then((ranges) => {
          if (controller.signal.aborted || ranges === undefined) return;
          setCompleted({ source, ranges });
        }, () => undefined);
      }, 0);
    });
    return () => {
      controller.abort();
      window.cancelAnimationFrame(frame);
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, [source]);

  return (
    <div
      ref={layerRef}
      className="pointer-events-none absolute inset-0 overflow-hidden rounded border border-transparent bg-surface-deepest p-2 font-mono text-sm leading-normal whitespace-pre-wrap break-words text-text-primary"
      aria-hidden="true"
      data-editor-highlighting="markdown"
    >
      <SyntaxHighlightedText source={source} ranges={visible} />
    </div>
  );
}
