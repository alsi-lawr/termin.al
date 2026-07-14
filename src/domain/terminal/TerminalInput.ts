export type TerminalInput = Readonly<{
  value: string;
  cursor: number;
}>;

export type CreateTerminalInputOptions = Readonly<{
  value: string;
  cursor: number;
}>;

export function createTerminalInput({
  value,
  cursor,
}: CreateTerminalInputOptions): TerminalInput {
  if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > value.length) {
    throw new Error("Terminal input cursors must reference a character boundary.");
  }

  return { value, cursor };
}

export function createEmptyTerminalInput(): TerminalInput {
  return createTerminalInput({ value: "", cursor: 0 });
}

export function insertTerminalInputText(
  input: TerminalInput,
  text: string,
): TerminalInput {
  const nextValue =
    input.value.slice(0, input.cursor) +
    text +
    input.value.slice(input.cursor);

  return createTerminalInput({
    value: nextValue,
    cursor: input.cursor + text.length,
  });
}

export function moveTerminalInputCursorLeft(
  input: TerminalInput,
): TerminalInput {
  return createTerminalInput({
    value: input.value,
    cursor: Math.max(0, input.cursor - 1),
  });
}

export function moveTerminalInputCursorRight(
  input: TerminalInput,
): TerminalInput {
  return createTerminalInput({
    value: input.value,
    cursor: Math.min(input.value.length, input.cursor + 1),
  });
}

export function backspaceTerminalInput(input: TerminalInput): TerminalInput {
  if (input.cursor === 0) {
    return input;
  }

  return createTerminalInput({
    value:
      input.value.slice(0, input.cursor - 1) +
      input.value.slice(input.cursor),
    cursor: input.cursor - 1,
  });
}

export function deleteTerminalInputAtCursor(
  input: TerminalInput,
): TerminalInput {
  if (input.cursor === input.value.length) {
    return input;
  }

  return createTerminalInput({
    value:
      input.value.slice(0, input.cursor) +
      input.value.slice(input.cursor + 1),
    cursor: input.cursor,
  });
}
