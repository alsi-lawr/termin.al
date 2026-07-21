import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { InputRow } from "./InputRow.tsx";

test("renders a non-collapsing cursor cell at an empty prompt", () => {
  const markup = renderToStaticMarkup(InputRow({
    activeLine: "❯ ",
    cursorIndex: 2,
  }));

  assert.equal(markup.includes("\u00a0"), true);
  assert.equal(markup.includes("animate-terminal-cursor"), true);
  assert.equal(markup.includes("animate-pulse"), false);
  assert.equal(markup.includes("motion-reduce:animate-none"), true);
});
