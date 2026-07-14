declare const promptCursorBrand: unique symbol;

export type PromptCursor = number & {
  readonly [promptCursorBrand]: "PromptCursor";
};

export type PromptMode =
  | Readonly<{ kind: "insert" }>
  | Readonly<{ kind: "normal" }>;

export const PromptMode = {
  Insert: { kind: "insert" },
  Normal: { kind: "normal" },
} as const satisfies Readonly<{
  Insert: PromptMode;
  Normal: PromptMode;
}>;

export type PromptBuffer = Readonly<{
  value: string;
  cursor: PromptCursor;
  mode: PromptMode;
}>;

export type CreatePromptBufferOptions = Readonly<{
  value: string;
  cursor: number;
  mode: PromptMode;
}>;

function createPromptCursor(value: number, length: number): PromptCursor {
  if (!Number.isSafeInteger(value) || value < 0 || value > length) {
    throw new Error("Prompt cursors must reference a character boundary.");
  }

  return value as PromptCursor;
}

export function createPromptBuffer({
  value,
  cursor,
  mode,
}: CreatePromptBufferOptions): PromptBuffer {
  return {
    value,
    cursor: createPromptCursor(cursor, value.length),
    mode,
  };
}

export function createEmptyPromptBuffer(): PromptBuffer {
  return createPromptBuffer({
    value: "",
    cursor: 0,
    mode: PromptMode.Insert,
  });
}

export function insertPromptText(
  buffer: PromptBuffer,
  text: string,
): PromptBuffer {
  const value =
    buffer.value.slice(0, buffer.cursor) +
    text +
    buffer.value.slice(buffer.cursor);

  return createPromptBuffer({
    value,
    cursor: buffer.cursor + text.length,
    mode: buffer.mode,
  });
}

export function movePromptCursorLeft(buffer: PromptBuffer): PromptBuffer {
  return createPromptBuffer({
    value: buffer.value,
    cursor: Math.max(0, buffer.cursor - 1),
    mode: buffer.mode,
  });
}

export function movePromptCursorRight(buffer: PromptBuffer): PromptBuffer {
  return createPromptBuffer({
    value: buffer.value,
    cursor: Math.min(buffer.value.length, buffer.cursor + 1),
    mode: buffer.mode,
  });
}

export function backspacePromptBuffer(buffer: PromptBuffer): PromptBuffer {
  if (buffer.cursor === 0) {
    return buffer;
  }

  return createPromptBuffer({
    value:
      buffer.value.slice(0, buffer.cursor - 1) +
      buffer.value.slice(buffer.cursor),
    cursor: buffer.cursor - 1,
    mode: buffer.mode,
  });
}

export function deletePromptBufferAtCursor(
  buffer: PromptBuffer,
): PromptBuffer {
  if (buffer.cursor === buffer.value.length) {
    return buffer;
  }

  return createPromptBuffer({
    value:
      buffer.value.slice(0, buffer.cursor) +
      buffer.value.slice(buffer.cursor + 1),
    cursor: buffer.cursor,
    mode: buffer.mode,
  });
}

export function setPromptMode(
  buffer: PromptBuffer,
  mode: PromptMode,
): PromptBuffer {
  return createPromptBuffer({
    value: buffer.value,
    cursor: buffer.cursor,
    mode,
  });
}
