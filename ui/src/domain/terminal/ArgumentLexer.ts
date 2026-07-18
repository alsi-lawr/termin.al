declare const sourceOffsetBrand: unique symbol;
declare const argumentIndexBrand: unique symbol;

export type SourceOffset = number & {
  readonly [sourceOffsetBrand]: "SourceOffset";
};

export type ArgumentIndex = number & {
  readonly [argumentIndexBrand]: "ArgumentIndex";
};

export type ShellOperator = ";" | "&&" | "||" | "|" | "&";

export type LexedArgument = Readonly<{
  kind: "argument";
  value: string;
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

export type ArgumentLexerToken =
  | LexedArgument
  | LexedOptionTerminator
  | LexedOperator;

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
    }>;

export type CommandListParseError =
  | Readonly<{
      kind: "unexpected-operator";
      position: SourceOffset;
    }>
  | Readonly<{
      kind: "trailing-operator";
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

function createArgumentIndex(value: number): ArgumentIndex {
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

export function lexArguments(source: string): ArgumentLexerResult {
  const tokens: ArgumentLexerToken[] = [];
  let mode: LexerMode = unquotedMode;
  let value = "";
  let argumentStart = 0;
  let argumentOpen = false;
  let argumentUsesSyntax = false;
  let argumentIndex = 0;
  let optionTerminatorSeen = false;

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
    const isOptionTerminator =
      !optionTerminatorSeen && value === "--" && !argumentUsesSyntax;

    if (isOptionTerminator) {
      tokens.push({
        kind: "option-terminator",
        argumentIndex: createArgumentIndex(argumentIndex),
        sourceStart,
        sourceEnd,
      });
      optionTerminatorSeen = true;
    } else {
      tokens.push({ kind: "argument", value, sourceStart, sourceEnd });
      argumentIndex += 1;
    }

    value = "";
    argumentOpen = false;
    argumentUsesSyntax = false;
  };

  const appendOperator = (operator: ShellOperator, position: number): void => {
    finishArgument(position);
    tokens.push({
      kind: "operator",
      operator,
      position: createSourceOffset(position, source),
    });
    argumentIndex = 0;
    optionTerminatorSeen = false;
  };

  for (let position = 0; position < source.length; position += 1) {
    const character = source[position];

    if (mode.kind === "single-quoted") {
      if (character === "'") {
        mode = unquotedMode;
      } else {
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
        value += source[position];
        continue;
      }

      value += character;
      continue;
    }

    if (whitespacePattern.test(character)) {
      finishArgument(position);
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
