import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./HierarchicalCollectionPane.tsx", import.meta.url),
  "utf8",
);

test("restores filtering focus after a leaf closes", () => {
  assert.match(
    source,
    /if \(!isActive \|\| openedLeaf !== undefined\) \{[\s\S]*state\.mode\.kind === "filtering"[\s\S]*filterRef\.current\?\.focus/u,
  );
  assert.match(
    source,
    /\[focusVersion, isActive, openedLeaf, state\.mode\.kind\]/u,
  );
});

test("uses terminal-like text input without a browser search clear control", () => {
  assert.match(source, /type="text"/u);
  assert.doesNotMatch(source, /type="search"/u);
});
