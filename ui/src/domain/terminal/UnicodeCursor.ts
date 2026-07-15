declare const unicodeCursorOffsetBrand: unique symbol;

export type UnicodeCursorOffset = number & {
  readonly [unicodeCursorOffsetBrand]: "UnicodeCursorOffset";
};

function createUnicodeCursorOffset(value: number): UnicodeCursorOffset {
  return value as UnicodeCursorOffset;
}

function clampUnicodeCursorOffset(value: string, offset: number): number {
  if (!Number.isSafeInteger(offset)) {
    throw new Error("Unicode cursor offsets must be safe integers.");
  }

  return Math.max(0, Math.min(value.length, offset));
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}

function isSurrogatePairAt(value: string, offset: number): boolean {
  return (
    isHighSurrogate(value.charCodeAt(offset)) &&
    isLowSurrogate(value.charCodeAt(offset + 1))
  );
}

export function normalizeUnicodeCursorOffset(
  value: string,
  offset: number,
): UnicodeCursorOffset {
  const clampedOffset = clampUnicodeCursorOffset(value, offset);
  const normalizedOffset =
    clampedOffset > 0 && isSurrogatePairAt(value, clampedOffset - 1)
      ? clampedOffset - 1
      : clampedOffset;

  return createUnicodeCursorOffset(normalizedOffset);
}

export function previousUnicodeCursorOffset(
  value: string,
  offset: number,
): UnicodeCursorOffset {
  const normalizedOffset = normalizeUnicodeCursorOffset(value, offset);

  if (normalizedOffset === 0) {
    return normalizedOffset;
  }

  return normalizeUnicodeCursorOffset(value, normalizedOffset - 1);
}

export function nextUnicodeCursorOffset(
  value: string,
  offset: number,
): UnicodeCursorOffset {
  const normalizedOffset = normalizeUnicodeCursorOffset(value, offset);

  if (normalizedOffset === value.length) {
    return normalizedOffset;
  }

  const nextOffset = isSurrogatePairAt(value, normalizedOffset)
    ? normalizedOffset + 2
    : normalizedOffset + 1;

  return createUnicodeCursorOffset(nextOffset);
}
