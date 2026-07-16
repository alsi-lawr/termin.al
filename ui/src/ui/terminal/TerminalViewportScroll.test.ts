import assert from "node:assert/strict";
import test from "node:test";
import { synchronizeTerminalViewport } from "./TerminalViewportScroll.ts";

test("keeps fresh and short transcripts at the top", () => {
  const fresh = { clientHeight: 600, scrollHeight: 80, scrollTop: 40 };
  const short = { clientHeight: 600, scrollHeight: 480, scrollTop: 40 };

  synchronizeTerminalViewport(fresh);
  synchronizeTerminalViewport(short);

  assert.equal(fresh.scrollTop, 0);
  assert.equal(short.scrollTop, 0);
});

test("follows the first and continued transcript overflow", () => {
  const firstOverflow = {
    clientHeight: 600,
    scrollHeight: 600,
    scrollTop: 0,
  };
  const continuedOverflow = {
    clientHeight: 600,
    scrollHeight: 840,
    scrollTop: 0,
  };

  synchronizeTerminalViewport(firstOverflow);
  synchronizeTerminalViewport(continuedOverflow);

  assert.equal(firstOverflow.scrollTop, 600);
  assert.equal(continuedOverflow.scrollTop, 840);
});

test("preserves idle scrollback until the next overflowing mutation", () => {
  const viewport = {
    clientHeight: 600,
    scrollHeight: 840,
    scrollTop: 120,
  };

  assert.equal(viewport.scrollTop, 120);

  synchronizeTerminalViewport(viewport);

  assert.equal(viewport.scrollTop, 840);
});

test("resets the viewport when clear removes the transcript", () => {
  const viewport = {
    clientHeight: 600,
    scrollHeight: 60,
    scrollTop: 240,
  };

  synchronizeTerminalViewport(viewport);

  assert.equal(viewport.scrollTop, 0);
});
