import assert from "node:assert/strict";
import test from "node:test";
import {
  createElement,
  isValidElement,
  type ReactElement,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

type ViewerPaneTestProps = Readonly<{
  viewer: unknown;
  isActive: boolean;
  focusVersion: number;
  onActivate: () => void;
  onPaneKeyInput: () => Readonly<{ kind: "unhandled" }>;
  mobileCtrlPressed: boolean;
  onToggleMobileCtrl: () => void;
  onConsumeMobileCtrl: () => void;
  resolveMobileCtrlInput: (input: unknown) => Readonly<{
    input: unknown;
    mobileCtrlApplied: boolean;
  }>;
  onClose: () => void;
}>;

function isViewerPaneModule(
  value: unknown,
): value is Readonly<{
  ViewerPane: (props: ViewerPaneTestProps) => ReactElement;
}> {
  return (
    typeof value === "object" &&
    value !== null &&
    "ViewerPane" in value &&
    typeof value.ViewerPane === "function"
  );
}

test("keeps viewer return touch-accessible but hidden at desktop width", async () => {
  const vite = await createServer({
    appType: "custom",
    server: { middlewareMode: true, hmr: false },
  });

  try {
    const loadedModule: unknown = await vite.ssrLoadModule(
      "/src/ui/workspace/ViewerPane.tsx",
    );

    if (!isViewerPaneModule(loadedModule)) {
      assert.fail("Expected ViewerPane to be available.");
    }

    const rendered = createElement(loadedModule.ViewerPane, {
      viewer: { kind: "placeholder", title: "Preview" },
      isActive: true,
      focusVersion: 0,
      onActivate: () => undefined,
      onPaneKeyInput: (): Readonly<{ kind: "unhandled" }> => ({
        kind: "unhandled",
      }),
      mobileCtrlPressed: false,
      onToggleMobileCtrl: () => undefined,
      onConsumeMobileCtrl: () => undefined,
      resolveMobileCtrlInput: (input: unknown) => ({
        input,
        mobileCtrlApplied: false,
      }),
      onClose: () => undefined,
    });

    if (!isValidElement(rendered)) {
      assert.fail("Expected ViewerPane to render.");
    }

    const markup = renderToStaticMarkup(rendered);

    assert.equal(markup.includes('tabindex="0"'), true);
    assert.match(
      markup,
      /<button[^>]*class="[^"]*md:hidden[^"]*"[^>]*>Return<\/button>/u,
    );
  } finally {
    await vite.close();
  }
});
