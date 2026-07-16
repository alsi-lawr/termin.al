import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPaneKeyInput,
  initialPanePrefixState,
} from "./PaneKeyBindings.ts";
import { createPaneId } from "./PaneTree.ts";

const paneId = createPaneId("pane-1");

test("maps the accepted Ctrl-b pane prefix without leaking ordinary Vim keys", () => {
  const ignored = applyPaneKeyInput(initialPanePrefixState, {
    key: "h",
    ctrlKey: false,
    metaKey: false,
  }, paneId);
  const prefix = applyPaneKeyInput(initialPanePrefixState, {
    key: "b",
    ctrlKey: true,
    metaKey: false,
  }, paneId);

  if (prefix.kind !== "prefix-entered") {
    assert.fail("Expected Ctrl-b to enter the pane prefix.");
  }

  const split = applyPaneKeyInput(prefix.state, {
    key: "%",
    ctrlKey: false,
    metaKey: false,
  }, paneId);
  const resizePrefix = applyPaneKeyInput(initialPanePrefixState, {
    key: "b",
    ctrlKey: true,
    metaKey: false,
  }, paneId);

  if (resizePrefix.kind !== "prefix-entered") {
    assert.fail("Expected Ctrl-b to enter the pane prefix.");
  }

  const resize = applyPaneKeyInput(resizePrefix.state, {
    key: "L",
    ctrlKey: false,
    metaKey: false,
  }, paneId);

  assert.deepEqual(ignored, {
    kind: "ignored",
    state: { kind: "idle" },
  });
  assert.deepEqual(split, {
    kind: "operation",
    state: { kind: "idle" },
    operation: {
      kind: "split",
      paneId,
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

test("preserves the pane prefix across the exact physical UK percent sequence", () => {
  const control = applyPaneKeyInput(initialPanePrefixState, {
    key: "Control",
    ctrlKey: true,
    metaKey: false,
  }, paneId);
  const prefix = applyPaneKeyInput(control.state, {
    key: "b",
    ctrlKey: true,
    metaKey: false,
  }, paneId);

  if (prefix.kind !== "prefix-entered") {
    assert.fail("Expected Ctrl-b to enter the pane prefix.");
  }

  const shift = applyPaneKeyInput(prefix.state, {
    key: "Shift",
    ctrlKey: false,
    metaKey: false,
  }, paneId);
  const split = applyPaneKeyInput(shift.state, {
    key: "%",
    ctrlKey: false,
    metaKey: false,
  }, paneId);

  assert.deepEqual(control, {
    kind: "ignored",
    state: { kind: "idle" },
  });
  assert.deepEqual(shift, {
    kind: "ignored",
    state: { kind: "awaiting-command" },
  });
  assert.deepEqual(split, {
    kind: "operation",
    state: { kind: "idle" },
    operation: {
      kind: "split",
      paneId,
      orientation: "horizontal",
      content: { kind: "shell" },
    },
  });

  for (const key of ["Control", "Alt", "Meta"] as const) {
    const result = applyPaneKeyInput({ kind: "awaiting-command" }, {
      key,
      ctrlKey: key === "Control",
      metaKey: key === "Meta",
    }, paneId);

    assert.deepEqual(result, {
      kind: "ignored",
      state: { kind: "awaiting-command" },
    });
  }
});

test("selects a pane number only after the q prefix command", () => {
  const prefix = applyPaneKeyInput(initialPanePrefixState, {
    key: "b",
    ctrlKey: true,
    metaKey: false,
  }, paneId);

  if (prefix.kind !== "prefix-entered") {
    assert.fail("Expected Ctrl-b to enter the pane prefix.");
  }

  const select = applyPaneKeyInput(prefix.state, {
    key: "q",
    ctrlKey: false,
    metaKey: false,
  }, paneId);

  if (select.kind !== "selection-pending") {
    assert.fail("Expected q to request a pane number.");
  }

  const numbered = applyPaneKeyInput(select.state, {
    key: "3",
    ctrlKey: false,
    metaKey: false,
  }, paneId);

  assert.deepEqual(numbered, {
    kind: "operation",
    state: { kind: "idle" },
    operation: { kind: "focus-number", number: 3 },
  });
});

test("preserves pane-number selection across modifiers and cancels on printable keys", () => {
  const prefix = applyPaneKeyInput(initialPanePrefixState, {
    key: "b",
    ctrlKey: true,
    metaKey: false,
  }, paneId);

  if (prefix.kind !== "prefix-entered") {
    assert.fail("Expected Ctrl-b to enter the pane prefix.");
  }

  const selection = applyPaneKeyInput(prefix.state, {
    key: "q",
    ctrlKey: false,
    metaKey: false,
  }, paneId);

  if (selection.kind !== "selection-pending") {
    assert.fail("Expected q to request a pane number.");
  }

  const shift = applyPaneKeyInput(selection.state, {
    key: "Shift",
    ctrlKey: false,
    metaKey: false,
  }, paneId);
  const numbered = applyPaneKeyInput(shift.state, {
    key: "3",
    ctrlKey: false,
    metaKey: false,
  }, paneId);

  assert.deepEqual(shift, {
    kind: "ignored",
    state: { kind: "awaiting-pane-number" },
  });
  assert.deepEqual(numbered, {
    kind: "operation",
    state: { kind: "idle" },
    operation: { kind: "focus-number", number: 3 },
  });

  const remainingModifiers = ["Control", "Alt", "Meta"] as const;

  for (const key of remainingModifiers) {
    const result = applyPaneKeyInput({ kind: "awaiting-pane-number" }, {
      key,
      ctrlKey: key === "Control",
      metaKey: key === "Meta",
    }, paneId);

    assert.deepEqual(result, {
      kind: "ignored",
      state: { kind: "awaiting-pane-number" },
    });
  }

  const cancelledCommand = applyPaneKeyInput({ kind: "awaiting-command" }, {
    key: "a",
    ctrlKey: false,
    metaKey: false,
  }, paneId);
  const cancelledNumber = applyPaneKeyInput({ kind: "awaiting-pane-number" }, {
    key: "a",
    ctrlKey: false,
    metaKey: false,
  }, paneId);

  assert.deepEqual(cancelledCommand, {
    kind: "ignored",
    state: { kind: "idle" },
  });
  assert.deepEqual(cancelledNumber, {
    kind: "ignored",
    state: { kind: "idle" },
  });
});
