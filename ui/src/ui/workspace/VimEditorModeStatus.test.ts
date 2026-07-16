import assert from "node:assert/strict";
import test from "node:test";
import {
  applyNormalVimKey,
  createVimBuffer,
  VimMode,
} from "../../domain/vim/VimBuffer.ts";
import { vimEditorModeStatus } from "./VimEditorModeStatus.ts";

test("labels every Vim mode and announces visual logical bounds", () => {
  const normal = createVimBuffer({ text: "alpha\nbeta", mode: VimMode.Normal });
  const insert = createVimBuffer({ text: "", mode: VimMode.Insert });
  const character = applyNormalVimKey(normal, {
    kind: "enter-visual-character",
  });
  const line = applyNormalVimKey(normal, { kind: "enter-visual-line" });
  const block = applyNormalVimKey(normal, { kind: "enter-visual-block" });
  const command = applyNormalVimKey(normal, { kind: "enter-command" });
  const search = applyNormalVimKey(normal, { kind: "enter-search" });

  assert.deepEqual(
    [
      vimEditorModeStatus(normal),
      vimEditorModeStatus(insert),
      vimEditorModeStatus(character),
      vimEditorModeStatus(line),
      vimEditorModeStatus(block),
      vimEditorModeStatus(command),
      vimEditorModeStatus(search),
    ],
    [
      "NORMAL",
      "INSERT",
      "VISUAL, line 1 column 1 through line 1 column 1",
      "VISUAL LINE, lines 1 through 1",
      "VISUAL BLOCK, lines 1 through 1, columns 1 through 1",
      "COMMAND",
      "SEARCH",
    ],
  );
});
