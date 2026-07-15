import {
  VimMode,
  applyNormalVimKey,
  createVimBuffer,
  insertVimText,
  moveVimInsertCursorToTextOffset,
  normalVimKeyFromKeyboard,
  replaceVimInsertText,
  type VimBuffer,
  type VimDigit,
  type VimNormalKey,
  type VimRegister,
} from "../vim/VimBuffer.ts";
import { normalizeUnicodeCursorOffset } from "./UnicodeCursor.ts";

export type VimPromptMode = Extract<
  VimMode,
  Readonly<{ kind: "normal" | "insert" }>
>;

export type VimPromptKey =
  | Readonly<{
      kind: "digit";
      digit: VimDigit;
    }>
  | Readonly<{
      kind: "motion";
      motion:
        | "left"
        | "right"
        | "word-forward"
        | "word-backward"
        | "word-end"
        | "line-start"
        | "line-end";
    }>
  | Readonly<{
      kind: "operator";
      operator: "delete" | "change";
    }>
  | Readonly<{ kind: "delete-character" }>
  | Readonly<{ kind: "paste-after" }>
  | Readonly<{ kind: "paste-before" }>
  | Readonly<{ kind: "undo" }>
  | Readonly<{ kind: "redo" }>
  | Readonly<{ kind: "history-older" }>
  | Readonly<{ kind: "history-newer" }>
  | Readonly<{ kind: "insert-before" }>
  | Readonly<{ kind: "insert-after" }>
  | Readonly<{ kind: "insert-line-start" }>
  | Readonly<{ kind: "insert-line-end" }>
  | Readonly<{ kind: "escape" }>;

export type VimPromptKeyMatch =
  | Readonly<{
      kind: "recognized";
      key: VimPromptKey;
    }>
  | Readonly<{ kind: "unrecognized" }>;

export type CreateVimPromptOptions = Readonly<{
  text: string;
  mode: VimPromptMode;
  register: VimRegister;
}>;

type CanonicalVimPromptReplacement = Readonly<{
  text: string;
  cursor: number;
}>;

function canonicaliseVimPromptText(text: string): string {
  return text.replace(/\r\n|\r|\n/gu, " ");
}

function canonicaliseVimPromptReplacement(
  text: string,
  cursor: number,
): CanonicalVimPromptReplacement {
  const sourceCursor = normalizeUnicodeCursorOffset(text, cursor);

  return {
    text: canonicaliseVimPromptText(text),
    cursor: canonicaliseVimPromptText(text.slice(0, sourceCursor)).length,
  };
}

function projectPromptRegister(register: VimRegister): VimRegister {
  if (register.kind !== "line") {
    return register;
  }

  return { kind: "character", text: register.lines.join("\n") };
}

export function createVimPrompt({
  text,
  mode,
  register,
}: CreateVimPromptOptions): VimBuffer {
  const canonicalText = canonicaliseVimPromptText(text);
  const insertBuffer = moveVimInsertCursorToTextOffset(
    createVimBuffer({ text: canonicalText, mode: VimMode.Insert }),
    canonicalText.length,
  );
  const buffer =
    mode.kind === "normal"
      ? applyNormalVimKey(insertBuffer, { kind: "escape" })
      : insertBuffer;

  return {
    ...buffer,
    register: projectPromptRegister(register),
  };
}

export function createEmptyVimPrompt(): VimBuffer {
  return createVimPrompt({
    text: "",
    mode: VimMode.Insert,
    register: { kind: "empty" },
  });
}

export function insertVimPromptText(
  buffer: VimBuffer,
  text: string,
): VimBuffer {
  return insertVimText(buffer, canonicaliseVimPromptText(text));
}

export function replaceVimPromptText(
  buffer: VimBuffer,
  text: string,
  cursor: number,
): VimBuffer {
  if (buffer.mode.kind !== "insert") {
    return buffer;
  }

  const replacement = canonicaliseVimPromptReplacement(text, cursor);

  return replaceVimInsertText(buffer, replacement.text, replacement.cursor);
}

export function vimPromptMode(buffer: VimBuffer): VimPromptMode {
  if (buffer.mode.kind === "normal" || buffer.mode.kind === "insert") {
    return buffer.mode;
  }

  throw new Error("Vim prompt buffers must remain in normal or insert mode.");
}

export function applyVimPromptKey(
  buffer: VimBuffer,
  key: VimPromptKey,
): VimBuffer {
  if (key.kind === "history-older" || key.kind === "history-newer") {
    return buffer;
  }

  const next = applyNormalVimKey(buffer, key);

  if (next.register.kind !== "line") {
    return next;
  }

  return {
    ...next,
    register: projectPromptRegister(next.register),
  };
}

function vimPromptKeyMatch(key: VimNormalKey): VimPromptKeyMatch {
  if (key.kind === "digit") {
    return { kind: "recognized", key };
  }

  if (key.kind === "motion") {
    switch (key.motion) {
      case "left":
      case "right":
      case "word-forward":
      case "word-backward":
      case "word-end":
      case "line-start":
      case "line-end":
        return {
          kind: "recognized",
          key: { kind: "motion", motion: key.motion },
        };
      case "line-previous":
      case "line-next":
      case "document-start":
      case "document-end":
        return { kind: "unrecognized" };
    }
  }

  if (key.kind === "operator") {
    if (key.operator === "delete" || key.operator === "change") {
      return {
        kind: "recognized",
        key: { kind: "operator", operator: key.operator },
      };
    }

    return { kind: "unrecognized" };
  }

  switch (key.kind) {
    case "delete-character":
    case "paste-after":
    case "paste-before":
    case "undo":
    case "redo":
    case "insert-before":
    case "insert-after":
    case "insert-line-start":
    case "insert-line-end":
    case "escape":
      return { kind: "recognized", key };
    case "enter-visual-line":
    case "enter-command":
    case "enter-search":
    case "search-next":
    case "search-previous":
      return { kind: "unrecognized" };
  }
}

export function normalVimPromptKeyFromKeyboard(
  key: string,
  ctrlKey: boolean,
  metaKey: boolean,
): VimPromptKeyMatch {
  if (!ctrlKey && !metaKey) {
    if (key === "j") {
      return { kind: "recognized", key: { kind: "history-newer" } };
    }

    if (key === "k") {
      return { kind: "recognized", key: { kind: "history-older" } };
    }

    if (key === "Home") {
      return {
        kind: "recognized",
        key: { kind: "motion", motion: "line-start" },
      };
    }
  }

  const match = normalVimKeyFromKeyboard(key, ctrlKey, metaKey);

  if (match.kind === "unrecognized") {
    return match;
  }

  return vimPromptKeyMatch(match.key);
}
