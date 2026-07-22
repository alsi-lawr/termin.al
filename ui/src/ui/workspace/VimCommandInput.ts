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

export type VimCommandKeyboardResult =
  | Readonly<{ kind: "allow-default" }>
  | Readonly<{ kind: "prevent-default" }>
  | Readonly<{
      kind: "history";
      direction: "older" | "newer";
    }>
  | Readonly<{ kind: "input"; input: VimCommandInput }>;

export function vimCommandInputFromKeyboard(
  input: VimCommandKeyboardInput,
): VimCommandKeyboardResult {
  if (
    (input.ctrlKey || input.metaKey) &&
    input.key.toLowerCase() === "v"
  ) {
    return { kind: "allow-default" };
  }

  if (input.ctrlKey && !input.metaKey) {
    switch (input.key.toLowerCase()) {
      case "p":
        return { kind: "history", direction: "older" };
      case "n":
        return { kind: "history", direction: "newer" };
    }
  }

  if (input.ctrlKey || input.metaKey) {
    return { kind: "prevent-default" };
  }

  switch (input.key) {
    case "ArrowUp":
      return { kind: "history", direction: "older" };
    case "ArrowDown":
      return { kind: "history", direction: "newer" };
    case "Escape":
      return { kind: "input", input: { kind: "escape" } };
    case "Enter":
      return { kind: "input", input: { kind: "submit" } };
    case "Backspace":
      return { kind: "input", input: { kind: "backspace" } };
    default:
      return Array.from(input.key).length === 1
        ? { kind: "input", input: { kind: "text", text: input.key } }
        : { kind: "prevent-default" };
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
