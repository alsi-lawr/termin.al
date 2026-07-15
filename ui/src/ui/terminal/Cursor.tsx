import type { ReactElement } from "react";

type CursorProps = Readonly<{
  value: string;
}>;

export function Cursor({ value }: CursorProps): ReactElement {
  return (
    <span className="inline-block animate-pulse bg-neutral-100 text-neutral-950 motion-reduce:animate-none">
      {value}
    </span>
  );
}
