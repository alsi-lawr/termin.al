import {
  type VimCommandInput,
  vimCommandInputFromKeyboard,
} from "./VimCommandInput.ts";
import type {
  InputCapturePaneKeyInput,
  InputCapturePaneKeyResult,
} from "../terminal/InputCapture";

type VimEditorPaneCommandInput =
  | Readonly<{
      kind: "keydown";
      key: string;
      ctrlKey: boolean;
      metaKey: boolean;
    }>
  | Readonly<{
      kind: "paste";
      text: string;
    }>;

type VimEditorPaneCommandHandlerOptions = Readonly<{
  input: VimEditorPaneCommandInput;
  onCommandInput: (input: VimCommandInput) => void;
  onHistory: (direction: "older" | "newer") => void;
  onPaneKeyInput: (
    input: InputCapturePaneKeyInput,
  ) => InputCapturePaneKeyResult;
  preventDefault: () => void;
}>;

export function handleVimEditorPaneCommandInput({
  input,
  onCommandInput,
  onHistory,
  onPaneKeyInput,
  preventDefault,
}: VimEditorPaneCommandHandlerOptions): void {
  if (input.kind === "paste") {
    preventDefault();
    onCommandInput({ kind: "text", text: input.text });
    return;
  }

  const paneKeyResult = onPaneKeyInput({
    key: input.key,
    ctrlKey: input.ctrlKey,
    metaKey: input.metaKey,
  });

  if (paneKeyResult.kind === "handled") {
    preventDefault();
    return;
  }

  const commandKeyResult = vimCommandInputFromKeyboard(input);

  switch (commandKeyResult.kind) {
    case "allow-default":
      return;
    case "prevent-default":
      preventDefault();
      return;
    case "history":
      preventDefault();
      onHistory(commandKeyResult.direction);
      return;
    case "input":
      preventDefault();
      onCommandInput(commandKeyResult.input);
  }
}
