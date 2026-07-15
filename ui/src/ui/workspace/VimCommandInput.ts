import {
  appendVimCommandInput,
  applyNormalVimKey,
  backspaceVimCommandInput,
  submitVimCommand,
  type VimBuffer,
} from "../../domain/vim/VimBuffer.ts";

export type VimCommandInput =
  | Readonly<{ kind: "text"; text: string }>
  | Readonly<{ kind: "backspace" }>
  | Readonly<{ kind: "escape" }>
  | Readonly<{ kind: "submit" }>;

export type VimCommandKeyboardInput = Readonly<{
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
}>;

export function vimCommandInputFromKeyboard(
  input: VimCommandKeyboardInput,
): VimCommandInput | undefined {
  if (input.ctrlKey || input.metaKey) {
    return undefined;
  }

  switch (input.key) {
    case "Escape":
      return { kind: "escape" };
    case "Enter":
      return { kind: "submit" };
    case "Backspace":
      return { kind: "backspace" };
    default:
      return Array.from(input.key).length === 1
        ? { kind: "text", text: input.key }
        : undefined;
  }
}

export function applyVimCommandInput(
  buffer: VimBuffer,
  input: VimCommandInput,
): VimBuffer {
  switch (input.kind) {
    case "text":
      return appendVimCommandInput(buffer, input.text);
    case "backspace":
      return backspaceVimCommandInput(buffer);
    case "escape":
      return applyNormalVimKey(buffer, { kind: "escape" });
    case "submit":
      return submitVimCommand(buffer);
  }
}
