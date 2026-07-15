import assert from "node:assert/strict";
import test from "node:test";
import { VimMode, type VimMode as VimModeState } from "../../domain/vim/VimBuffer.ts";
import { vimEditorModeStatus } from "./VimEditorModeStatus.ts";

test("labels every practical Vim mode for the editor status", () => {
  const commandMode: VimModeState = {
    kind: "command",
    prompt: ":",
    input: "",
  };
  const searchMode: VimModeState = {
    kind: "command",
    prompt: "/",
    input: "",
  };

  assert.deepEqual(
    [
      vimEditorModeStatus(VimMode.Normal),
      vimEditorModeStatus(VimMode.Insert),
      vimEditorModeStatus(VimMode.Visual),
      vimEditorModeStatus(commandMode),
      vimEditorModeStatus(searchMode),
    ],
    ["NORMAL", "INSERT", "VISUAL LINE", "COMMAND", "SEARCH"],
  );
});
