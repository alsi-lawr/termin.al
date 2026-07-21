export type SyntaxRole =
  | "attribute"
  | "comment"
  | "function"
  | "keyword"
  | "literal"
  | "operator"
  | "property"
  | "punctuation"
  | "regexp"
  | "special"
  | "string"
  | "tag"
  | "type";

export type HighlightRange = Readonly<{
  start: number;
  end: number;
  role: SyntaxRole;
}>;

export type HighlightCandidate = HighlightRange & Readonly<{
  priority: number;
  sequence: number;
}>;

export const maximumHighlightedCodeUnits = 131_072;
export const maximumHighlightRanges = 20_000;

export function syntaxRole(name: string): SyntaxRole | undefined {
  const normalized = name.toLowerCase();
  if (normalized.includes("comment")) return "comment";
  if (normalized.includes("regexp") || normalized.includes("regex")) return "regexp";
  if (normalized.includes("string") || normalized.includes("character")) return "string";
  if (normalized.includes("attribute")) return "attribute";
  if (normalized.includes("tag")) return "tag";
  if (normalized.includes("function") || normalized.includes("method") || normalized.includes("constructor")) return "function";
  if (normalized.includes("keyword") || normalized.includes("storage") || normalized.includes("modifier")) return "keyword";
  if (normalized.includes("type") || normalized.includes("class") || normalized.includes("interface") || normalized.includes("enum") || normalized.includes("namespace")) return "type";
  if (normalized.includes("property") || normalized.includes("field") || normalized.includes("member")) return "property";
  if (normalized.includes("number") || normalized.includes("boolean") || normalized.includes("constant") || normalized.includes("literal") || normalized.includes("escape")) return "literal";
  if (normalized.includes("operator")) return "operator";
  if (normalized.includes("punctuation") || normalized.includes("bracket") || normalized.includes("delimiter")) return "punctuation";
  if (normalized.includes("builtin") || normalized.includes("predefined") || normalized.includes("special")) return "special";
  return undefined;
}

export function normalizedHighlightRanges(
  sourceLength: number,
  candidates: ReadonlyArray<HighlightCandidate>,
): ReadonlyArray<HighlightRange> | undefined {
  if (candidates.length > maximumHighlightRanges) return undefined;
  const valid = candidates.filter((candidate) =>
    Number.isInteger(candidate.start) &&
    Number.isInteger(candidate.end) &&
    candidate.start >= 0 &&
    candidate.end <= sourceLength &&
    candidate.start < candidate.end,
  );
  type Event = Readonly<{ position: number; entering: boolean; candidate: HighlightCandidate }>;
  const events: Array<Event> = valid.flatMap((candidate) => [
    { position: candidate.start, entering: true, candidate },
    { position: candidate.end, entering: false, candidate },
  ]);
  events.sort((left, right) => left.position - right.position || Number(left.entering) - Number(right.entering));
  const active = new Map<number, HighlightCandidate>();
  const ranges: Array<HighlightRange> = [];
  let eventIndex = 0;
  while (eventIndex < events.length) {
    const position = events[eventIndex]?.position;
    if (position === undefined) break;
    while (events[eventIndex]?.position === position) {
      const event = events[eventIndex];
      if (event === undefined) break;
      if (event.entering) active.set(event.candidate.sequence, event.candidate);
      else active.delete(event.candidate.sequence);
      eventIndex += 1;
    }
    if (active.size > 256) return undefined;
    const next = events[eventIndex]?.position;
    if (next === undefined || next <= position || active.size === 0) continue;
    let selected: HighlightCandidate | undefined;
    for (const candidate of active.values()) {
      if (
        selected === undefined ||
        candidate.priority > selected.priority ||
        (candidate.priority === selected.priority && candidate.end - candidate.start < selected.end - selected.start) ||
        (candidate.priority === selected.priority && candidate.end - candidate.start === selected.end - selected.start && candidate.sequence > selected.sequence)
      ) selected = candidate;
    }
    if (selected === undefined) continue;
    const previous = ranges.at(-1);
    if (previous !== undefined && previous.end === position && previous.role === selected.role) {
      ranges[ranges.length - 1] = { start: previous.start, end: next, role: previous.role };
    } else {
      ranges.push({ start: position, end: next, role: selected.role });
    }
  }
  return ranges;
}
