import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPaneKeyInput,
  initialPanePrefixState,
} from "./PaneKeyBindings.ts";

test("maps the accepted Ctrl-b pane prefix without leaking ordinary Vim keys", () => {
  const ignored = applyPaneKeyInput(initialPanePrefixState, {
    key: "h",
    ctrlKey: false,
    metaKey: false,
  });
  const prefix = applyPaneKeyInput(initialPanePrefixState, {
    key: "b",
    ctrlKey: true,
    metaKey: false,
  });

  if (prefix.kind !== "prefix-entered") {
    assert.fail("Expected Ctrl-b to enter the pane prefix.");
  }

  const split = applyPaneKeyInput(prefix.state, {
    key: "%",
    ctrlKey: false,
    metaKey: false,
  });
  const resizePrefix = applyPaneKeyInput(initialPanePrefixState, {
    key: "b",
    ctrlKey: true,
    metaKey: false,
  });

  if (resizePrefix.kind !== "prefix-entered") {
    assert.fail("Expected Ctrl-b to enter the pane prefix.");
  }

  const resize = applyPaneKeyInput(resizePrefix.state, {
    key: "L",
    ctrlKey: false,
    metaKey: false,
  });

  assert.deepEqual(ignored, {
    kind: "ignored",
    state: { kind: "idle" },
  });
  assert.deepEqual(split, {
    kind: "operation",
    state: { kind: "idle" },
    operation: {
      kind: "split",
      orientation: "horizontal",
      content: { kind: "shell" },
    },
  });
  assert.deepEqual(resize, {
    kind: "operation",
    state: { kind: "idle" },
    operation: { kind: "resize", direction: "right" },
  });
});

test("selects a pane number only after the q prefix command", () => {
  const prefix = applyPaneKeyInput(initialPanePrefixState, {
    key: "b",
    ctrlKey: true,
    metaKey: false,
  });

  if (prefix.kind !== "prefix-entered") {
    assert.fail("Expected Ctrl-b to enter the pane prefix.");
  }

  const select = applyPaneKeyInput(prefix.state, {
    key: "q",
    ctrlKey: false,
    metaKey: false,
  });

  if (select.kind !== "selection-pending") {
    assert.fail("Expected q to request a pane number.");
  }

  const numbered = applyPaneKeyInput(select.state, {
    key: "3",
    ctrlKey: false,
    metaKey: false,
  });

  assert.deepEqual(numbered, {
    kind: "operation",
    state: { kind: "idle" },
    operation: { kind: "focus-number", number: 3 },
  });
});
