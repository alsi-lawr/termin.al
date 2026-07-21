export type MarkdownFenceOpening = Readonly<{
  marker: "`" | "~";
  length: number;
  infoString: string;
}>;

const openingPattern = /^ {0,3}(`{3,}|~{3,})(.*)$/u;

export function markdownFenceOpening(line: string): MarkdownFenceOpening | undefined {
  const match = openingPattern.exec(line);
  const run = match?.[1];
  if (run === undefined) return undefined;
  const marker = run.startsWith("`") ? "`" : "~";
  const suffix = match?.[2] ?? "";
  if (marker === "`" && suffix.includes("`")) return undefined;
  return {
    marker,
    length: run.length,
    infoString: suffix.trim(),
  };
}

export function isMarkdownFenceClosing(line: string, opening: MarkdownFenceOpening): boolean {
  let offset = 0;
  while (offset < 3 && line[offset] === " ") offset += 1;
  if (line[offset] !== opening.marker) return false;
  let end = offset;
  while (line[end] === opening.marker) end += 1;
  if (end - offset < opening.length) return false;
  for (const suffix of line.slice(end)) if (suffix !== " " && suffix !== "\t") return false;
  return true;
}
