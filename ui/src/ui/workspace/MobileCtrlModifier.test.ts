import assert from "node:assert/strict";
import test from "node:test";
import {
  consumeMobileCtrlModifier,
  initialMobileCtrlModifier,
  toggleMobileCtrlModifier,
} from "./MobileCtrlModifier.ts";

test("applies an armed mobile Ctrl modifier to exactly one key", () => {
  const armed = toggleMobileCtrlModifier(initialMobileCtrlModifier);
  const modified = consumeMobileCtrlModifier(armed, {
    key: "c",
    ctrlKey: false,
    metaKey: false,
  });
  const next = consumeMobileCtrlModifier(modified.modifier, {
    key: "x",
    ctrlKey: false,
    metaKey: false,
  });

  assert.deepEqual(modified, {
    modifier: { kind: "idle" },
    resolution: {
      input: { key: "c", ctrlKey: true, metaKey: false },
      mobileCtrlApplied: true,
    },
  });
  assert.deepEqual(next, {
    modifier: { kind: "idle" },
    resolution: {
      input: { key: "x", ctrlKey: false, metaKey: false },
      mobileCtrlApplied: false,
    },
  });
});

test("toggles an armed mobile Ctrl modifier off before it reaches input", () => {
  const armed = toggleMobileCtrlModifier(initialMobileCtrlModifier);
  const idle = toggleMobileCtrlModifier(armed);
  const resolution = consumeMobileCtrlModifier(idle, {
    key: "r",
    ctrlKey: false,
    metaKey: false,
  });

  assert.deepEqual(resolution, {
    modifier: { kind: "idle" },
    resolution: {
      input: { key: "r", ctrlKey: false, metaKey: false },
      mobileCtrlApplied: false,
    },
  });
});
