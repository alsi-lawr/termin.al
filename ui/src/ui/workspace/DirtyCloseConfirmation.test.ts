import assert from "node:assert/strict";
import test from "node:test";
import {
  createElement,
  isValidElement,
  type ReactElement,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

type DirtyCloseConfirmationTestProps = Readonly<{
  pane: unknown;
  onConfirm: () => void;
  onCancel: () => void;
}>;

function isDirtyCloseConfirmationModule(
  value: unknown,
): value is Readonly<{
  DirtyCloseConfirmation: (
    props: DirtyCloseConfirmationTestProps,
  ) => ReactElement;
}> {
  return (
    typeof value === "object" &&
    value !== null &&
    "DirtyCloseConfirmation" in value &&
    typeof value.DirtyCloseConfirmation === "function"
  );
}

test("makes the alertdialog the desktop focus boundary and actions mobile-only", async () => {
  const vite = await createServer({
    appType: "custom",
    server: { middlewareMode: true, hmr: false, ws: false },
  });

  try {
    const loadedModule: unknown = await vite.ssrLoadModule(
      "/src/ui/workspace/DirtyCloseConfirmation.tsx",
    );

    if (!isDirtyCloseConfirmationModule(loadedModule)) {
      assert.fail("Expected DirtyCloseConfirmation to be available.");
    }

    const rendered = createElement(loadedModule.DirtyCloseConfirmation, {
      pane: { content: { kind: "shell" } },
      onConfirm: () => undefined,
      onCancel: () => undefined,
    });

    if (!isValidElement(rendered)) {
      assert.fail("Expected the dirty-close confirmation to render.");
    }

    const markup = renderToStaticMarkup(rendered);

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
  } finally {
    await vite.close();
  }
});
