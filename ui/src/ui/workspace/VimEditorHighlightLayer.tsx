import { useEffect, useState, type ReactElement, type ReactNode, type RefObject } from "react";
import { browserHighlightingAssetLoader } from "../../highlighting/FenceHighlighting.ts";
import { currentMarkdownEditorRanges, highlightMarkdownEditorSource, type CompletedMarkdownEditorHighlight } from "../../highlighting/MarkdownEditorHighlighting.ts";
import type { HighlightRange, SyntaxRole } from "../../highlighting/HighlightingTokens.ts";

type VimEditorHighlightLayerProps = Readonly<{
  source: string;
  layerRef: RefObject<HTMLDivElement | null>;
}>;

function syntaxClass(role: SyntaxRole): string {
  switch (role) {
    case "attribute": return "text-syntax-attribute";
    case "comment": return "text-syntax-comment";
    case "function": return "text-syntax-function-name";
    case "keyword": return "text-syntax-keyword";
    case "literal": return "text-syntax-literal";
    case "operator": return "text-syntax-operator";
    case "property": return "text-syntax-property";
    case "punctuation": return "text-syntax-punctuation";
    case "regexp": return "text-syntax-regexp";
    case "special": return "text-syntax-special";
    case "string": return "text-syntax-string";
    case "tag": return "text-syntax-tag";
    case "type": return "text-syntax-type";
  }
}

function highlightedNodes(source: string, ranges: ReadonlyArray<HighlightRange>): ReadonlyArray<ReactNode> {
  const nodes: Array<ReactNode> = [];
  let offset = 0;
  for (const range of ranges) {
    if (range.start < offset || range.end > source.length || range.start >= range.end) continue;
    if (range.start > offset) nodes.push(source.slice(offset, range.start));
    nodes.push(<span key={`${range.start}-${range.end}-${range.role}`} className={syntaxClass(range.role)}>{source.slice(range.start, range.end)}</span>);
    offset = range.end;
  }
  if (offset < source.length) nodes.push(source.slice(offset));
  return nodes;
}

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
      {visible === undefined ? source : highlightedNodes(source, visible)}
    </div>
  );
}
