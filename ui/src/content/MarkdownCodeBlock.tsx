import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { HighlightingAssetLoader, type HighlightingFetch } from "../highlighting/HighlightingAssetLoader.ts";
import { currentHighlightRanges, fenceLanguageKey, highlightFenceCode, type CompletedHighlight } from "../highlighting/FenceHighlighting.ts";
import { type HighlightRange, type SyntaxRole } from "../highlighting/HighlightingTokens.ts";

const browserFetch: HighlightingFetch = async (input, init) => {
  const response = await fetch(input, { signal: init.signal, credentials: "same-origin" });
  return {
    ok: response.ok,
    status: response.status,
    json: async (): Promise<unknown> => await response.json(),
    text: async (): Promise<string> => await response.text(),
    bytes: async (): Promise<Uint8Array> => new Uint8Array(await response.arrayBuffer()),
  };
};

const assetLoader = new HighlightingAssetLoader(browserFetch);

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
  for (const [index, range] of ranges.entries()) {
    if (range.start < offset || range.end > source.length || range.start >= range.end) continue;
    if (range.start > offset) nodes.push(source.slice(offset, range.start));
    nodes.push(<span key={`${range.start}-${range.end}-${index}`} className={syntaxClass(range.role)}>{source.slice(range.start, range.end)}</span>);
    offset = range.end;
  }
  if (offset < source.length) nodes.push(source.slice(offset));
  return nodes;
}

export type MarkdownCodeBlockProps = Readonly<{
  infoString: string | undefined;
  source: string;
}>;

export function MarkdownCodeBlock({ infoString, source }: MarkdownCodeBlockProps): ReactElement {
  const code = useRef<HTMLElement>(null);
  const [completed, setCompleted] = useState<CompletedHighlight | undefined>();
  const language = fenceLanguageKey(infoString);
  const visible = currentHighlightRanges(completed, language, source);

  useEffect(() => {
    if (language === undefined) return undefined;
    const controller = new AbortController();
    let timeout: number | undefined;
    const frame = window.requestAnimationFrame(() => {
      timeout = window.setTimeout(() => {
        void highlightFenceCode(assetLoader, language, source, controller.signal).then((ranges) => {
          if (controller.signal.aborted || ranges === undefined) return;
          const selection = window.getSelection();
          const element = code.current;
          if (selection !== null && element !== null) {
            for (let index = 0; index < selection.rangeCount; index += 1) {
              if (selection.getRangeAt(index).intersectsNode(element)) return;
            }
          }
          setCompleted({ language, source, ranges });
        }, () => undefined);
      }, 0);
    });
    return () => {
      controller.abort();
      window.cancelAnimationFrame(frame);
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, [language, source]);

  return (
    <pre className="mt-3 overflow-x-auto rounded bg-surface-raised p-3 text-markup-raw">
      <code ref={code} data-language={infoString}>{visible === undefined ? source : highlightedNodes(source, visible)}</code>
    </pre>
  );
}
