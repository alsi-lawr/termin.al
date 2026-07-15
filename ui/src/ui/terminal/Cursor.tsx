import type { ReactElement } from "react";

type CursorProps = Readonly<{
  value: string;
}>;

export function Cursor({ value }: CursorProps): ReactElement {
  return (
    <span className="inline-block animate-pulse bg-ui-cursor text-text-on-accent motion-reduce:animate-none">
      {value}
    </span>
  );
}
