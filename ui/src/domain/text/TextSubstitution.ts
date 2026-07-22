export type TextSubstitution = Readonly<{
  pattern: string;
  replacement: string;
  replaceEveryMatch: boolean;
  ignoreCase: boolean;
}>;

export type TextSubstitutionParseResult =
  | Readonly<{ kind: "parsed"; substitution: TextSubstitution }>
  | Readonly<{ kind: "invalid"; message: string }>;

export type TextSubstitutionResult = Readonly<{
  text: string;
  matched: boolean;
  firstChangedOffset: number | undefined;
  ranges: ReadonlyArray<TextSubstitutionRange>;
}>;

type TextSubstitutionRange = Readonly<{
  start: number;
  end: number;
  role: "matched" | "replaced";
}>;

type TextSubstitutionOptions = Readonly<{
  maximumRanges: number;
  maximumOutputCodeUnits: number;
}>;

type BoundedTextSubstitutionResult =
  | Readonly<{ kind: "completed"; result: TextSubstitutionResult }>
  | Readonly<{ kind: "output-limit-exceeded" }>;

type ReplacementTextResult =
  | Readonly<{ kind: "completed"; text: string }>
  | Readonly<{ kind: "output-limit-exceeded" }>;

type DelimitedText = Readonly<{ text: string; nextOffset: number }>;

function readDelimited(
  source: string,
  startOffset: number,
  delimiter: string,
): DelimitedText | undefined {
  let text = "";

  for (let offset = startOffset; offset < source.length; offset += 1) {
    const character = source[offset];
    const next = source[offset + 1];

    if (character === delimiter) {
      return { text, nextOffset: offset + 1 };
    }

    if (character === "\\" && (next === delimiter || next === "\\")) {
      text += next === delimiter ? delimiter : "\\\\";
      offset += 1;
      continue;
    }

    text += character;
  }

  return undefined;
}

export function parseTextSubstitution(
  source: string,
  previousPattern: string | undefined,
): TextSubstitutionParseResult {
  if (source.includes("\n") || source.includes("\r")) {
    return { kind: "invalid", message: "Substitution commands must be one line." };
  }

  const delimiter = source.startsWith("s") ? source[1] : undefined;

  if (delimiter === undefined || delimiter === "\\") {
    return { kind: "invalid", message: "Substitution requires a valid delimiter." };
  }

  const patternText = readDelimited(source, 2, delimiter);

  if (patternText === undefined) {
    return { kind: "invalid", message: "Substitution pattern is not terminated." };
  }

  const replacement = readDelimited(source, patternText.nextOffset, delimiter);

  if (replacement === undefined) {
    return { kind: "invalid", message: "Substitution replacement is not terminated." };
  }

  const flags = source.slice(replacement.nextOffset);
  const validFlags = flags.length <= 2 &&
    [...flags].every((flag) => flag === "g" || flag === "i") &&
    new Set(flags).size === flags.length;

  if (!validFlags) {
    return { kind: "invalid", message: `Unsupported substitution flags: ${flags}` };
  }

  const pattern = patternText.text.length === 0 ? previousPattern : patternText.text;

  if (pattern === undefined) {
    return { kind: "invalid", message: "No previous substitution pattern." };
  }

  try {
    new RegExp(pattern, flags.includes("i") ? "giu" : "gu");
  } catch (error: unknown) {
    return {
      kind: "invalid",
      message: error instanceof Error ? error.message : "Invalid regular expression.",
    };
  }

  return {
    kind: "parsed",
    substitution: {
      pattern,
      replacement: replacement.text,
      replaceEveryMatch: flags.includes("g"),
      ignoreCase: flags.includes("i"),
    },
  };
}

function replacementText(
  replacement: string,
  match: RegExpExecArray,
  maximumCodeUnits?: number,
): ReplacementTextResult {
  let text = "";

  for (let offset = 0; offset < replacement.length; offset += 1) {
    const character = replacement[offset];
    const escaped = replacement[offset + 1];
    let addition: string;

    if (character === "&") {
      addition = match[0];
    } else if (character !== "\\" || escaped === undefined) {
      addition = character;
    } else if (escaped === "&" || escaped === "\\") {
      addition = escaped;
      offset += 1;
    } else if (/^[1-9]$/u.test(escaped)) {
      addition = match[Number(escaped)] ?? "";
      offset += 1;
    } else {
      addition = character;
    }

    if (
      maximumCodeUnits !== undefined &&
      text.length + addition.length > maximumCodeUnits
    ) {
      return { kind: "output-limit-exceeded" };
    }

    text += addition;
  }

  return { kind: "completed", text };
}

export function applyTextSubstitution(
  text: string,
  substitution: TextSubstitution,
): TextSubstitutionResult;
export function applyTextSubstitution(
  text: string,
  substitution: TextSubstitution,
  options: TextSubstitutionOptions,
): BoundedTextSubstitutionResult;
export function applyTextSubstitution(
  text: string,
  substitution: TextSubstitution,
  options?: TextSubstitutionOptions,
): TextSubstitutionResult | BoundedTextSubstitutionResult {
  const flags = substitution.ignoreCase ? "giu" : "gu";
  const expression = new RegExp(substitution.pattern, flags);
  const output: string[] = [];
  const ranges: Array<TextSubstitutionRange> = [];
  let copiedOffset = 0;
  let outputOffset = 0;
  let firstChangedOffset: number | undefined;
  let match = expression.exec(text);

  while (match !== null) {
    const prefixLength = match.index - copiedOffset;

    if (
      options !== undefined &&
      outputOffset + prefixLength > options.maximumOutputCodeUnits
    ) {
      return { kind: "output-limit-exceeded" };
    }

    const replacement = replacementText(
      substitution.replacement,
      match,
      options === undefined
        ? undefined
        : options.maximumOutputCodeUnits - outputOffset - prefixLength,
    );

    if (replacement.kind === "output-limit-exceeded") {
      return replacement;
    }

    output.push(text.slice(copiedOffset, match.index), replacement.text);
    outputOffset += prefixLength;

    if (
      replacement.text.length > 0 &&
      (options === undefined || ranges.length <= options.maximumRanges)
    ) {
      ranges.push({
        start: outputOffset,
        end: outputOffset + replacement.text.length,
        role: replacement.text === match[0] ? "matched" : "replaced",
      });
    }

    outputOffset += replacement.text.length;
    copiedOffset = match.index + match[0].length;
    firstChangedOffset ??= replacement.text === match[0] ? undefined : match.index;

    if (!substitution.replaceEveryMatch || match.index === text.length) {
      break;
    }

    if (match[0].length === 0) {
      const codePoint = text.codePointAt(expression.lastIndex);
      expression.lastIndex += codePoint !== undefined && codePoint > 0xFFFF ? 2 : 1;
    }

    match = expression.exec(text);
  }

  const matched = output.length > 0;
  const suffixLength = text.length - copiedOffset;

  if (
    options !== undefined &&
    outputOffset + suffixLength > options.maximumOutputCodeUnits
  ) {
    return { kind: "output-limit-exceeded" };
  }

  const result: TextSubstitutionResult = {
    text: matched ? output.join("") + text.slice(copiedOffset) : text,
    matched,
    firstChangedOffset,
    ranges,
  };
  return options === undefined ? result : { kind: "completed", result };
}
