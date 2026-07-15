import { Cursor } from "./Cursor";
import type { ReactElement } from "react";
import { segmentVisibleInputRow } from "./UnicodeUiBoundary.ts";

type InputRowProps = Readonly<{
  activeLine: string;
  cursorIndex: number;
}>;

export function InputRow({
  activeLine,
  cursorIndex,
}: InputRowProps): ReactElement {
  const segments = segmentVisibleInputRow(activeLine, cursorIndex);
  const cursor = segments.cursor === "" ? "\u00a0" : segments.cursor;

  return (
    <>
      {segments.beforeCursor}
      <Cursor value={cursor} />
      {segments.afterCursor}
    </>
  );
}
