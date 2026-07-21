import { Fragment, type ReactElement, type ReactNode } from "react";
import type { HighlightRange, SyntaxRole } from "./HighlightingTokens.ts";

type SyntaxHighlightedTextProps = Readonly<{
  source: string;
  ranges: ReadonlyArray<HighlightRange> | undefined;
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

export function SyntaxHighlightedText({ source, ranges }: SyntaxHighlightedTextProps): ReactElement {
  if (ranges === undefined) return <>{source}</>;
  const nodes: Array<ReactNode> = [];
  let offset = 0;
  for (const range of ranges) {
    if (range.start < offset || range.end > source.length || range.start >= range.end) continue;
    if (range.start > offset) nodes.push(source.slice(offset, range.start));
    nodes.push(<span key={`${range.start}-${range.end}-${range.role}`} className={syntaxClass(range.role)}>{source.slice(range.start, range.end)}</span>);
    offset = range.end;
  }
  if (offset < source.length) nodes.push(source.slice(offset));
  return <Fragment>{nodes}</Fragment>;
}
