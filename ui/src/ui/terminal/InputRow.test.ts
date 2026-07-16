import assert from "node:assert/strict";
import test from "node:test";
import { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

function isInputRowModule(
  value: unknown,
): value is Readonly<{
  InputRow: (props: unknown) => unknown;
}> {
  return (
    typeof value === "object" &&
    value !== null &&
    "InputRow" in value &&
    typeof value.InputRow === "function"
  );
}

test("renders a non-collapsing cursor cell at an empty prompt", async () => {
  const vite = await createServer({
    appType: "custom",
    server: { middlewareMode: true },
  });

  try {
    const loadedModule: unknown = await vite.ssrLoadModule(
      "/src/ui/terminal/InputRow.tsx",
    );

    if (!isInputRowModule(loadedModule)) {
      assert.fail("Expected InputRow to be available for rendering.");
    }

    const rendered = loadedModule.InputRow({
      activeLine: "❯ ",
      cursorIndex: 2,
    });

    if (!isValidElement(rendered)) {
      assert.fail("Expected InputRow to return a React element.");
    }

    const markup = renderToStaticMarkup(rendered);

    assert.equal(markup.includes("\u00a0"), true);
    assert.equal(markup.includes("animate-terminal-cursor"), true);
    assert.equal(markup.includes("animate-pulse"), false);
    assert.equal(markup.includes("motion-reduce:animate-none"), true);
  } finally {
    await vite.close();
  }
});
