import { useEffect, useState, type ReactElement, type ReactNode, type RefObject } from "react";
import { browserHighlightingAssetLoader } from "../../highlighting/FenceHighlighting.ts";
import { currentMarkdownEditorRanges, highlightMarkdownEditorSource, type CompletedMarkdownEditorHighlight } from "../../highlighting/MarkdownEditorHighlighting.ts";
import { SyntaxHighlightedText } from "../../highlighting/SyntaxHighlightedText.tsx";
import type { HighlightRange } from "../../highlighting/HighlightingTokens.ts";
import type { VimCommandPreview, VimCommandPreviewRange } from "../../domain/vim/VimBuffer.ts";

type VimEditorHighlightLayerProps = Readonly<{
  preview: VimCommandPreview;
  syntax: "markdown" | "plain";
  layerRef: RefObject<HTMLDivElement | null>;
}>;

function previewClass(role: VimCommandPreviewRange["role"]): string {
  switch (role) {
    case "search":
      return "bg-ui-search text-surface-deepest";
    case "current-search":
      return "bg-ui-current-search text-surface-deepest";
    case "matched":
      return "bg-ui-match text-surface-deepest";
    case "replaced":
      return "bg-ui-current-search text-surface-deepest";
  }
}

function segmentSyntaxRanges(
  ranges: ReadonlyArray<HighlightRange> | undefined,
  start: number,
  end: number,
): ReadonlyArray<HighlightRange> | undefined {
  return ranges?.flatMap((range) => {
    const rangeStart = Math.max(start, range.start);
    const rangeEnd = Math.min(end, range.end);

    return rangeStart < rangeEnd
      ? [{ start: rangeStart - start, end: rangeEnd - start, role: range.role }]
      : [];
  });
}

function highlightedPreview(
  preview: VimCommandPreview,
  syntaxRanges: ReadonlyArray<HighlightRange> | undefined,
): ReactNode {
  const nodes: Array<ReactNode> = [];
  let offset = 0;

  for (const range of preview.ranges) {
    if (range.start > offset) {
      const source = preview.source.slice(offset, range.start);
      nodes.push(
        <SyntaxHighlightedText
          key={`source-${offset}-${range.start}`}
          source={source}
          ranges={segmentSyntaxRanges(syntaxRanges, offset, range.start)}
        />,
      );
    }

    const source = preview.source.slice(range.start, range.end);
    nodes.push(
      <span
        key={`${range.start}-${range.end}-${range.role}`}
        className={previewClass(range.role)}
      >
        <SyntaxHighlightedText
          source={source}
          ranges={segmentSyntaxRanges(syntaxRanges, range.start, range.end)}
        />
      </span>,
    );
    offset = range.end;
  }

  if (offset < preview.source.length) {
    const source = preview.source.slice(offset);
    nodes.push(
      <SyntaxHighlightedText
        key={`source-${offset}-${preview.source.length}`}
        source={source}
        ranges={segmentSyntaxRanges(syntaxRanges, offset, preview.source.length)}
      />,
    );
  }

  return nodes;
}

export function VimEditorHighlightLayer({ preview, syntax, layerRef }: VimEditorHighlightLayerProps): ReactElement {
  const [completed, setCompleted] = useState<CompletedMarkdownEditorHighlight | undefined>();
  const visible = syntax === "markdown"
    ? currentMarkdownEditorRanges(completed, preview.source)
    : undefined;

  useEffect(() => {
    if (syntax === "plain") {
      return;
    }

    const controller = new AbortController();
    let timeout: number | undefined;
    const frame = window.requestAnimationFrame(() => {
      timeout = window.setTimeout(() => {
        void highlightMarkdownEditorSource(browserHighlightingAssetLoader, preview.source, controller.signal).then((ranges) => {
          if (controller.signal.aborted || ranges === undefined) return;
          setCompleted({ source: preview.source, ranges });
        }, () => undefined);
      }, 0);
    });
    return () => {
      controller.abort();
      window.cancelAnimationFrame(frame);
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, [preview.source, syntax]);

  return (
    <div
      ref={layerRef}
      className="pointer-events-none absolute inset-0 overflow-hidden rounded border border-transparent bg-surface-deepest p-2 font-mono text-sm leading-normal whitespace-pre-wrap break-words text-text-primary"
      aria-hidden="true"
      data-editor-highlighting={syntax}
    >
      {highlightedPreview(preview, visible)}
    </div>
  );
}
