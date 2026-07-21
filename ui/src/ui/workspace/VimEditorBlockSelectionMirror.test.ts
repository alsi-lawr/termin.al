import assert from "node:assert/strict";
import test from "node:test";
import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  applyNormalVimKey,
  createVimBuffer,
  VimMode,
} from "../../domain/vim/VimBuffer.ts";
import { vimEditorBlockMirrorLines } from "./VimEditorBlockSelectionMirrorData.ts";
import { VimEditorBlockSelectionMirror } from "./VimEditorBlockSelectionMirror.tsx";

test("derives a pointer-inert block mirror with virtual short-line spaces", () => {
  let buffer = createVimBuffer({ text: "abcd\nx\nabcdef", mode: VimMode.Normal });

  buffer = applyNormalVimKey(buffer, { kind: "motion", motion: "right" });
  buffer = applyNormalVimKey(buffer, { kind: "enter-visual-block" });
  buffer = applyNormalVimKey(buffer, { kind: "motion", motion: "right" });
  buffer = applyNormalVimKey(buffer, { kind: "motion", motion: "line-next" });
  buffer = applyNormalVimKey(buffer, { kind: "motion", motion: "line-next" });

  const lines = vimEditorBlockMirrorLines(buffer);

  assert.deepEqual(lines, [
    { lineNumber: 0, prefix: "a", selected: "bc", suffix: "d" },
    { lineNumber: 1, prefix: "x", selected: "  ", suffix: "" },
    { lineNumber: 2, prefix: "a", selected: "bc", suffix: "def" },
  ]);
  const markup = renderToStaticMarkup(createElement(
    VimEditorBlockSelectionMirror,
    {
      buffer,
      mirrorRef: createRef<HTMLDivElement>(),
    },
  ));

  assert.match(markup, /aria-hidden="true"/u);
  assert.match(markup, /pointer-events-none/u);
  assert.doesNotMatch(markup, /canvas|contenteditable|textarea/u);
});
