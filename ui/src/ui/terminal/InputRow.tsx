import { Cursor } from "./Cursor";
import type { ReactElement } from "react";
import { segmentVisibleInputRow } from "./UnicodeUiBoundary.ts";

type InputRowProps = Readonly<{
  activeLine: string;
  cursorIndex: number;
  suggestionSuffix?: string;
}>;

export function InputRow({
  activeLine,
  cursorIndex,
  suggestionSuffix = "",
}: InputRowProps): ReactElement {
  const segments = segmentVisibleInputRow(activeLine, cursorIndex);
  const suggestion = segmentVisibleInputRow(suggestionSuffix, 0);
  const cursorUsesSuggestion = segments.cursor === "" && suggestion.cursor !== "";
  const cursor = segments.cursor === ""
    ? suggestion.cursor === "" ? "\u00a0" : suggestion.cursor
    : segments.cursor;

  return (
    <>
      {segments.beforeCursor}
      <Cursor value={cursor} />
      {segments.afterCursor}
      {suggestionSuffix === "" ? null : (
        <span className="text-text-muted">
          {cursorUsesSuggestion ? suggestion.afterCursor : suggestionSuffix}
        </span>
      )}
    </>
  );
}
