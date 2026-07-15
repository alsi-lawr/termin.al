import type { ShellId, ShellSessionId } from "./Shell.ts";
import { normalizeUnicodeCursorOffset } from "./UnicodeCursor.ts";

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
    }>
  | Readonly<{
      kind: "none";
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

type CompletionQuote = "none" | "single" | "double";

type CompletionToken = Readonly<{
  sourceStart: number;
  sourceEnd: number;
  contentStart: number;
  contentEnd: number;
  value: string;
  quote: CompletionQuote;
}>;

function isWhitespaceCharacter(character: string): boolean {
  return /\s/u.test(character);
}

function completionTokens(source: string): ReadonlyArray<CompletionToken> {
  const tokens: CompletionToken[] = [];
  let sourceStart = -1;
  let contentStart = -1;
  let value = "";
  let quote: CompletionQuote = "none";
  let quoteOnly = false;
  let escaped = false;

  const beginToken = (position: number): void => {
    if (sourceStart !== -1) {
      return;
    }

    sourceStart = position;
    contentStart = position;
  };

  const finishToken = (position: number): void => {
    if (sourceStart === -1) {
      return;
    }

    const contentEnd = quoteOnly && quote !== "none" ? position : position;

    tokens.push({
      sourceStart,
      sourceEnd: position,
      contentStart,
      contentEnd,
      value,
      quote: quoteOnly ? quote : "none",
    });
    sourceStart = -1;
    contentStart = -1;
    value = "";
    quote = "none";
    quoteOnly = false;
    escaped = false;
  };

  for (let position = 0; position < source.length; position += 1) {
    const character = source[position] ?? "";

    if (escaped) {
      value += character;
      escaped = false;
      continue;
    }

    if (character === "\\") {
      beginToken(position);
      escaped = true;
      continue;
    }

    if (quote === "single" || quote === "double") {
      const closingCharacter = quote === "single" ? "'" : '"';

      if (character === closingCharacter) {
        if (quoteOnly) {
          tokens.push({
            sourceStart,
            sourceEnd: position + 1,
            contentStart,
            contentEnd: position,
            value,
            quote,
          });
          sourceStart = -1;
          contentStart = -1;
          value = "";
          quote = "none";
          quoteOnly = false;
          continue;
        }

        quote = "none";
        continue;
      }

      value += character;
      continue;
    }

    if (isWhitespaceCharacter(character)) {
      finishToken(position);
      continue;
    }

    if (character === "'" || character === '"') {
      beginToken(position);
      quote = character === "'" ? "single" : "double";
      quoteOnly = sourceStart === position;

      if (quoteOnly) {
        contentStart = position + 1;
      }

      continue;
    }

    beginToken(position);
    value += character;
  }

  finishToken(source.length);

  return tokens;
}

function currentToken(
  tokens: ReadonlyArray<CompletionToken>,
  cursor: number,
): CompletionToken | undefined {
  return tokens.find((token) => {
    if (token.quote === "none") {
      return cursor >= token.sourceStart && cursor <= token.sourceEnd;
    }

    return cursor >= token.contentStart && cursor <= token.contentEnd;
  });
}

function targetForCursor(
  source: string,
  cursor: number,
): CompletionTarget {
  const tokens = completionTokens(source);
  const token = currentToken(tokens, cursor);
  const start = token?.quote === "none"
    ? token.sourceStart
    : token?.contentStart ?? cursor;
  const end = token?.quote === "none"
    ? token.sourceEnd
    : token?.contentEnd ?? cursor;
  const prefix = source.slice(start, cursor);
  const precedingTokens = tokens.filter((candidate) => candidate.sourceEnd <= start);

  if (precedingTokens.length === 0) {
    return { kind: "command", prefix, start, end };
  }

  const afterOptionTerminator = precedingTokens.some(
    (candidate) => candidate.value === "--",
  );

  if (!afterOptionTerminator && prefix.startsWith("-")) {
    return { kind: "none", prefix, start, end };
  }

  return { kind: "path", prefix, start, end };
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

  const normalizedCursor = normalizeUnicodeCursorOffset(source, cursor);

  return {
    shellId,
    sessionId,
    source,
    cursor: normalizedCursor,
    target: targetForCursor(source, normalizedCursor),
  };
}

export function createCompletionEdit(
  request: CompletionRequest,
  candidate: CompletionCandidate,
): CompletionEdit {
  return createCompletionPrefixEdit(request, candidate.value);
}

export function createCompletionPrefixEdit(
  request: CompletionRequest,
  prefix: string,
): CompletionEdit {
  const value =
    request.source.slice(0, request.target.start) +
    prefix +
    request.source.slice(request.target.end);

  return {
    value,
    cursor: normalizeUnicodeCursorOffset(
      value,
      request.target.start + prefix.length,
    ),
  };
}

export function longestCommonCompletionPrefix(
  candidates: ReadonlyArray<CompletionCandidate>,
): string {
  const firstCandidate = candidates[0];

  if (firstCandidate === undefined) {
    return "";
  }

  let prefix = Array.from(firstCandidate.value);

  for (const candidate of candidates.slice(1)) {
    const candidateCharacters = Array.from(candidate.value);
    let length = 0;

    while (
      length < prefix.length &&
      length < candidateCharacters.length &&
      prefix[length] === candidateCharacters[length]
    ) {
      length += 1;
    }

    prefix = prefix.slice(0, length);

    if (prefix.length === 0) {
      return "";
    }
  }

  return prefix.join("");
}
