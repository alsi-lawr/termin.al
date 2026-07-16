import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("defines the audited terminal font and hard cursor blink contracts", async () => {
  const css = await readFile(new URL("../../index.css", import.meta.url), "utf8");

  assert.equal(css.includes('font-family: "MesloLGS Nerd Font Mono";'), true);
  assert.equal(
    css.includes('url("/fonts/meslo/MesloLGSNerdFontMono-Regular.ttf")'),
    true,
  );
  assert.equal(
    css.includes('url("/fonts/meslo/MesloLGSNerdFontMono-Bold.ttf")'),
    true,
  );
  assert.equal(
    css.includes("--animate-terminal-cursor: terminal-cursor-blink 1s step-end infinite;"),
    true,
  );
});
