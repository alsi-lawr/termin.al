import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  InputCapture,
  type InputCapturePaneKeyResult,
} from "./InputCapture.tsx";

test("keeps command prompts in the accessible native textarea", () => {
  const markup = renderToStaticMarkup(createElement(InputCapture, {
    value: "open about.md",
    cursor: 13,
    promptKind: "command",
    isActive: true,
    focusVersion: 0,
    onNativeValueChange: () => undefined,
    onMoveCursor: () => undefined,
    onMoveLeft: () => undefined,
    onMoveRight: () => undefined,
    onMoveStart: () => undefined,
    onMoveEnd: () => undefined,
    onMovePreviousWord: () => undefined,
    onMoveNextWord: () => undefined,
    onBackspace: () => undefined,
    onDelete: () => undefined,
    onDeletePreviousWord: () => undefined,
    onBrowseOlderHistory: () => undefined,
    onBrowseNewerHistory: () => undefined,
    onInsertText: () => undefined,
    onSubmit: () => undefined,
    onCancel: () => undefined,
    onDismissCompletion: () => undefined,
    onComplete: () => undefined,
    onFocus: () => undefined,
    onPaneKeyInput: (): InputCapturePaneKeyResult => ({ kind: "unhandled" }),
    resolveMobileCtrlInput: (input) => ({
      input,
      mobileCtrlApplied: false,
    }),
  }));
  const normalizedMarkup = markup.toLocaleLowerCase();

  assert.match(markup, /^<textarea[^>]*>open about\.md<\/textarea>$/u);
  assert.equal(markup.includes('aria-label="Terminal command input"'), true);
  assert.equal(normalizedMarkup.includes('autocapitalize="off"'), true);
  assert.equal(normalizedMarkup.includes('autocomplete="off"'), true);
  assert.equal(normalizedMarkup.includes('autocorrect="off"'), true);
  assert.equal(normalizedMarkup.includes('spellcheck="false"'), true);
});

test("uses an accessible native password input for secret prompts", () => {
  const markup = renderToStaticMarkup(createElement(InputCapture, {
    value: "private-value",
    cursor: 13,
    promptKind: "secret",
    isActive: true,
    focusVersion: 0,
    onNativeValueChange: () => undefined,
    onMoveCursor: () => undefined,
    onMoveLeft: () => undefined,
    onMoveRight: () => undefined,
    onMoveStart: () => undefined,
    onMoveEnd: () => undefined,
    onMovePreviousWord: () => undefined,
    onMoveNextWord: () => undefined,
    onBackspace: () => undefined,
    onDelete: () => undefined,
    onDeletePreviousWord: () => undefined,
    onBrowseOlderHistory: () => undefined,
    onBrowseNewerHistory: () => undefined,
    onInsertText: () => undefined,
    onSubmit: () => undefined,
    onCancel: () => undefined,
    onDismissCompletion: () => undefined,
    onComplete: () => undefined,
    onFocus: () => undefined,
    onPaneKeyInput: (): InputCapturePaneKeyResult => ({ kind: "unhandled" }),
    resolveMobileCtrlInput: (input) => ({
      input,
      mobileCtrlApplied: false,
    }),
  }));
  const normalizedMarkup = markup.toLocaleLowerCase();

  assert.equal(markup.startsWith("<input"), true);
  assert.equal(markup.endsWith("/>"), true);
  assert.equal(markup.includes('type="password"'), true);
  assert.equal(markup.includes('value="private-value"'), true);
  assert.equal(markup.includes('aria-label="Secret terminal input"'), true);
  assert.equal(normalizedMarkup.includes('autocapitalize="off"'), true);
  assert.equal(normalizedMarkup.includes('autocomplete="off"'), true);
  assert.equal(normalizedMarkup.includes('autocorrect="off"'), true);
  assert.equal(normalizedMarkup.includes('spellcheck="false"'), true);
});
