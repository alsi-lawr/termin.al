declare const sourceOffsetBrand: unique symbol;
declare const argumentIndexBrand: unique symbol;

export type SourceOffset = number & {
  readonly [sourceOffsetBrand]: "SourceOffset";
};

export type ArgumentIndex = number & {
  readonly [argumentIndexBrand]: "ArgumentIndex";
};

export type LexedArgument = Readonly<{
  value: string;
  sourceStart: SourceOffset;
  sourceEnd: SourceOffset;
}>;

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
    }>;

export type ArgumentLexerResult =
  | Readonly<{
      kind: "success";
      arguments: ReadonlyArray<LexedArgument>;
      optionTerminator: OptionTerminator;
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

export function lexArguments(source: string): ArgumentLexerResult {
  const argumentsList: LexedArgument[] = [];
  let optionTerminator: OptionTerminator = { kind: "absent" };
  let mode: LexerMode = unquotedMode;
  let value = "";
  let argumentStart = 0;
  let argumentOpen = false;
  let argumentUsesSyntax = false;

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
      optionTerminator.kind === "absent" &&
      value === "--" &&
      !argumentUsesSyntax;

    if (isOptionTerminator) {
      optionTerminator = {
        kind: "present",
        argumentIndex: createArgumentIndex(argumentsList.length),
        sourceStart,
        sourceEnd,
      };
    } else {
      argumentsList.push({ value, sourceStart, sourceEnd });
    }

    value = "";
    argumentOpen = false;
    argumentUsesSyntax = false;
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

  return {
    kind: "success",
    arguments: argumentsList,
    optionTerminator,
  };
}
