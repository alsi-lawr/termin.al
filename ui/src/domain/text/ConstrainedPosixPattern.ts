const maximumPatternScalars = 256;
const maximumPatternCodeUnits = 1024;
const maximumProgramInstructions = 2048;
const maximumIntervalBound = 255;

export type ConstrainedPosixPatternDialect = "basic" | "extended" | "fixed";

export type ConstrainedPosixPatternOptions = Readonly<{
  dialect: ConstrainedPosixPatternDialect;
  caseSensitivity: "sensitive" | "ascii-insensitive";
}>;

export type ConstrainedPosixMatchSpan = Readonly<{
  start: number;
  end: number;
}>;

export type ConstrainedPosixPatternCompilation =
  | Readonly<{
      kind: "compiled";
      pattern: ConstrainedPosixPattern;
    }>
  | Readonly<{
      kind: "invalid";
      offset: number;
      reason: string;
      message: string;
    }>
  | Readonly<{ kind: "cancelled" }>;

export type ConstrainedPosixMatchResult =
  | Readonly<{
      kind: "matched";
      span: ConstrainedPosixMatchSpan;
    }>
  | Readonly<{ kind: "unmatched" }>
  | Readonly<{ kind: "cancelled" }>;

type PatternScalar = Readonly<{
  value: string;
  offset: number;
}>;

type CharacterRange = Readonly<{
  first: number;
  last: number;
}>;

type CharacterSet = Readonly<{
  negated: boolean;
  ranges: ReadonlyArray<CharacterRange>;
}>;

type Atom =
  | Readonly<{ kind: "literal"; value: string }>
  | Readonly<{ kind: "dot" }>
  | Readonly<{ kind: "set"; set: CharacterSet }>;

type Expression =
  | Readonly<{ kind: "epsilon"; offset: number }>
  | Readonly<{ kind: "atom"; offset: number; atom: Atom }>
  | Readonly<{ kind: "start-anchor"; offset: number }>
  | Readonly<{ kind: "end-anchor"; offset: number }>
  | Readonly<{
      kind: "concatenation";
      offset: number;
      expressions: ReadonlyArray<Expression>;
    }>
  | Readonly<{
      kind: "alternation";
      offset: number;
      expressions: ReadonlyArray<Expression>;
    }>
  | Readonly<{
      kind: "repetition";
      offset: number;
      expression: Expression;
      minimum: number;
      maximum: number | "unbounded";
    }>;

type ParseResult =
  | Readonly<{ kind: "parsed"; expression: Expression }>
  | InvalidResult
  | Readonly<{ kind: "cancelled" }>;

type InvalidResult = Readonly<{
  kind: "invalid";
  offset: number;
  reason: string;
}>;

type ParseExpressionResult =
  | Readonly<{ kind: "expression"; expression: Expression }>
  | InvalidResult
  | Readonly<{ kind: "cancelled" }>;

type ParseAtomResult =
  | Readonly<{ kind: "atom"; expression: Expression }>
  | Readonly<{ kind: "boundary" }>
  | InvalidResult
  | Readonly<{ kind: "cancelled" }>;

type ParseIntervalResult =
  | Readonly<{
      kind: "interval";
      minimum: number;
      maximum: number | "unbounded";
      endIndex: number;
    }>
  | InvalidResult;

type Instruction =
  | { kind: "character"; atom: Atom; out: number | "pending" }
  | { kind: "split"; first: number | "pending"; second: number | "pending" }
  | { kind: "jump"; out: number | "pending" }
  | { kind: "start-anchor"; out: number | "pending" }
  | { kind: "end-anchor"; out: number | "pending" }
  | { kind: "match" };

type Patch =
  | Readonly<{ kind: "out"; instruction: number }>
  | Readonly<{ kind: "second"; instruction: number }>;

type Fragment = Readonly<{
  start: number;
  patches: ReadonlyArray<Patch>;
}>;

type CompileResult =
  | Readonly<{
      kind: "program";
      start: number;
      instructions: ReadonlyArray<Instruction>;
    }>
  | InvalidResult
  | Readonly<{ kind: "cancelled" }>;

type FragmentResult =
  | Readonly<{ kind: "fragment"; fragment: Fragment }>
  | InvalidResult
  | Readonly<{ kind: "cancelled" }>;

type Thread = Readonly<{
  instruction: number;
  start: number;
}>;

function invalid(offset: number, reason: string): InvalidResult {
  return { kind: "invalid", offset, reason };
}

function invalidCompilation(result: InvalidResult): ConstrainedPosixPatternCompilation {
  return {
    ...result,
    message: `Invalid regular expression at offset ${result.offset}: ${result.reason}.`,
  };
}

function scalarValue(value: string): number {
  const codePoint = value.codePointAt(0);

  if (codePoint === undefined) {
    throw new Error("Pattern scalars must be non-empty.");
  }

  return codePoint;
}

function isHighSurrogate(value: number): boolean {
  return value >= 0xd800 && value <= 0xdbff;
}

function isLowSurrogate(value: number): boolean {
  return value >= 0xdc00 && value <= 0xdfff;
}

function patternScalars(
  pattern: string,
): Readonly<{ kind: "scalars"; scalars: ReadonlyArray<PatternScalar> }> | InvalidResult {
  const scalars: PatternScalar[] = [];
  let codeUnitIndex = 0;

  while (codeUnitIndex < pattern.length) {
    const first = pattern.charCodeAt(codeUnitIndex);

    if (isHighSurrogate(first)) {
      const second = pattern.charCodeAt(codeUnitIndex + 1);

      if (!isLowSurrogate(second)) {
        return invalid(scalars.length, "pattern contains an isolated surrogate");
      }

      scalars.push({ value: pattern.slice(codeUnitIndex, codeUnitIndex + 2), offset: scalars.length });
      codeUnitIndex += 2;
      continue;
    }

    if (isLowSurrogate(first)) {
      return invalid(scalars.length, "pattern contains an isolated surrogate");
    }

    scalars.push({ value: pattern[codeUnitIndex] ?? "", offset: scalars.length });
    codeUnitIndex += 1;
  }

  return { kind: "scalars", scalars };
}

function isDigit(value: string): boolean {
  return value >= "0" && value <= "9";
}

function isAsciiLetter(value: string): boolean {
  return (value >= "A" && value <= "Z") || (value >= "a" && value <= "z");
}

function toggledAsciiCase(value: string): string {
  if (value >= "A" && value <= "Z") {
    return String.fromCodePoint(scalarValue(value) + 32);
  }

  if (value >= "a" && value <= "z") {
    return String.fromCodePoint(scalarValue(value) - 32);
  }

  return value;
}

function isRegexEscapeLiteral(value: string): boolean {
  return (
    value === "." ||
    value === "^" ||
    value === "$" ||
    value === "[" ||
    value === "]" ||
    value === "*" ||
    value === "+" ||
    value === "?" ||
    value === "{" ||
    value === "}" ||
    value === "(" ||
    value === ")" ||
    value === "|" ||
    value === "-" ||
    value === "\\"
  );
}

function concatenation(expressions: ReadonlyArray<Expression>, offset: number): Expression {
  if (expressions.length === 0) {
    return { kind: "epsilon", offset };
  }

  if (expressions.length === 1) {
    return expressions[0] ?? { kind: "epsilon", offset };
  }

  return { kind: "concatenation", offset, expressions };
}

function alternation(expressions: ReadonlyArray<Expression>, offset: number): Expression {
  if (expressions.length === 1) {
    return expressions[0] ?? { kind: "epsilon", offset };
  }

  return { kind: "alternation", offset, expressions };
}

class PatternParser {
  readonly #scalars: ReadonlyArray<PatternScalar>;
  readonly #dialect: Exclude<ConstrainedPosixPatternDialect, "fixed">;
  readonly #signal: AbortSignal;
  #index = 0;

  constructor(
    scalars: ReadonlyArray<PatternScalar>,
    dialect: Exclude<ConstrainedPosixPatternDialect, "fixed">,
    signal: AbortSignal,
  ) {
    this.#scalars = scalars;
    this.#dialect = dialect;
    this.#signal = signal;
  }

  parse(): ParseResult {
    const result = this.#dialect === "extended"
      ? this.#parseAlternation("complete")
      : this.#parseConcatenation("complete");

    if (result.kind !== "expression") {
      return result;
    }

    if (this.#index !== this.#scalars.length) {
      return invalid(this.#index, "unexpected group terminator");
    }

    return { kind: "parsed", expression: result.expression };
  }

  #parseAlternation(boundary: "complete" | "group"): ParseExpressionResult {
    const offset = this.#index;
    const expressions: Expression[] = [];

    while (true) {
      const branch = this.#parseConcatenation(boundary);

      if (branch.kind !== "expression") {
        return branch;
      }

      expressions.push(branch.expression);

      if (this.#currentValue() !== "|") {
        break;
      }

      this.#index += 1;
    }

    return { kind: "expression", expression: alternation(expressions, offset) };
  }

  #parseConcatenation(boundary: "complete" | "group"): ParseExpressionResult {
    const offset = this.#index;
    const expressions: Expression[] = [];

    while (this.#index < this.#scalars.length) {
      if (this.#signal.aborted) {
        return { kind: "cancelled" };
      }

      if (this.#isBoundary(boundary)) {
        break;
      }

      const atom = this.#parseAtom(expressions.length === 0, boundary);

      if (atom.kind === "boundary") {
        break;
      }

      if (atom.kind !== "atom") {
        return atom;
      }

      const repeated = this.#parseRepetition(atom.expression);

      if (repeated.kind !== "expression") {
        return repeated;
      }

      expressions.push(repeated.expression);
    }

    return { kind: "expression", expression: concatenation(expressions, offset) };
  }

  #parseAtom(atBranchStart: boolean, boundary: "complete" | "group"): ParseAtomResult {
    const scalar = this.#scalars[this.#index];

    if (scalar === undefined) {
      return { kind: "boundary" };
    }

    const value = scalar.value;

    if (value === "\n") {
      return invalid(scalar.offset, "newline is not supported in patterns");
    }

    if (value === "^") {
      if (!atBranchStart) {
        return invalid(scalar.offset, "start anchor is only valid at a complete or group boundary");
      }

      this.#index += 1;
      return { kind: "atom", expression: { kind: "start-anchor", offset: scalar.offset } };
    }

    if (value === "$") {
      if (!this.#isEndBoundary(this.#index + 1, boundary)) {
        return invalid(scalar.offset, "end anchor is only valid at a complete or group boundary");
      }

      this.#index += 1;
      return { kind: "atom", expression: { kind: "end-anchor", offset: scalar.offset } };
    }

    if (value === ".") {
      this.#index += 1;
      return { kind: "atom", expression: { kind: "atom", offset: scalar.offset, atom: { kind: "dot" } } };
    }

    if (value === "[") {
      return this.#parseBracket();
    }

    if (value === "\\") {
      return this.#parseEscape(boundary);
    }

    if (this.#dialect === "extended" && value === "(") {
      return this.#parseExtendedGroup();
    }

    if (this.#dialect === "extended" && value === ")") {
      return boundary === "group"
        ? { kind: "boundary" }
        : invalid(scalar.offset, "unmatched closing parenthesis");
    }

    if (this.#dialect === "extended" && value === "|") {
      return { kind: "boundary" };
    }

    if (value === "*" || (this.#dialect === "extended" && (value === "+" || value === "?" || value === "{"))) {
      return invalid(scalar.offset, "repetition operator has no preceding expression");
    }

    if (this.#dialect === "extended" && value === "}") {
      return invalid(scalar.offset, "unmatched interval terminator");
    }

    if (value === "(" && this.#nextValue() === "?") {
      return invalid(scalar.offset, "lookaround and atomic groups are not supported");
    }

    this.#index += 1;
    return {
      kind: "atom",
      expression: { kind: "atom", offset: scalar.offset, atom: { kind: "literal", value } },
    };
  }

  #parseEscape(boundary: "complete" | "group"): ParseAtomResult {
    const offset = this.#index;
    const escaped = this.#scalars[this.#index + 1];

    if (escaped === undefined) {
      return invalid(offset, "trailing escape");
    }

    if (escaped.value === "\n") {
      return invalid(escaped.offset, "newline is not supported in patterns");
    }

    if (isDigit(escaped.value)) {
      return invalid(offset, "backreferences are not supported");
    }

    if (escaped.value === "b" || escaped.value === "B" || escaped.value === "w" || escaped.value === "W" || escaped.value === "d" || escaped.value === "D" || escaped.value === "s" || escaped.value === "S") {
      return invalid(offset, "GNU character and word operators are not supported");
    }

    if (this.#dialect === "basic") {
      if (escaped.value === "(") {
        return this.#parseBasicGroup();
      }

      if (escaped.value === ")") {
        return boundary === "group"
          ? { kind: "boundary" }
          : invalid(offset, "unmatched escaped closing parenthesis");
      }

      if (escaped.value === "|" || escaped.value === "+" || escaped.value === "?") {
        return invalid(offset, `GNU \\${escaped.value} is not supported; use -E`);
      }

      if (escaped.value === "{") {
        return invalid(offset, "interval operator has no preceding expression");
      }

      if (!isRegexEscapeLiteral(escaped.value)) {
        return invalid(offset, `unknown escape \\${escaped.value}`);
      }

      this.#index += 2;
      return {
        kind: "atom",
        expression: {
          kind: "atom",
          offset,
          atom: { kind: "literal", value: escaped.value },
        },
      };
    }

    if (escaped.value === "(" || escaped.value === ")" || escaped.value === "{" || escaped.value === "}") {
      return invalid(offset, "escaped BRE operators are not valid with -E");
    }

    if (!isRegexEscapeLiteral(escaped.value)) {
      return invalid(offset, `unknown escape \\${escaped.value}`);
    }

    this.#index += 2;
    return {
      kind: "atom",
      expression: {
        kind: "atom",
        offset,
        atom: { kind: "literal", value: escaped.value },
      },
    };
  }

  #parseBasicGroup(): ParseAtomResult {
    const offset = this.#index;
    this.#index += 2;
    const expression = this.#parseConcatenation("group");

    if (expression.kind !== "expression") {
      return expression;
    }

    if (this.#currentValue() !== "\\" || this.#nextValue() !== ")") {
      return invalid(offset, "unterminated escaped group");
    }

    this.#index += 2;
    return { kind: "atom", expression: expression.expression };
  }

  #parseExtendedGroup(): ParseAtomResult {
    const offset = this.#index;

    if (this.#nextValue() === "?") {
      return invalid(offset, "lookaround and atomic groups are not supported");
    }

    this.#index += 1;
    const expression = this.#parseAlternation("group");

    if (expression.kind !== "expression") {
      return expression;
    }

    if (this.#currentValue() !== ")") {
      return invalid(offset, "unterminated group");
    }

    this.#index += 1;
    return { kind: "atom", expression: expression.expression };
  }

  #parseBracket(): ParseAtomResult {
    const offset = this.#index;
    this.#index += 1;
    const negated = this.#currentValue() === "^";

    if (negated) {
      this.#index += 1;
    }

    const ranges: CharacterRange[] = [];

    while (this.#index < this.#scalars.length && this.#currentValue() !== "]") {
      if (this.#signal.aborted) {
        return { kind: "cancelled" };
      }

      const firstResult = this.#parseBracketScalar(offset);

      if (firstResult.kind === "invalid") {
        return firstResult;
      }

      const first = scalarValue(firstResult.value);

      if (this.#currentValue() === "-" && this.#nextValue() !== "]" && this.#nextValue() !== undefined) {
        const rangeOffset = this.#index;
        this.#index += 1;
        const lastResult = this.#parseBracketScalar(offset);

        if (lastResult.kind === "invalid") {
          return lastResult;
        }

        const last = scalarValue(lastResult.value);

        if (first > last) {
          return invalid(rangeOffset, "bracket range is in descending Unicode scalar order");
        }

        ranges.push({ first, last });
        continue;
      }

      ranges.push({ first, last: first });
    }

    if (this.#currentValue() !== "]") {
      return invalid(offset, "unterminated bracket expression");
    }

    if (ranges.length === 0) {
      return invalid(offset, "empty bracket expression");
    }

    this.#index += 1;
    return {
      kind: "atom",
      expression: {
        kind: "atom",
        offset,
        atom: { kind: "set", set: { negated, ranges } },
      },
    };
  }

  #parseBracketScalar(bracketOffset: number): InvalidResult | Readonly<{ kind: "scalar"; value: string }> {
    const scalar = this.#scalars[this.#index];

    if (scalar === undefined || scalar.value === "]") {
      return invalid(bracketOffset, "malformed bracket expression");
    }

    if (scalar.value === "[") {
      const marker = this.#nextValue();

      if (marker === ":") {
        return invalid(scalar.offset, "POSIX named character classes are not supported");
      }

      if (marker === ".") {
        return invalid(scalar.offset, "collating symbols are not supported");
      }

      if (marker === "=") {
        return invalid(scalar.offset, "equivalence classes are not supported");
      }
    }

    if (scalar.value === "&" && this.#nextValue() === "&") {
      return invalid(scalar.offset, "JavaScript character-set operations are not supported");
    }

    if (scalar.value === "\\") {
      const escaped = this.#scalars[this.#index + 1];

      if (escaped === undefined) {
        return invalid(scalar.offset, "trailing escape in bracket expression");
      }

      if (escaped.value !== "]" && escaped.value !== "-" && escaped.value !== "^" && escaped.value !== "\\" && escaped.value !== "[") {
        return invalid(scalar.offset, `unknown bracket escape \\${escaped.value}`);
      }

      this.#index += 2;
      return { kind: "scalar", value: escaped.value };
    }

    if (scalar.value === "\n") {
      return invalid(scalar.offset, "newline is not supported in patterns");
    }

    this.#index += 1;
    return { kind: "scalar", value: scalar.value };
  }

  #parseRepetition(expression: Expression): ParseExpressionResult {
    const scalar = this.#scalars[this.#index];

    if (scalar === undefined) {
      return { kind: "expression", expression };
    }

    let minimum: number | undefined;
    let maximum: number | "unbounded" | undefined;
    let endIndex = this.#index;

    if (scalar.value === "*") {
      minimum = 0;
      maximum = "unbounded";
      endIndex += 1;
    } else if (this.#dialect === "extended" && scalar.value === "+") {
      minimum = 1;
      maximum = "unbounded";
      endIndex += 1;
    } else if (this.#dialect === "extended" && scalar.value === "?") {
      minimum = 0;
      maximum = 1;
      endIndex += 1;
    } else if (this.#dialect === "extended" && scalar.value === "{") {
      const interval = this.#parseInterval(this.#index, false);

      if (interval.kind === "invalid") {
        return interval;
      }

      minimum = interval.minimum;
      maximum = interval.maximum;
      endIndex = interval.endIndex;
    } else if (this.#dialect === "basic" && scalar.value === "\\" && this.#nextValue() === "{") {
      const interval = this.#parseInterval(this.#index, true);

      if (interval.kind === "invalid") {
        return interval;
      }

      minimum = interval.minimum;
      maximum = interval.maximum;
      endIndex = interval.endIndex;
    }

    if (minimum === undefined || maximum === undefined) {
      return { kind: "expression", expression };
    }

    if (expression.kind === "start-anchor" || expression.kind === "end-anchor") {
      return invalid(scalar.offset, "anchors cannot be repeated");
    }

    this.#index = endIndex;
    const next = this.#currentValue();
    const repeated = next === "*" || (this.#dialect === "extended" && (next === "+" || next === "?" || next === "{"));
    const repeatedBasicInterval = this.#dialect === "basic" && next === "\\" && this.#nextValue() === "{";

    if (repeated || repeatedBasicInterval) {
      return invalid(this.#index, "possessive, lazy, and repeated quantifiers are not supported");
    }

    return {
      kind: "expression",
      expression: {
        kind: "repetition",
        offset: scalar.offset,
        expression,
        minimum,
        maximum,
      },
    };
  }

  #parseInterval(start: number, escaped: boolean): ParseIntervalResult {
    const openingLength = escaped ? 2 : 1;
    let index = start + openingLength;
    const firstDigit = index;

    while (isDigit(this.#valueAt(index) ?? "")) {
      index += 1;
    }

    if (index === firstDigit) {
      return invalid(start, "interval requires a lower bound");
    }

    const minimumResult = this.#intervalNumber(firstDigit, index, start);

    if (minimumResult.kind === "invalid") {
      return minimumResult;
    }

    const closing = escaped ? this.#valueAt(index) === "\\" && this.#valueAt(index + 1) === "}" : this.#valueAt(index) === "}";

    if (closing) {
      return {
        kind: "interval",
        minimum: minimumResult.value,
        maximum: minimumResult.value,
        endIndex: index + (escaped ? 2 : 1),
      };
    }

    if (this.#valueAt(index) !== ",") {
      return invalid(start, "malformed interval");
    }

    index += 1;
    const upperDigit = index;

    while (isDigit(this.#valueAt(index) ?? "")) {
      index += 1;
    }

    const finalClosing = escaped ? this.#valueAt(index) === "\\" && this.#valueAt(index + 1) === "}" : this.#valueAt(index) === "}";

    if (!finalClosing) {
      return invalid(start, "unterminated interval");
    }

    if (index === upperDigit) {
      return {
        kind: "interval",
        minimum: minimumResult.value,
        maximum: "unbounded",
        endIndex: index + (escaped ? 2 : 1),
      };
    }

    const maximumResult = this.#intervalNumber(upperDigit, index, start);

    if (maximumResult.kind === "invalid") {
      return maximumResult;
    }

    if (minimumResult.value > maximumResult.value) {
      return invalid(start, "interval lower bound exceeds its upper bound");
    }

    return {
      kind: "interval",
      minimum: minimumResult.value,
      maximum: maximumResult.value,
      endIndex: index + (escaped ? 2 : 1),
    };
  }

  #intervalNumber(start: number, end: number, offset: number): InvalidResult | Readonly<{ kind: "number"; value: number }> {
    let value = 0;

    for (let index = start; index < end; index += 1) {
      const digit = this.#valueAt(index);

      if (digit === undefined) {
        return invalid(offset, "malformed interval");
      }

      value = value * 10 + (scalarValue(digit) - scalarValue("0"));

      if (value > maximumIntervalBound) {
        return invalid(offset, `interval bounds cannot exceed ${maximumIntervalBound}`);
      }
    }

    return { kind: "number", value };
  }

  #isBoundary(boundary: "complete" | "group"): boolean {
    if (this.#dialect === "extended") {
      return this.#currentValue() === "|" || (boundary === "group" && this.#currentValue() === ")");
    }

    return boundary === "group" && this.#currentValue() === "\\" && this.#nextValue() === ")";
  }

  #isEndBoundary(index: number, boundary: "complete" | "group"): boolean {
    const value = this.#valueAt(index);

    if (value === undefined) {
      return boundary === "complete";
    }

    if (this.#dialect === "extended") {
      return value === "|" || (boundary === "group" && value === ")");
    }

    return boundary === "group" && value === "\\" && this.#valueAt(index + 1) === ")";
  }

  #currentValue(): string | undefined {
    return this.#valueAt(this.#index);
  }

  #nextValue(): string | undefined {
    return this.#valueAt(this.#index + 1);
  }

  #valueAt(index: number): string | undefined {
    return this.#scalars[index]?.value;
  }
}

class ProgramCompiler {
  readonly #signal: AbortSignal;
  readonly #instructions: Instruction[] = [];

  constructor(signal: AbortSignal) {
    this.#signal = signal;
  }

  compile(expression: Expression): CompileResult {
    const fragment = this.#compileExpression(expression);

    if (fragment.kind !== "fragment") {
      return fragment;
    }

    const match = this.#emit({ kind: "match" }, expression.offset);

    if (match.kind === "invalid") {
      return match;
    }

    this.#patch(fragment.fragment.patches, match.instruction);
    return {
      kind: "program",
      start: fragment.fragment.start,
      instructions: this.#instructions,
    };
  }

  #compileExpression(expression: Expression): FragmentResult {
    if (this.#signal.aborted) {
      return { kind: "cancelled" };
    }

    switch (expression.kind) {
      case "epsilon":
        return this.#epsilon(expression.offset);
      case "atom":
        return this.#singleOut({ kind: "character", atom: expression.atom, out: "pending" }, expression.offset);
      case "start-anchor":
        return this.#singleOut({ kind: "start-anchor", out: "pending" }, expression.offset);
      case "end-anchor":
        return this.#singleOut({ kind: "end-anchor", out: "pending" }, expression.offset);
      case "concatenation":
        return this.#compileConcatenation(expression);
      case "alternation":
        return this.#compileAlternation(expression);
      case "repetition":
        return this.#compileRepetition(expression);
    }
  }

  #compileConcatenation(expression: Extract<Expression, { kind: "concatenation" }>): FragmentResult {
    let combined: Fragment | undefined;

    for (const child of expression.expressions) {
      const result = this.#compileExpression(child);

      if (result.kind !== "fragment") {
        return result;
      }

      if (combined === undefined) {
        combined = result.fragment;
        continue;
      }

      this.#patch(combined.patches, result.fragment.start);
      combined = { start: combined.start, patches: result.fragment.patches };
    }

    return combined === undefined
      ? this.#epsilon(expression.offset)
      : { kind: "fragment", fragment: combined };
  }

  #compileAlternation(expression: Extract<Expression, { kind: "alternation" }>): FragmentResult {
    const first = expression.expressions[0];

    if (first === undefined) {
      return this.#epsilon(expression.offset);
    }

    const firstResult = this.#compileExpression(first);

    if (firstResult.kind !== "fragment") {
      return firstResult;
    }

    let combined = firstResult.fragment;

    for (let index = 1; index < expression.expressions.length; index += 1) {
      const child = expression.expressions[index];

      if (child === undefined) {
        continue;
      }

      const childResult = this.#compileExpression(child);

      if (childResult.kind !== "fragment") {
        return childResult;
      }

      const split = this.#emit({ kind: "split", first: combined.start, second: childResult.fragment.start }, expression.offset);

      if (split.kind === "invalid") {
        return split;
      }

      combined = {
        start: split.instruction,
        patches: [...combined.patches, ...childResult.fragment.patches],
      };
    }

    return { kind: "fragment", fragment: combined };
  }

  #compileRepetition(expression: Extract<Expression, { kind: "repetition" }>): FragmentResult {
    let combined: Fragment | undefined;

    for (let count = 0; count < expression.minimum; count += 1) {
      const required = this.#compileExpression(expression.expression);

      if (required.kind !== "fragment") {
        return required;
      }

      combined = this.#concatenateFragments(combined, required.fragment);
    }

    if (expression.maximum === "unbounded") {
      const repeated = this.#compileExpression(expression.expression);

      if (repeated.kind !== "fragment") {
        return repeated;
      }

      const split = this.#emit({ kind: "split", first: repeated.fragment.start, second: "pending" }, expression.offset);

      if (split.kind === "invalid") {
        return split;
      }

      this.#patch(repeated.fragment.patches, split.instruction);
      const star: Fragment = {
        start: split.instruction,
        patches: [{ kind: "second", instruction: split.instruction }],
      };
      combined = this.#concatenateFragments(combined, star);
    } else {
      for (let count = expression.minimum; count < expression.maximum; count += 1) {
        const optional = this.#compileExpression(expression.expression);

        if (optional.kind !== "fragment") {
          return optional;
        }

        const split = this.#emit({ kind: "split", first: optional.fragment.start, second: "pending" }, expression.offset);

        if (split.kind === "invalid") {
          return split;
        }

        const fragment: Fragment = {
          start: split.instruction,
          patches: [
            ...optional.fragment.patches,
            { kind: "second", instruction: split.instruction },
          ],
        };
        combined = this.#concatenateFragments(combined, fragment);
      }
    }

    return combined === undefined
      ? this.#epsilon(expression.offset)
      : { kind: "fragment", fragment: combined };
  }

  #concatenateFragments(first: Fragment | undefined, second: Fragment): Fragment {
    if (first === undefined) {
      return second;
    }

    this.#patch(first.patches, second.start);
    return { start: first.start, patches: second.patches };
  }

  #epsilon(offset: number): FragmentResult {
    return this.#singleOut({ kind: "jump", out: "pending" }, offset);
  }

  #singleOut(instruction: Instruction, offset: number): FragmentResult {
    const emitted = this.#emit(instruction, offset);

    if (emitted.kind === "invalid") {
      return emitted;
    }

    return {
      kind: "fragment",
      fragment: {
        start: emitted.instruction,
        patches: [{ kind: "out", instruction: emitted.instruction }],
      },
    };
  }

  #emit(instruction: Instruction, offset: number): InvalidResult | Readonly<{ kind: "instruction"; instruction: number }> {
    if (this.#instructions.length >= maximumProgramInstructions) {
      return invalid(offset, `compiled program exceeds ${maximumProgramInstructions} instructions`);
    }

    const index = this.#instructions.length;
    this.#instructions.push(instruction);
    return { kind: "instruction", instruction: index };
  }

  #patch(patches: ReadonlyArray<Patch>, target: number): void {
    for (const patch of patches) {
      const instruction = this.#instructions[patch.instruction];

      if (instruction === undefined) {
        throw new Error("Compiled pattern patches must reference emitted instructions.");
      }

      switch (patch.kind) {
        case "out":
          if (instruction.kind === "character" || instruction.kind === "jump" || instruction.kind === "start-anchor" || instruction.kind === "end-anchor") {
            instruction.out = target;
            break;
          }
          throw new Error("Compiled pattern out patches must reference single-out instructions.");
        case "second":
          if (instruction.kind !== "split") {
            throw new Error("Compiled pattern second patches must reference split instructions.");
          }
          instruction.second = target;
          break;
      }
    }
  }
}

function fixedExpression(scalars: ReadonlyArray<PatternScalar>): Expression {
  return concatenation(
    scalars.map((scalar) => ({
      kind: "atom",
      offset: scalar.offset,
      atom: { kind: "literal", value: scalar.value },
    })),
    0,
  );
}

function atomMatches(atom: Atom, value: string, asciiInsensitive: boolean): boolean {
  if (atom.kind === "dot") {
    return value !== "\n";
  }

  if (atom.kind === "literal") {
    return value === atom.value || (asciiInsensitive && toggledAsciiCase(value) === atom.value);
  }

  const candidate = scalarValue(value);
  const alternate = asciiInsensitive && isAsciiLetter(value)
    ? scalarValue(toggledAsciiCase(value))
    : candidate;
  const contained = atom.set.ranges.some(
    (range) =>
      (candidate >= range.first && candidate <= range.last) ||
      (alternate >= range.first && alternate <= range.last),
  );
  return atom.set.negated ? !contained : contained;
}

function resolvedOut(value: number | "pending"): number {
  if (value === "pending") {
    throw new Error("Compiled patterns must not contain pending instruction edges.");
  }

  return value;
}

function addThread(
  instructions: ReadonlyArray<Instruction>,
  threads: Map<number, number>,
  initial: Thread,
  position: number,
  inputLength: number,
  signal: AbortSignal,
): "added" | "cancelled" {
  const pending: Thread[] = [initial];

  while (pending.length > 0) {
    if (signal.aborted) {
      return "cancelled";
    }

    const thread = pending.pop();

    if (thread === undefined) {
      continue;
    }

    const existingStart = threads.get(thread.instruction);

    if (existingStart !== undefined && existingStart <= thread.start) {
      continue;
    }

    threads.set(thread.instruction, thread.start);
    const instruction = instructions[thread.instruction];

    if (instruction === undefined) {
      throw new Error("Compiled pattern threads must reference emitted instructions.");
    }

    switch (instruction.kind) {
      case "jump":
        pending.push({ instruction: resolvedOut(instruction.out), start: thread.start });
        break;
      case "split":
        pending.push({ instruction: resolvedOut(instruction.second), start: thread.start });
        pending.push({ instruction: resolvedOut(instruction.first), start: thread.start });
        break;
      case "start-anchor":
        if (position === 0) {
          pending.push({ instruction: resolvedOut(instruction.out), start: thread.start });
        }
        break;
      case "end-anchor":
        if (position === inputLength) {
          pending.push({ instruction: resolvedOut(instruction.out), start: thread.start });
        }
        break;
      case "character":
      case "match":
        break;
    }
  }

  return "added";
}

function scalarInput(value: string): ReadonlyArray<string> {
  return Array.from(value);
}

export class ConstrainedPosixPattern {
  readonly #instructions: ReadonlyArray<Instruction>;
  readonly #start: number;
  readonly #asciiInsensitive: boolean;

  private constructor(
    instructions: ReadonlyArray<Instruction>,
    start: number,
    caseSensitivity: ConstrainedPosixPatternOptions["caseSensitivity"],
  ) {
    this.#instructions = instructions;
    this.#start = start;
    this.#asciiInsensitive = caseSensitivity === "ascii-insensitive";
  }

  static compile(
    source: string,
    options: ConstrainedPosixPatternOptions,
    signal: AbortSignal,
  ): ConstrainedPosixPatternCompilation {
    if (signal.aborted) {
      return { kind: "cancelled" };
    }

    const scalarsResult = patternScalars(source);

    if (scalarsResult.kind === "invalid") {
      return invalidCompilation(scalarsResult);
    }

    if (scalarsResult.scalars.length > maximumPatternScalars) {
      return invalidCompilation(invalid(maximumPatternScalars, `pattern exceeds ${maximumPatternScalars} Unicode scalars`));
    }

    if (source.length > maximumPatternCodeUnits) {
      return invalidCompilation(invalid(scalarsResult.scalars.length, `pattern exceeds ${maximumPatternCodeUnits} UTF-16 code units`));
    }

    if (scalarsResult.scalars.some((scalar) => scalar.value === "\n")) {
      const newline = scalarsResult.scalars.find((scalar) => scalar.value === "\n");
      return invalidCompilation(invalid(newline?.offset ?? 0, "newline is not supported in patterns"));
    }

    const parsed = options.dialect === "fixed"
      ? { kind: "parsed", expression: fixedExpression(scalarsResult.scalars) } satisfies ParseResult
      : new PatternParser(scalarsResult.scalars, options.dialect, signal).parse();

    if (parsed.kind === "cancelled") {
      return parsed;
    }

    if (parsed.kind === "invalid") {
      return invalidCompilation(parsed);
    }

    const compiled = new ProgramCompiler(signal).compile(parsed.expression);

    if (compiled.kind === "cancelled") {
      return compiled;
    }

    if (compiled.kind === "invalid") {
      return invalidCompilation(compiled);
    }

    return {
      kind: "compiled",
      pattern: new ConstrainedPosixPattern(
        compiled.instructions,
        compiled.start,
        options.caseSensitivity,
      ),
    };
  }

  findMatch(input: string, signal: AbortSignal): ConstrainedPosixMatchResult {
    if (signal.aborted) {
      return { kind: "cancelled" };
    }

    const scalars = scalarInput(input);
    let active = new Map<number, number>();
    let best: ConstrainedPosixMatchSpan | undefined;

    for (let position = 0; position <= scalars.length; position += 1) {
      if (signal.aborted) {
        return { kind: "cancelled" };
      }

      if (best === undefined || position <= best.start) {
        const added = addThread(
          this.#instructions,
          active,
          { instruction: this.#start, start: position },
          position,
          scalars.length,
          signal,
        );

        if (added === "cancelled") {
          return { kind: "cancelled" };
        }
      }

      for (const [instructionIndex, start] of active) {
        if (signal.aborted) {
          return { kind: "cancelled" };
        }

        const instruction = this.#instructions[instructionIndex];

        if (instruction?.kind !== "match") {
          continue;
        }

        if (best === undefined || start < best.start || (start === best.start && position > best.end)) {
          best = { start, end: position };
        }
      }

      if (position === scalars.length) {
        break;
      }

      const value = scalars[position];

      if (value === undefined) {
        continue;
      }

      const next = new Map<number, number>();

      for (const [instructionIndex, start] of active) {
        if (signal.aborted) {
          return { kind: "cancelled" };
        }

        if (best !== undefined && start > best.start) {
          continue;
        }

        const instruction = this.#instructions[instructionIndex];

        if (instruction?.kind !== "character" || !atomMatches(instruction.atom, value, this.#asciiInsensitive)) {
          continue;
        }

        const added = addThread(
          this.#instructions,
          next,
          { instruction: resolvedOut(instruction.out), start },
          position + 1,
          scalars.length,
          signal,
        );

        if (added === "cancelled") {
          return { kind: "cancelled" };
        }
      }

      active = next;
    }

    return best === undefined ? { kind: "unmatched" } : { kind: "matched", span: best };
  }
}
