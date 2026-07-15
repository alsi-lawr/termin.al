import type { ShellId, ShellSessionId } from "./Shell.ts";

export type CompletionTarget =
  | Readonly<{
      kind: "command";
      prefix: string;
      start: number;
      end: number;
    }>
  | Readonly<{
      kind: "path";
      prefix: string;
      start: number;
      end: number;
    }>;

export type CompletionRequest = Readonly<{
  shellId: ShellId;
  sessionId: ShellSessionId;
  source: string;
  cursor: number;
  target: CompletionTarget;
}>;

export type CompletionCandidate = Readonly<{
  kind: "command" | "path";
  value: string;
  label: string;
}>;

export type CompletionResult =
  | Readonly<{ kind: "none" }>
  | Readonly<{
      kind: "single";
      candidate: CompletionCandidate;
    }>
  | Readonly<{
      kind: "multiple";
      candidates: ReadonlyArray<CompletionCandidate>;
    }>;

export type CompletionEdit = Readonly<{
  value: string;
  cursor: number;
}>;

function isWhitespaceCharacter(character: string): boolean {
  return /\s/u.test(character);
}

export function createCompletionRequest(
  shellId: ShellId,
  sessionId: ShellSessionId,
  source: string,
  cursor: number,
): CompletionRequest {
  if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > source.length) {
    throw new Error("Completion cursors must reference a character boundary.");
  }

  let start = cursor;

  while (start > 0 && !isWhitespaceCharacter(source[start - 1] ?? "")) {
    start -= 1;
  }

  let end = cursor;

  while (end < source.length && !isWhitespaceCharacter(source[end] ?? "")) {
    end += 1;
  }

  const prefix = source.slice(start, cursor);
  const beforeTarget = source.slice(0, start).trim();
  const target: CompletionTarget =
    beforeTarget.length === 0
      ? { kind: "command", prefix, start, end }
      : { kind: "path", prefix, start, end };

  return { shellId, sessionId, source, cursor, target };
}

export function createCompletionEdit(
  request: CompletionRequest,
  candidate: CompletionCandidate,
): CompletionEdit {
  return {
    value:
      request.source.slice(0, request.target.start) +
      candidate.value +
      request.source.slice(request.target.end),
    cursor: request.target.start + candidate.value.length,
  };
}
