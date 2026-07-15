import assert from "node:assert/strict";
import test from "node:test";
import {
  applyNormalVimKey,
  createVimBuffer,
  VimMode,
} from "../../domain/vim/VimBuffer.ts";
import {
  applyVimCommandInput,
  vimCommandInputFromKeyboard,
} from "./VimCommandInput.ts";

test("accepts an astral search key as complete command input", () => {
  const start = createVimBuffer({
    text: "😀 one\n😀 two",
    mode: VimMode.Normal,
  });
  const search = applyNormalVimKey(start, { kind: "enter-search" });
  const typed = applyVimCommandInput(
    search,
    vimCommandInputFromKeyboard({
      key: "😀",
      ctrlKey: false,
      metaKey: false,
    }) ?? { kind: "text", text: "" },
  );
  const submitted = applyVimCommandInput(typed, { kind: "submit" });

  assert.deepEqual(typed.mode, {
    kind: "command",
    prompt: "/",
    input: "😀",
  });
  assert.deepEqual(submitted.cursor, { line: 1, column: 0 });
});

test("accepts CJK composition text as complete command input", () => {
  const start = createVimBuffer({
    text: "東京\n京都",
    mode: VimMode.Normal,
  });
  const search = applyNormalVimKey(start, { kind: "enter-search" });
  const composed = applyVimCommandInput(search, {
    kind: "text",
    text: "京都",
  });
  const submitted = applyVimCommandInput(composed, { kind: "submit" });

  assert.deepEqual(composed.mode, {
    kind: "command",
    prompt: "/",
    input: "京都",
  });
  assert.deepEqual(submitted.cursor, { line: 1, column: 0 });
});

test("accepts pasted command text as complete command input", () => {
  const start = createVimBuffer({ text: "", mode: VimMode.Normal });
  const command = applyNormalVimKey(start, { kind: "enter-command" });
  const pasted = applyVimCommandInput(command, {
    kind: "text",
    text: "q!",
  });
  const submitted = applyVimCommandInput(pasted, { kind: "submit" });

  assert.deepEqual(pasted.mode, {
    kind: "command",
    prompt: ":",
    input: "q!",
  });
  assert.deepEqual(submitted.commandEffect, { kind: "force-quit" });
});

test("keeps physical command controls and pane-prefix keys distinct", () => {
  const start = createVimBuffer({ text: "", mode: VimMode.Normal });
  const command = applyNormalVimKey(start, { kind: "enter-command" });
  const typed = applyVimCommandInput(command, { kind: "text", text: "w" });
  const backspaced = applyVimCommandInput(typed, { kind: "backspace" });
  const escaped = applyVimCommandInput(typed, { kind: "escape" });
  const submitted = applyVimCommandInput(typed, { kind: "submit" });

  assert.deepEqual(backspaced.mode, {
    kind: "command",
    prompt: ":",
    input: "",
  });
  assert.equal(escaped.mode.kind, "normal");
  assert.deepEqual(submitted.commandEffect, { kind: "write" });
  assert.equal(
    vimCommandInputFromKeyboard({
      key: "b",
      ctrlKey: true,
      metaKey: false,
    }),
    undefined,
  );
});
