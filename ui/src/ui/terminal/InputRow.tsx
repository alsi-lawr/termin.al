import { Cursor } from "./Cursor";
import type { ReactElement } from "react";
import {
  nextUnicodeCursorOffset,
  normalizeUnicodeCursorOffset,
} from "../../domain/terminal/UnicodeCursor.ts";

type InputRowProps = Readonly<{
  activeLine: string;
  cursorIndex: number;
}>;

export function InputRow({
  activeLine,
  cursorIndex,
}: InputRowProps): ReactElement {
  const cursor = normalizeUnicodeCursorOffset(activeLine, cursorIndex);
  const cursorEnd = nextUnicodeCursorOffset(activeLine, cursor);

  return (
    <div>
      {activeLine.slice(0, cursor)}
      <Cursor value={activeLine.slice(cursor, cursorEnd) || " "} />
      {activeLine.slice(cursorEnd)}
    </div>
  );
}
