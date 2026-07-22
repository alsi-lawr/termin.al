declare const sourceOffsetBrand: unique symbol;
declare const argumentIndexBrand: unique symbol;

export type SourceOffset = number & {
  readonly [sourceOffsetBrand]: "SourceOffset";
};

export type ArgumentIndex = number & {
  readonly [argumentIndexBrand]: "ArgumentIndex";
};

export type ShellOperator = ";" | "&&" | "||" | "|" | "&";
export type RedirectionOperator = "<" | ">" | ">>" | "<>" | "<&" | ">&" | ">|";

export type LexedArgument = Readonly<{
  kind: "argument";
  value: string;
  protectedGlobMetacharacterOffsets: ReadonlyArray<number>;
  sourceStart: SourceOffset;
  sourceEnd: SourceOffset;
}>;

export type LexedOptionTerminator = Readonly<{
  kind: "option-terminator";
  argumentIndex: ArgumentIndex;
  sourceStart: SourceOffset;
  sourceEnd: SourceOffset;
}>;

export type LexedOperator = Readonly<{
  kind: "operator";
  operator: ShellOperator;
  position: SourceOffset;
}>;

export type LexedRedirection = Readonly<{
  kind: "redirection";
  descriptor: number;
  operator: RedirectionOperator;
  position: SourceOffset;
}>;

export type ArgumentLexerToken =
  | LexedArgument
  | LexedOptionTerminator
  | LexedOperator
  | LexedRedirection;

export type OptionTerminator =
  | Readonly<{ kind: "absent" }>
  | Readonly<{
      kind: "present";
      argumentIndex: ArgumentIndex;
      sourceStart: SourceOffset;
      sourceEnd: SourceOffset;
    }>;

export type ArgumentLexerError =
  | Readonly<{
      kind: "unterminated-single-quote";
      position: SourceOffset;
    }>
  | Readonly<{
      kind: "unterminated-double-quote";
      position: SourceOffset;
    }>
  | Readonly<{
      kind: "trailing-escape";
      position: SourceOffset;
    }>
  | Readonly<{
      kind: "unsupported-background-operator";
      position: SourceOffset;
    }>
  | Readonly<{
      kind: "unsupported-redirection";
      position: SourceOffset;
    }>
  | Readonly<{
      kind: "unsupported-file-descriptor";
      position: SourceOffset;
    }>;

export type CommandListParseError =
  | Readonly<{
      kind: "unexpected-operator";
      position: SourceOffset;
    }>
  | Readonly<{
      kind: "trailing-operator";
      position: SourceOffset;
    }>
  | Readonly<{
      kind: "missing-redirection-operand";
      position: SourceOffset;
    }>
  | Readonly<{
      kind: "invalid-redirection-operand";
      position: SourceOffset;
    }>;

export type ShellSyntaxError = ArgumentLexerError | CommandListParseError;

export type ArgumentLexerResult =
  | Readonly<{
      kind: "success";
      tokens: ReadonlyArray<ArgumentLexerToken>;
    }>
  | Readonly<{
      kind: "error";
      error: ArgumentLexerError;
    }>;

type LexerMode =
  | Readonly<{ kind: "unquoted" }>
  | Readonly<{
      kind: "single-quoted";
      position: SourceOffset;
    }>
  | Readonly<{
      kind: "double-quoted";
      position: SourceOffset;
    }>;

const unquotedMode: LexerMode = { kind: "unquoted" };
const whitespacePattern = /\s/u;

function createSourceOffset(value: number, source: string): SourceOffset {
  if (!Number.isSafeInteger(value) || value < 0 || value > source.length) {
    throw new Error("Source offsets must reference a character boundary.");
  }

  return value as SourceOffset;
}

export function createArgumentIndex(value: number): ArgumentIndex {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Argument indexes must be non-negative integers.");
  }

  return value as ArgumentIndex;
}

function shellOperatorAt(
  source: string,
  position: number,
): ShellOperator | undefined {
  const character = source[position];
  const nextCharacter = source[position + 1];

  if (character === ";") {
    return ";";
  }

  if (character === "&" && nextCharacter === "&") {
    return "&&";
  }

  if (character === "&") {
    return "&";
  }

  if (character === "|" && nextCharacter === "|") {
    return "||";
  }

  if (character === "|") {
    return "|";
  }

  return undefined;
}

function redirectionOperatorAt(
  source: string,
  position: number,
): RedirectionOperator | undefined {
  const pair = source.slice(position, position + 2);

  if (pair === ">>" || pair === "<>" || pair === "<&" || pair === ">&" || pair === ">|") {
    return pair;
  }

  const character = source[position];
  return character === "<" || character === ">" ? character : undefined;
}

function defaultRedirectionDescriptor(operator: RedirectionOperator): number {
  return operator.startsWith("<") ? 0 : 1;
}

function protectGlobMetacharacter(
  value: string,
  protectedGlobMetacharacterOffsets: number[],
  character: string,
): void {
  if ("*?[]-".includes(character)) {
    protectedGlobMetacharacterOffsets.push(value.length);
  }
}

export function lexArguments(source: string): ArgumentLexerResult {
  const tokens: ArgumentLexerToken[] = [];
  let mode: LexerMode = unquotedMode;
  let value = "";
  let argumentStart = 0;
  let argumentOpen = false;
  let argumentUsesSyntax = false;
  let protectedGlobMetacharacterOffsets: number[] = [];
  let argumentIndex = 0;

  const beginArgument = (position: number): void => {
    if (argumentOpen) {
      return;
    }

    argumentOpen = true;
    argumentStart = position;
  };

  const finishArgument = (position: number): void => {
    if (!argumentOpen) {
      return;
    }

    const sourceStart = createSourceOffset(argumentStart, source);
    const sourceEnd = createSourceOffset(position, source);
    const isOptionTerminator = value === "--" && !argumentUsesSyntax;

    if (isOptionTerminator) {
      tokens.push({
        kind: "option-terminator",
        argumentIndex: createArgumentIndex(argumentIndex),
        sourceStart,
        sourceEnd,
      });
    } else {
      tokens.push({
        kind: "argument",
        value,
        protectedGlobMetacharacterOffsets,
        sourceStart,
        sourceEnd,
      });
      argumentIndex += 1;
    }

    value = "";
    argumentOpen = false;
    argumentUsesSyntax = false;
    protectedGlobMetacharacterOffsets = [];
  };

  const appendOperator = (operator: ShellOperator, position: number): void => {
    finishArgument(position);
    tokens.push({
      kind: "operator",
      operator,
      position: createSourceOffset(position, source),
    });
    argumentIndex = 0;
  };

  const appendRedirection = (
    operator: RedirectionOperator,
    position: number,
  ): ArgumentLexerError | undefined => {
    const descriptorText = argumentOpen && !argumentUsesSyntax && /^\d+$/u.test(value)
      ? value
      : undefined;

    if (descriptorText !== undefined && descriptorText.length !== 1) {
      return {
        kind: "unsupported-file-descriptor",
        position: createSourceOffset(argumentStart, source),
      };
    }

    if (descriptorText === undefined) {
      finishArgument(position);
    } else {
      value = "";
      argumentOpen = false;
      argumentUsesSyntax = false;
      protectedGlobMetacharacterOffsets = [];
    }

    tokens.push({
      kind: "redirection",
      descriptor: descriptorText === undefined
        ? defaultRedirectionDescriptor(operator)
        : Number(descriptorText),
      operator,
      position: createSourceOffset(position, source),
    });
    return undefined;
  };

  for (let position = 0; position < source.length; position += 1) {
    const character = source[position];

    if (mode.kind === "single-quoted") {
      if (character === "'") {
        mode = unquotedMode;
      } else {
        protectGlobMetacharacter(value, protectedGlobMetacharacterOffsets, character);
        value += character;
      }

      continue;
    }

    if (mode.kind === "double-quoted") {
      if (character === '"') {
        mode = unquotedMode;
        continue;
      }

      if (character === "\\") {
        if (position + 1 >= source.length) {
          return {
            kind: "error",
            error: {
              kind: "trailing-escape",
              position: createSourceOffset(position, source),
            },
          };
        }

        argumentUsesSyntax = true;
        position += 1;
        protectGlobMetacharacter(
          value,
          protectedGlobMetacharacterOffsets,
          source[position] ?? "",
        );
        value += source[position];
        continue;
      }

      protectGlobMetacharacter(value, protectedGlobMetacharacterOffsets, character);
      value += character;
      continue;
    }

    if (whitespacePattern.test(character)) {
      finishArgument(position);
      continue;
    }

    if (character === "<" && source[position + 1] === "<") {
      return {
        kind: "error",
        error: {
          kind: "unsupported-redirection",
          position: createSourceOffset(position, source),
        },
      };
    }

    const redirection = redirectionOperatorAt(source, position);

    if (redirection !== undefined) {
      const error = appendRedirection(redirection, position);

      if (error !== undefined) {
        return { kind: "error", error };
      }

      if (redirection.length === 2) {
        position += 1;
      }

      continue;
    }

    const operator = shellOperatorAt(source, position);

    if (operator !== undefined) {
      appendOperator(operator, position);

      if (operator === "&&" || operator === "||") {
        position += 1;
      }

      continue;
    }

    if (character === "'") {
      beginArgument(position);
      argumentUsesSyntax = true;
      mode = {
        kind: "single-quoted",
        position: createSourceOffset(position, source),
      };
      continue;
    }

    if (character === '"') {
      beginArgument(position);
      argumentUsesSyntax = true;
      mode = {
        kind: "double-quoted",
        position: createSourceOffset(position, source),
      };
      continue;
    }

    if (character === "\\") {
      beginArgument(position);

      if (position + 1 >= source.length) {
        return {
          kind: "error",
          error: {
            kind: "trailing-escape",
            position: createSourceOffset(position, source),
          },
        };
      }

      argumentUsesSyntax = true;
      position += 1;
      protectGlobMetacharacter(
        value,
        protectedGlobMetacharacterOffsets,
        source[position] ?? "",
      );
      value += source[position];
      continue;
    }

    beginArgument(position);
    value += character;
  }

  if (mode.kind === "single-quoted") {
    return {
      kind: "error",
      error: {
        kind: "unterminated-single-quote",
        position: mode.position,
      },
    };
  }

  if (mode.kind === "double-quoted") {
    return {
      kind: "error",
      error: {
        kind: "unterminated-double-quote",
        position: mode.position,
      },
    };
  }

  finishArgument(source.length);

  return { kind: "success", tokens };
}
