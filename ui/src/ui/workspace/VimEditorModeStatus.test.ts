import assert from "node:assert/strict";
import test from "node:test";
import {
  applyNormalVimKey,
  createVimBuffer,
  insertVimText,
  VimCapability,
  VimMode,
} from "../../domain/vim/VimBuffer.ts";
import {
  vimEditorModeStatus,
  vimEditorStatusLine,
} from "./VimEditorModeStatus.ts";

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

test("projects the shared Vim statusline", () => {
  const normal = createVimBuffer({ text: "alpha\nbeta", mode: VimMode.Normal });
  const lastLine = applyNormalVimKey(normal, {
    kind: "motion",
    motion: "document-end",
  });
  const dirty = insertVimText(
    createVimBuffer({ text: "alpha", mode: VimMode.Insert }),
    "!",
  );
  const readOnly = createVimBuffer({
    text: "alpha",
    mode: VimMode.Normal,
    capability: VimCapability.ReadOnly,
  });

  assert.deepEqual(vimEditorStatusLine(normal, "notes.md"), {
    mode: "NORMAL",
    title: "notes.md",
    position: "1:1",
    progress: "0%",
  });
  assert.deepEqual(vimEditorStatusLine(lastLine, "notes.md"), {
    mode: "NORMAL",
    title: "notes.md",
    position: "2:1",
    progress: "100%",
  });
  assert.deepEqual(vimEditorStatusLine(dirty, "notes.md"), {
    mode: "INSERT",
    title: "notes.md [+]",
    position: "1:2",
    progress: "100%",
  });
  assert.deepEqual(vimEditorStatusLine(readOnly, "man vi"), {
    mode: "NORMAL",
    title: "man vi [RO]",
    position: "1:1",
    progress: "100%",
  });
});
