import {
  nextUnicodeCursorOffset,
  normalizeUnicodeCursorOffset,
  previousUnicodeCursorOffset,
  type UnicodeCursorOffset,
} from "./UnicodeCursor.ts";

export type ShellLine = Readonly<{
  text: string;
  cursor: UnicodeCursorOffset;
}>;

type CanonicalShellLineReplacement = Readonly<{
  text: string;
  cursor: UnicodeCursorOffset;
}>;

const wordCharacterPattern = /[\p{L}\p{N}_]/u;

function canonicaliseShellLineText(text: string): string {
  return text.replace(/\r\n|\r|\n/gu, " ");
}

function canonicaliseShellLineReplacement(
  text: string,
  cursor: number,
): CanonicalShellLineReplacement {
  const sourceCursor = normalizeUnicodeCursorOffset(text, cursor);
  const canonicalText = canonicaliseShellLineText(text);
  const canonicalCursor = canonicaliseShellLineText(
    text.slice(0, sourceCursor),
  ).length;

  return {
    text: canonicalText,
    cursor: normalizeUnicodeCursorOffset(canonicalText, canonicalCursor),
  };
}

function withCursor(text: string, cursor: number): ShellLine {
  return { text, cursor: normalizeUnicodeCursorOffset(text, cursor) };
}

function characterAt(
  text: string,
  offset: UnicodeCursorOffset,
): string {
  const nextOffset = nextUnicodeCursorOffset(text, offset);

  return text.slice(offset, nextOffset);
}

function characterBefore(
  text: string,
  offset: UnicodeCursorOffset,
): string {
  const previousOffset = previousUnicodeCursorOffset(text, offset);

  return text.slice(previousOffset, offset);
}

function isWordCharacter(character: string): boolean {
  return wordCharacterPattern.test(character);
}

function previousWordOffset(line: ShellLine): UnicodeCursorOffset {
  let cursor = line.cursor;

  while (cursor > 0 && !isWordCharacter(characterBefore(line.text, cursor))) {
    cursor = previousUnicodeCursorOffset(line.text, cursor);
  }

  while (cursor > 0 && isWordCharacter(characterBefore(line.text, cursor))) {
    cursor = previousUnicodeCursorOffset(line.text, cursor);
  }

  return cursor;
}

function nextWordOffset(line: ShellLine): UnicodeCursorOffset {
  let cursor = line.cursor;

  while (
    cursor < line.text.length &&
    !isWordCharacter(characterAt(line.text, cursor))
  ) {
    cursor = nextUnicodeCursorOffset(line.text, cursor);
  }

  while (
    cursor < line.text.length &&
    isWordCharacter(characterAt(line.text, cursor))
  ) {
    cursor = nextUnicodeCursorOffset(line.text, cursor);
  }

  return cursor;
}

export function createShellLine(text = "", cursor = text.length): ShellLine {
  const replacement = canonicaliseShellLineReplacement(text, cursor);

  return { text: replacement.text, cursor: replacement.cursor };
}

export function createEmptyShellLine(): ShellLine {
  return createShellLine();
}

export function replaceShellLine(
  text: string,
  cursor: number,
): ShellLine {
  return createShellLine(text, cursor);
}

export function insertShellLineText(line: ShellLine, text: string): ShellLine {
  const insertedText = canonicaliseShellLineText(text);

  if (insertedText.length === 0) {
    return line;
  }

  return withCursor(
    line.text.slice(0, line.cursor) +
      insertedText +
      line.text.slice(line.cursor),
    line.cursor + insertedText.length,
  );
}

export function moveShellLineCursor(
  line: ShellLine,
  cursor: number,
): ShellLine {
  return withCursor(line.text, cursor);
}

export function moveShellLineCursorLeft(line: ShellLine): ShellLine {
  return withCursor(
    line.text,
    previousUnicodeCursorOffset(line.text, line.cursor),
  );
}

export function moveShellLineCursorRight(line: ShellLine): ShellLine {
  return withCursor(
    line.text,
    nextUnicodeCursorOffset(line.text, line.cursor),
  );
}

export function moveShellLineCursorStart(line: ShellLine): ShellLine {
  return withCursor(line.text, 0);
}

export function moveShellLineCursorEnd(line: ShellLine): ShellLine {
  return withCursor(line.text, line.text.length);
}

export function moveShellLineCursorPreviousWord(line: ShellLine): ShellLine {
  return withCursor(line.text, previousWordOffset(line));
}

export function moveShellLineCursorNextWord(line: ShellLine): ShellLine {
  return withCursor(line.text, nextWordOffset(line));
}

export function backspaceShellLine(line: ShellLine): ShellLine {
  const start = previousUnicodeCursorOffset(line.text, line.cursor);

  if (start === line.cursor) {
    return line;
  }

  return withCursor(
    line.text.slice(0, start) + line.text.slice(line.cursor),
    start,
  );
}

export function deleteShellLine(line: ShellLine): ShellLine {
  const end = nextUnicodeCursorOffset(line.text, line.cursor);

  if (end === line.cursor) {
    return line;
  }

  return withCursor(
    line.text.slice(0, line.cursor) + line.text.slice(end),
    line.cursor,
  );
}

export function deleteShellLinePreviousWord(line: ShellLine): ShellLine {
  const start = previousWordOffset(line);

  if (start === line.cursor) {
    return line;
  }

  return withCursor(
    line.text.slice(0, start) + line.text.slice(line.cursor),
    start,
  );
}
