import type { VimBuffer } from "../../domain/vim/VimBuffer.ts";
import {
  applyVimCommandInput,
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
  buffer: VimBuffer;
  input: VimEditorPaneCommandInput;
  onBufferChange: (buffer: VimBuffer) => void;
  onPaneKeyInput: (
    input: InputCapturePaneKeyInput,
  ) => InputCapturePaneKeyResult;
  preventDefault: () => void;
}>;

export function handleVimEditorPaneCommandInput({
  buffer,
  input,
  onBufferChange,
  onPaneKeyInput,
  preventDefault,
}: VimEditorPaneCommandHandlerOptions): void {
  if (input.kind === "paste") {
    preventDefault();
    onBufferChange(
      applyVimCommandInput(buffer, { kind: "text", text: input.text }),
    );
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
    case "input":
      preventDefault();
      onBufferChange(applyVimCommandInput(buffer, commandKeyResult.input));
  }
}
