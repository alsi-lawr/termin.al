import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InputCapture } from "./InputCapture.tsx";

test("uses accessible native command and secret controls", () => {
  const commandProps: ComponentProps<typeof InputCapture> = {
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
    onPaneKeyInput: () => ({ kind: "unhandled" }),
    resolveMobileCtrlInput: (input) => ({
      input,
      mobileCtrlApplied: false,
    }),
  };
  const commandMarkup = renderToStaticMarkup(
    createElement(InputCapture, commandProps),
  );
  const normalizedCommandMarkup = commandMarkup.toLocaleLowerCase();
  const secretMarkup = renderToStaticMarkup(createElement(InputCapture, {
    ...commandProps,
    value: "private-value",
    promptKind: "secret",
  }));
  const normalizedSecretMarkup = secretMarkup.toLocaleLowerCase();

  assert.match(commandMarkup, /^<textarea[^>]*>open about\.md<\/textarea>$/u);
  assert.equal(
    commandMarkup.includes('aria-label="Terminal command input"'),
    true,
  );
  assert.equal(normalizedCommandMarkup.includes('autocapitalize="off"'), true);
  assert.equal(normalizedCommandMarkup.includes('autocomplete="off"'), true);
  assert.equal(normalizedCommandMarkup.includes('autocorrect="off"'), true);
  assert.equal(normalizedCommandMarkup.includes('spellcheck="false"'), true);

  assert.equal(secretMarkup.startsWith("<input"), true);
  assert.equal(secretMarkup.endsWith("/>"), true);
  assert.equal(secretMarkup.includes('type="password"'), true);
  assert.equal(secretMarkup.includes('value="private-value"'), true);
  assert.equal(secretMarkup.includes('aria-label="Secret terminal input"'), true);
  assert.equal(normalizedSecretMarkup.includes('autocapitalize="off"'), true);
  assert.equal(normalizedSecretMarkup.includes('autocomplete="off"'), true);
  assert.equal(normalizedSecretMarkup.includes('autocorrect="off"'), true);
  assert.equal(normalizedSecretMarkup.includes('spellcheck="false"'), true);
});
