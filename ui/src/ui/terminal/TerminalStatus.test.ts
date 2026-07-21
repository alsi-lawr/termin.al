import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { virtualHomeDirectory } from "../../domain/filesystem/VirtualFilesystem.ts";
import {
  createShellId,
  createShellSessionId,
  createShellState,
  reduceShellState,
} from "../../domain/terminal/Shell.ts";
import { TerminalStatus } from "./TerminalStatus.tsx";

test("hides idle readiness and renders meaningful terminal statuses", () => {
  const shellId = createShellId("terminal");
  const sessionId = createShellSessionId("session");
  const initialState = createShellState({
    id: shellId,
    sessionId,
    currentDirectory: virtualHomeDirectory(),
    scrollbackLimit: 1,
    commandHistory: [],
    commandHistoryLimit: 1,
  });
  const withInput = reduceShellState(initialState, {
    kind: "input.insert",
    text: "open about.md",
  });
  const submitted = reduceShellState(withInput, {
    kind: "prompt.submit",
    submission: {
      kind: "command",
      persistence: { kind: "persistent" },
    },
  });

  if (submitted.lifecycle.kind !== "running") {
    assert.fail("Expected the shell to be running a command.");
  }

  const commandId = submitted.lifecycle.command.id;
  const idle = TerminalStatus({
    status: { kind: "ready" },
    completion: { kind: "idle" },
  });

  assert.equal(idle, null);

  const cases = [
    {
      status: { kind: "secret" },
      completion: { kind: "idle" },
      expected: "SECRET INPUT",
    },
    {
      status: { kind: "running", commandId },
      completion: { kind: "idle" },
      expected: "RUNNING",
    },
    {
      status: { kind: "cancelling", commandId },
      completion: { kind: "idle" },
      expected: "CANCELLING",
    },
    {
      status: { kind: "ready" },
      completion: {
        kind: "pending",
        request: {
          shellId,
          sessionId,
          source: "op",
          cursor: 2,
          target: { kind: "command", prefix: "op", start: 0, end: 2 },
        },
      },
      expected: "COMPLETING",
    },
  ] as const;

  for (const statusCase of cases) {
    const rendered = TerminalStatus(statusCase);

    if (rendered === null) {
      assert.fail(`Expected ${statusCase.expected} to render.`);
    }

    const markup = renderToStaticMarkup(rendered);

    assert.equal(markup.includes(statusCase.expected), true);
  }

  const suggestions = TerminalStatus({
    status: { kind: "ready" },
    completion: {
      kind: "suggestions",
      request: {
        shellId,
        sessionId,
        source: "op",
        cursor: 2,
        target: { kind: "command", prefix: "op", start: 0, end: 2 },
      },
      candidates: [
        { kind: "command", value: "open", label: "Command" },
        { kind: "command", value: "option", label: "Command" },
      ],
      selection: { kind: "selected", index: 1 },
    },
  });

  if (suggestions === null) {
    assert.fail("Expected completion candidates to render.");
  }

  const suggestionsMarkup = renderToStaticMarkup(suggestions);

  assert.equal(suggestionsMarkup.includes("2 COMPLETIONS"), true);
  assert.equal(suggestionsMarkup.includes("open"), true);
  assert.equal(suggestionsMarkup.includes("option"), true);
  assert.equal(suggestionsMarkup.includes('aria-selected="true"'), true);
});
