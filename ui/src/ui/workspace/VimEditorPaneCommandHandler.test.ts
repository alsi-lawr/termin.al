import assert from "node:assert/strict";
import test from "node:test";
import {
  applyNormalVimKey,
  createVimBuffer,
  type VimBuffer,
  VimMode,
} from "../../domain/vim/VimBuffer.ts";
import { handleVimEditorPaneCommandInput } from "./VimEditorPaneCommandHandler.ts";

test("dispatches keyboard paste through the Vim editor command boundary", () => {
  const start = createVimBuffer({ text: "", mode: VimMode.Normal });
  const command = applyNormalVimKey(start, { kind: "enter-command" });
  const keyboardInputs: ReadonlyArray<Readonly<{
    key: string;
    ctrlKey: boolean;
    metaKey: boolean;
  }>> = [
    { key: "v", ctrlKey: true, metaKey: false },
    { key: "v", ctrlKey: false, metaKey: true },
  ];

  for (const keyboardInput of keyboardInputs) {
    let defaultPreventionCount = 0;
    const bufferChanges: VimBuffer[] = [];

    handleVimEditorPaneCommandInput({
      buffer: command,
      input: { kind: "keydown", ...keyboardInput },
      onBufferChange: (buffer) => {
        bufferChanges.push(buffer);
      },
      onPaneKeyInput: () => ({ kind: "unhandled" }),
      preventDefault: () => {
        defaultPreventionCount += 1;
      },
    });

    assert.equal(defaultPreventionCount, 0);
    assert.equal(bufferChanges.length, 0);

    handleVimEditorPaneCommandInput({
      buffer: command,
      input: { kind: "paste", text: "q!" },
      onBufferChange: (buffer) => {
        bufferChanges.push(buffer);
      },
      onPaneKeyInput: () => ({ kind: "unhandled" }),
      preventDefault: () => {
        defaultPreventionCount += 1;
      },
    });

    assert.equal(defaultPreventionCount, 1);
    assert.equal(bufferChanges.length, 1);

    const afterPaste = bufferChanges.at(0);

    if (afterPaste === undefined) {
      throw new Error("expected one command buffer update from paste");
    }

    assert.deepEqual(afterPaste.mode, {
      kind: "command",
      prompt: ":",
      input: "q!",
    });
  }
});

test("gives pane prefix handling precedence over command input", () => {
  const start = createVimBuffer({ text: "", mode: VimMode.Normal });
  const command = applyNormalVimKey(start, { kind: "enter-command" });
  let defaultPreventionCount = 0;
  const bufferChanges: VimBuffer[] = [];
  const paneInputs: Array<Readonly<{
    key: string;
    ctrlKey: boolean;
    metaKey: boolean;
  }>> = [];

  handleVimEditorPaneCommandInput({
    buffer: command,
    input: { kind: "keydown", key: "b", ctrlKey: true, metaKey: false },
    onBufferChange: (buffer) => {
      bufferChanges.push(buffer);
    },
    onPaneKeyInput: (input) => {
      paneInputs.push(input);
      return { kind: "handled" };
    },
    preventDefault: () => {
      defaultPreventionCount += 1;
    },
  });

  assert.deepEqual(paneInputs, [
    { key: "b", ctrlKey: true, metaKey: false },
  ]);
  assert.equal(defaultPreventionCount, 1);
  assert.equal(bufferChanges.length, 0);
});

test("consumes unrelated modified command controls", () => {
  const start = createVimBuffer({ text: "", mode: VimMode.Normal });
  const command = applyNormalVimKey(start, { kind: "enter-command" });
  let defaultPreventionCount = 0;
  const bufferChanges: VimBuffer[] = [];

  handleVimEditorPaneCommandInput({
    buffer: command,
    input: { kind: "keydown", key: "c", ctrlKey: true, metaKey: false },
    onBufferChange: (buffer) => {
      bufferChanges.push(buffer);
    },
    onPaneKeyInput: () => ({ kind: "unhandled" }),
    preventDefault: () => {
      defaultPreventionCount += 1;
    },
  });

  assert.equal(defaultPreventionCount, 1);
  assert.equal(bufferChanges.length, 0);
});
