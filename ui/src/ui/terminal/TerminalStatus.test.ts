import assert from "node:assert/strict";
import test from "node:test";
import { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

function isTerminalStatusModule(
  value: unknown,
): value is Readonly<{
  TerminalStatus: (props: unknown) => unknown;
}> {
  return (
    typeof value === "object" &&
    value !== null &&
    "TerminalStatus" in value &&
    typeof value.TerminalStatus === "function"
  );
}

test("hides idle readiness and renders meaningful terminal statuses", async () => {
  const vite = await createServer({
    appType: "custom",
    server: { middlewareMode: true, hmr: false, ws: false },
  });

  try {
    const loadedModule: unknown = await vite.ssrLoadModule(
      "/src/ui/terminal/TerminalStatus.tsx",
    );

    if (!isTerminalStatusModule(loadedModule)) {
      assert.fail("Expected TerminalStatus to be available for rendering.");
    }

    const idle = loadedModule.TerminalStatus({
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
        status: { kind: "running", commandId: "command-1" },
        completion: { kind: "idle" },
        expected: "RUNNING",
      },
      {
        status: { kind: "cancelling", commandId: "command-1" },
        completion: { kind: "idle" },
        expected: "CANCELLING",
      },
      {
        status: { kind: "ready" },
        completion: {
          kind: "pending",
          request: {
            shellId: "terminal",
            sessionId: "session",
            source: "op",
            cursor: 2,
            target: { kind: "command", prefix: "op", start: 0, end: 2 },
          },
        },
        expected: "COMPLETING",
      },
    ] as const;

    for (const statusCase of cases) {
      const rendered = loadedModule.TerminalStatus(statusCase);

      if (!isValidElement(rendered)) {
        assert.fail(`Expected ${statusCase.expected} to render.`);
      }

      const markup = renderToStaticMarkup(rendered);

      assert.equal(markup.includes(statusCase.expected), true);
    }

    const suggestions = loadedModule.TerminalStatus({
      status: { kind: "ready" },
      completion: {
        kind: "suggestions",
        request: {
          shellId: "terminal",
          sessionId: "session",
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

    if (!isValidElement(suggestions)) {
      assert.fail("Expected completion candidates to render.");
    }

    const suggestionsMarkup = renderToStaticMarkup(suggestions);

    assert.equal(suggestionsMarkup.includes("2 COMPLETIONS"), true);
    assert.equal(suggestionsMarkup.includes("open"), true);
    assert.equal(suggestionsMarkup.includes("option"), true);
    assert.equal(suggestionsMarkup.includes('aria-selected="true"'), true);
  } finally {
    await vite.close();
  }
});
