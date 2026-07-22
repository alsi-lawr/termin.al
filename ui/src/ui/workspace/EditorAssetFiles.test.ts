import assert from "node:assert/strict";
import test from "node:test";
import { routeEditorAssetFiles } from "./EditorAssetFiles.ts";

test("routes every File supplied by picker, paste, or drop inputs", () => {
  const files = [
    new File(["first"], "first.png", { type: "image/png" }),
    new File(["second"], "second.webp", { type: "image/webp" }),
  ];
  let routed: ReadonlyArray<File> = [];
  let prevented = false;
  assert.equal(routeEditorAssetFiles(files, (selected) => { routed = selected; }, () => { prevented = true; }), true);
  assert.deepEqual(routed, files);
  assert.equal(prevented, true);
});
