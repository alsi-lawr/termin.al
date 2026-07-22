import assert from "node:assert/strict";
import test from "node:test";
import type { VimCommandInput } from "./VimCommandInput.ts";
import { handleVimEditorPaneCommandInput } from "./VimEditorPaneCommandHandler.ts";

test("dispatches keyboard paste through the Vim editor command boundary", () => {
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
    const inputs: VimCommandInput[] = [];

    handleVimEditorPaneCommandInput({
      input: { kind: "keydown", ...keyboardInput },
      onCommandInput: (input) => inputs.push(input),
      onHistory: () => undefined,
      onPaneKeyInput: () => ({ kind: "unhandled" }),
      preventDefault: () => {
        defaultPreventionCount += 1;
      },
    });

    assert.equal(defaultPreventionCount, 0);
    assert.equal(inputs.length, 0);

    handleVimEditorPaneCommandInput({
      input: { kind: "paste", text: "q!" },
      onCommandInput: (input) => inputs.push(input),
      onHistory: () => undefined,
      onPaneKeyInput: () => ({ kind: "unhandled" }),
      preventDefault: () => {
        defaultPreventionCount += 1;
      },
    });

    assert.equal(defaultPreventionCount, 1);
    assert.deepEqual(inputs, [{ kind: "text", text: "q!" }]);
  }
});

test("gives pane prefix handling precedence over command input", () => {
  let defaultPreventionCount = 0;
  const inputs: VimCommandInput[] = [];
  const history: string[] = [];

  handleVimEditorPaneCommandInput({
    input: { kind: "keydown", key: "p", ctrlKey: true, metaKey: false },
    onCommandInput: (input) => inputs.push(input),
    onHistory: (direction) => history.push(direction),
    onPaneKeyInput: () => ({ kind: "handled" }),
    preventDefault: () => {
      defaultPreventionCount += 1;
    },
  });

  assert.equal(defaultPreventionCount, 1);
  assert.deepEqual(inputs, []);
  assert.deepEqual(history, []);
});

test("dispatches history controls and consumes unrelated modified controls", () => {
  let defaultPreventionCount = 0;
  const history: string[] = [];

  for (const input of [
    { key: "ArrowUp", ctrlKey: false, metaKey: false },
    { key: "ArrowDown", ctrlKey: false, metaKey: false },
    { key: "p", ctrlKey: true, metaKey: false },
    { key: "n", ctrlKey: true, metaKey: false },
    { key: "c", ctrlKey: true, metaKey: false },
  ]) {
    handleVimEditorPaneCommandInput({
      input: { kind: "keydown", ...input },
      onCommandInput: () => undefined,
      onHistory: (direction) => history.push(direction),
      onPaneKeyInput: () => ({ kind: "unhandled" }),
      preventDefault: () => {
        defaultPreventionCount += 1;
      },
    });
  }

  assert.equal(defaultPreventionCount, 5);
  assert.deepEqual(history, ["older", "newer", "older", "newer"]);
});
