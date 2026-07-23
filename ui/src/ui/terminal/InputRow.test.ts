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

test("starts an end-of-line suggestion beneath the cursor instead of after it", () => {
  const markup = renderToStaticMarkup(InputRow({
    activeLine: "❯ he",
    cursorIndex: 4,
    suggestionSuffix: "lp",
  }));

  assert.equal(markup.includes(">l</span><span class=\"text-text-muted\">p</span>"), true);
});
