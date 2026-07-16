import assert from "node:assert/strict";
import test from "node:test";
import { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { virtualHomeDirectory } from "../../domain/filesystem/VirtualFilesystem.ts";

function isTerminalViewportModule(
  value: unknown,
): value is Readonly<{
  TerminalViewportContent: (props: unknown) => unknown;
}> {
  return (
    typeof value === "object" &&
    value !== null &&
    "TerminalViewportContent" in value &&
    typeof value.TerminalViewportContent === "function"
  );
}

test("grows the transcript and active prompt naturally from the top", async () => {
  const vite = await createServer({
    appType: "custom",
    server: { middlewareMode: true },
  });

  try {
    const loadedModule: unknown = await vite.ssrLoadModule(
      "/src/ui/terminal/TerminalViewport.tsx",
    );

    if (!isTerminalViewportModule(loadedModule)) {
      assert.fail("Expected TerminalViewportContent to be available for rendering.");
    }

    const rendered = loadedModule.TerminalViewportContent({
      rows: [],
      currentDirectory: virtualHomeDirectory(),
      promptLabel: undefined,
      currentInput: "",
      cursorColumn: 0,
      status: { kind: "ready" },
      completion: { kind: "idle" },
      autosuggestion: { kind: "none" },
      transientDiagnostic: undefined,
    });

    if (!isValidElement(rendered)) {
      assert.fail("Expected TerminalViewportContent to return a React element.");
    }

    const markup = renderToStaticMarkup(rendered);

    assert.equal(markup.includes("Latest output"), false);
    assert.equal(markup.includes("min-h-full"), false);
    assert.equal(markup.includes("mt-auto"), false);
    assert.equal(markup.includes("anonymous@termin.al"), true);
  } finally {
    await vite.close();
  }
});
