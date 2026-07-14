import { Cursor } from "./Cursor";

type InputRowProps = {
  activeLine: string;
  cursorIndex: number;
};

export function InputRow({ activeLine, cursorIndex }: InputRowProps) {
  return (
    <div>
      {activeLine.slice(0, cursorIndex)}
      <Cursor value={activeLine[cursorIndex] ?? " "} />
      {activeLine.slice(cursorIndex + 1)}
    </div>
  );
}
