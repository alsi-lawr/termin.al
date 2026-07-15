import { Cursor } from "./Cursor";
import type { ReactElement } from "react";

type InputRowProps = Readonly<{
  activeLine: string;
  cursorIndex: number;
}>;

export function InputRow({
  activeLine,
  cursorIndex,
}: InputRowProps): ReactElement {
  return (
    <div>
      {activeLine.slice(0, cursorIndex)}
      <Cursor value={activeLine[cursorIndex] ?? " "} />
      {activeLine.slice(cursorIndex + 1)}
    </div>
  );
}
