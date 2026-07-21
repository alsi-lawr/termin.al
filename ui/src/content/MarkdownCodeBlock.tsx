import { useEffect, useRef, useState, type ReactElement } from "react";
import { browserHighlightingAssetLoader, currentHighlightRanges, fenceLanguageKey, highlightFenceCode, type CompletedHighlight } from "../highlighting/FenceHighlighting.ts";
import { SyntaxHighlightedText } from "../highlighting/SyntaxHighlightedText.tsx";

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
        void highlightFenceCode(browserHighlightingAssetLoader, language, source, controller.signal).then((ranges) => {
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
      <code ref={code} data-language={infoString}><SyntaxHighlightedText source={source} ranges={visible} /></code>
    </pre>
  );
}
