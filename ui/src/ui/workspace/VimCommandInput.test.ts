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
  const keyboardInput = vimCommandInputFromKeyboard({
    key: "😀",
    ctrlKey: false,
    metaKey: false,
  });

  assert.deepEqual(keyboardInput, {
    kind: "input",
    input: { kind: "text", text: "😀" },
  });

  if (keyboardInput.kind !== "input") {
    throw new Error("expected command text input");
  }

  const typed = applyVimCommandInput(
    search,
    keyboardInput.input,
  );
  const submitted = applyVimCommandInput(typed, { kind: "submit" });

  assert.equal(typed.mode.kind, "search");
  assert.equal(typed.mode.kind === "search" ? typed.mode.prompt : "", "/");
  assert.equal(typed.mode.kind === "search" ? typed.mode.input : "", "😀");
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

  assert.equal(composed.mode.kind, "search");
  assert.equal(
    composed.mode.kind === "search" ? composed.mode.input : "",
    "京都",
  );
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
    input: "q!",
  });
  assert.deepEqual(submitted.commandEffect, { kind: "force-quit" });
});

test("applies physical command controls", () => {
  const start = createVimBuffer({ text: "", mode: VimMode.Normal });
  const command = applyNormalVimKey(start, { kind: "enter-command" });
  const typed = applyVimCommandInput(command, { kind: "text", text: "w" });
  const backspaced = applyVimCommandInput(typed, { kind: "backspace" });
  const escaped = applyVimCommandInput(typed, { kind: "escape" });
  const submitted = applyVimCommandInput(typed, { kind: "submit" });

  assert.deepEqual(backspaced.mode, {
    kind: "command",
    input: "",
  });
  assert.equal(escaped.mode.kind, "normal");
  assert.deepEqual(submitted.commandEffect, { kind: "write" });

  for (const [keyboardInput, direction] of [
    [{ key: "ArrowUp", ctrlKey: false, metaKey: false }, "older"],
    [{ key: "ArrowDown", ctrlKey: false, metaKey: false }, "newer"],
    [{ key: "p", ctrlKey: true, metaKey: false }, "older"],
    [{ key: "n", ctrlKey: true, metaKey: false }, "newer"],
  ] as const) {
    assert.deepEqual(vimCommandInputFromKeyboard(keyboardInput), {
      kind: "history",
      direction,
    });
  }
});
