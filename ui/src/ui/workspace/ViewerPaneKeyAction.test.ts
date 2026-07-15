import assert from "node:assert/strict";
import test from "node:test";
import { viewerPaneKeyActionFromInput } from "./ViewerPaneKeyAction.ts";

test("does not close raw pagers with modified quit keys", () => {
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
    assert.deepEqual(viewerPaneKeyActionFromInput({
      kind: "raw-pager",
      ...input,
    }), { kind: "ignored" });
  }
});

test("closes raw pagers with unmodified quit keys", () => {
  const keys: ReadonlyArray<string> = ["q", "Escape"];

  for (const key of keys) {
    assert.deepEqual(viewerPaneKeyActionFromInput({
      kind: "raw-pager",
      key,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
    }), { kind: "close" });
  }
});

test("closes ordinary viewers with unmodified quit keys", () => {
  const keys: ReadonlyArray<string> = ["q", "Escape"];

  for (const key of keys) {
    assert.deepEqual(viewerPaneKeyActionFromInput({
      kind: "viewer",
      key,
      ctrlKey: false,
      metaKey: false,
    }), { kind: "close" });
  }
});
