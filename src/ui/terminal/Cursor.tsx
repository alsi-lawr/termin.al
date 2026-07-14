type CursorProps = {
  value?: string;
};

export function Cursor({ value = " " }: CursorProps) {
  return (
    <span className="inline-block w-[1ch] bg-neutral-100 text-neutral-950 animate-terminal-cursor">
      {value}
    </span>
  );
}
