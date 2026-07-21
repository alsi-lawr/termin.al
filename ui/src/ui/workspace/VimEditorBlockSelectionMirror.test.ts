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
import { VimEditorPane } from "./VimEditorPane.tsx";

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

test("keeps one aligned inert Markdown layer behind the native editor surface", () => {
  const source = "# Draft\n\n```ql\nselect 1\n```";
  const buffer = createVimBuffer({ text: source, mode: VimMode.Insert });
  const markup = renderToStaticMarkup(createElement(VimEditorPane, {
    title: "Draft.md",
    buffer,
    syntax: { kind: "markdown" },
    isActive: false,
    focusVersion: 0,
    onBufferChange: () => undefined,
    onActivate: () => undefined,
    onPaneKeyInput: (): Readonly<{ kind: "unhandled" }> => ({ kind: "unhandled" }),
    mobileCtrlPressed: false,
    onToggleMobileCtrl: () => undefined,
    onConsumeMobileCtrl: () => undefined,
    resolveMobileCtrlInput: (input) => ({ input, mobileCtrlApplied: false }),
  }));

  assert.equal(markup.match(/<textarea/gu)?.length, 1);
  assert.equal(markup.match(/data-editor-highlighting="markdown"/gu)?.length, 1);
  assert.match(markup, /aria-hidden="true"[^>]*data-editor-highlighting="markdown"/u);
  assert.match(markup, /pointer-events-none[^"\n]*overflow-hidden[^"\n]*p-2[^"\n]*font-mono[^"\n]*text-sm[^"\n]*leading-normal[^"\n]*whitespace-pre-wrap[^"\n]*break-words/u);
  assert.match(markup, /<textarea[^>]*text-transparent[^>]*caret-ui-cursor[^>]*selection:bg-surface-selected[^>]*selection:text-text-primary/u);
  assert.match(markup, /aria-label="Draft\.md editor text"/u);
  assert.equal(markup.indexOf("data-editor-highlighting") < markup.indexOf("<textarea"), true);
  assert.doesNotMatch(markup, /contenteditable|dangerouslySetInnerHTML/u);
  assert.equal(markup.match(/# Draft/gu)?.length, 2);
});
