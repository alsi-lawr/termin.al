import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createPaneId } from "../../domain/workspace/PaneTree.ts";
import { DirtyCloseConfirmation } from "./DirtyCloseConfirmation.tsx";

test("makes the alertdialog the desktop focus boundary and actions mobile-only", () => {
  const markup = renderToStaticMarkup(
    createElement(DirtyCloseConfirmation, {
      pane: { id: createPaneId("dirty-shell"), content: { kind: "shell" } },
      onConfirm: () => undefined,
      onCancel: () => undefined,
    }),
  );

  assert.equal(markup.includes('role="alertdialog"'), true);
  assert.equal(markup.includes('tabindex="-1"'), true);
  assert.equal(markup.includes('aria-modal="true"'), true);
  assert.match(
    markup,
    /<button[^>]*class="[^"]*md:hidden[^"]*"[^>]*>Keep editing<\/button>/u,
  );
  assert.match(
    markup,
    /<button[^>]*class="[^"]*md:hidden[^"]*"[^>]*>Close pane<\/button>/u,
  );
});
