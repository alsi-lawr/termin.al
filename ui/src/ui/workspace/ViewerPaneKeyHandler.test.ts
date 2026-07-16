import assert from "node:assert/strict";
import test from "node:test";
import { handleViewerPaneKeyInput } from "./ViewerPaneKeyHandler.ts";

test("leaves modified raw pager quit keys unhandled", () => {
  const inputs: ReadonlyArray<Readonly<{
    key: string;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
  }>> = [
    { key: "q", altKey: true, ctrlKey: false, metaKey: false },
    { key: "Escape", altKey: true, ctrlKey: false, metaKey: false },
    { key: "q", altKey: false, ctrlKey: true, metaKey: false },
    { key: "Escape", altKey: false, ctrlKey: true, metaKey: false },
    { key: "q", altKey: false, ctrlKey: false, metaKey: true },
    { key: "Escape", altKey: false, ctrlKey: false, metaKey: true },
  ];

  for (const input of inputs) {
    let closeCount = 0;
    let defaultPreventionCount = 0;
    let pagerOperationCount = 0;

    handleViewerPaneKeyInput({
      input: { kind: "raw-pager", ...input },
      onPaneKeyInput: () => ({ kind: "unhandled" }),
      onClose: () => {
        closeCount += 1;
      },
      onPagerOperation: () => {
        pagerOperationCount += 1;
      },
      preventDefault: () => {
        defaultPreventionCount += 1;
      },
    });

    assert.equal(closeCount, 0);
    assert.equal(defaultPreventionCount, 0);
    assert.equal(pagerOperationCount, 0);
  }
});

test("closes raw pagers with unmodified quit keys", () => {
  const keys: ReadonlyArray<string> = ["q", "Escape"];

  for (const key of keys) {
    let closeCount = 0;
    let defaultPreventionCount = 0;
    let pagerOperationCount = 0;

    handleViewerPaneKeyInput({
      input: {
        kind: "raw-pager",
        key,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      },
      onPaneKeyInput: () => ({ kind: "unhandled" }),
      onClose: () => {
        closeCount += 1;
      },
      onPagerOperation: () => {
        pagerOperationCount += 1;
      },
      preventDefault: () => {
        defaultPreventionCount += 1;
      },
    });

    assert.equal(closeCount, 1);
    assert.equal(defaultPreventionCount, 1);
    assert.equal(pagerOperationCount, 0);
  }
});

test("closes ordinary viewers with unmodified quit keys", () => {
  const keys: ReadonlyArray<string> = ["q", "Escape"];

  for (const key of keys) {
    let closeCount = 0;
    let defaultPreventionCount = 0;
    let pagerOperationCount = 0;

    handleViewerPaneKeyInput({
      input: {
        kind: "viewer",
        key,
        ctrlKey: false,
        metaKey: false,
      },
      onPaneKeyInput: () => ({ kind: "unhandled" }),
      onClose: () => {
        closeCount += 1;
      },
      onPagerOperation: () => {
        pagerOperationCount += 1;
      },
      preventDefault: () => {
        defaultPreventionCount += 1;
      },
    });

    assert.equal(closeCount, 1);
    assert.equal(defaultPreventionCount, 1);
    assert.equal(pagerOperationCount, 0);
  }
});

test("preserves native Tab and modified viewer return keys", () => {
  const inputs = [
    { key: "Tab", ctrlKey: false, metaKey: false },
    { key: "q", ctrlKey: true, metaKey: false },
    { key: "Escape", ctrlKey: false, metaKey: true },
  ];

  for (const input of inputs) {
    let closeCount = 0;
    let defaultPreventionCount = 0;

    handleViewerPaneKeyInput({
      input: { kind: "viewer", ...input },
      onPaneKeyInput: () => ({ kind: "unhandled" }),
      onViewerKeyInput: () => ({ kind: "unhandled" }),
      onClose: () => {
        closeCount += 1;
      },
      onPagerOperation: () => undefined,
      preventDefault: () => {
        defaultPreventionCount += 1;
      },
    });

    assert.equal(closeCount, 0);
    assert.equal(defaultPreventionCount, 0);
  }
});

test("prevents native find and pages a raw viewer forward on Ctrl+f", () => {
  const pagerOperations: Array<string> = [];
  let defaultPreventionCount = 0;

  handleViewerPaneKeyInput({
    input: {
      kind: "raw-pager",
      key: "f",
      altKey: false,
      ctrlKey: true,
      metaKey: false,
    },
    onPaneKeyInput: () => ({ kind: "unhandled" }),
    onPagerOperation: (operation) => {
      pagerOperations.push(operation.kind);
    },
    preventDefault: () => {
      defaultPreventionCount += 1;
    },
  });

  assert.deepEqual(pagerOperations, ["page-forward"]);
  assert.equal(defaultPreventionCount, 1);
});

test("delegates Ctrl+b to the tmux prefix before viewer navigation", () => {
  const paneInputs: Array<string> = [];
  let pagerOperationCount = 0;
  let defaultPreventionCount = 0;

  handleViewerPaneKeyInput({
    input: {
      kind: "raw-pager",
      key: "b",
      altKey: false,
      ctrlKey: true,
      metaKey: false,
    },
    onPaneKeyInput: (input) => {
      paneInputs.push(`${input.ctrlKey ? "Ctrl+" : ""}${input.key}`);
      return { kind: "handled" };
    },
    onPagerOperation: () => {
      pagerOperationCount += 1;
    },
    preventDefault: () => {
      defaultPreventionCount += 1;
    },
  });

  assert.deepEqual(paneInputs, ["Ctrl+b"]);
  assert.equal(pagerOperationCount, 0);
  assert.equal(defaultPreventionCount, 1);
});

test("routes collection viewer keys after pane prefixes and before viewer return", () => {
  const events: Array<string> = [];
  let defaultPreventionCount = 0;

  handleViewerPaneKeyInput({
    input: {
      kind: "viewer",
      key: "Escape",
      ctrlKey: false,
      metaKey: false,
    },
    onPaneKeyInput: () => {
      events.push("pane");
      return { kind: "unhandled" };
    },
    onViewerKeyInput: () => {
      events.push("collection");
      return { kind: "handled" };
    },
    onClose: () => {
      events.push("close");
    },
    onPagerOperation: () => undefined,
    preventDefault: () => {
      defaultPreventionCount += 1;
    },
  });

  assert.deepEqual(events, ["pane", "collection"]);
  assert.equal(defaultPreventionCount, 1);
});

test("does not route collection keys when the pane prefix consumes them", () => {
  const events: Array<string> = [];

  handleViewerPaneKeyInput({
    input: {
      kind: "viewer",
      key: "j",
      ctrlKey: false,
      metaKey: false,
    },
    onPaneKeyInput: () => {
      events.push("pane");
      return { kind: "handled" };
    },
    onViewerKeyInput: () => {
      events.push("collection");
      return { kind: "handled" };
    },
    onPagerOperation: () => undefined,
    preventDefault: () => undefined,
  });

  assert.deepEqual(events, ["pane"]);
});
