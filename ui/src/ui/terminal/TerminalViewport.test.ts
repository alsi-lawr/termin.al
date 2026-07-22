import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { virtualHomeDirectory } from "../../domain/filesystem/VirtualFilesystem.ts";
import { TerminalViewportContent } from "./TerminalViewport.tsx";

test("grows the transcript and active prompt naturally from the top", () => {
  const markup = renderToStaticMarkup(
    TerminalViewportContent({
    rows: [],
    promptIdentity: "anonymous@termin.al",
      currentDirectory: virtualHomeDirectory(),
      promptLabel: undefined,
      currentInput: "",
      cursorColumn: 0,
      status: { kind: "ready" },
      completion: { kind: "idle" },
      autosuggestion: { kind: "none" },
      transientDiagnostic: undefined,
    }),
  );

  assert.equal(markup.includes("Latest output"), false);
  assert.equal(markup.includes("min-h-full"), false);
  assert.equal(markup.includes("mt-auto"), false);
  assert.equal(markup.includes("anonymous@termin.al"), true);
  assert.equal(markup.includes("READY"), false);
});
