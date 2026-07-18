import assert from "node:assert/strict";
import test from "node:test";
import { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { virtualHomeDirectory } from "../../domain/filesystem/VirtualFilesystem.ts";
import {
  createShellDiagnosticId,
  createShellId,
  createShellOutputId,
  createShellSessionId,
  createShellState,
  reduceShellState,
  type CommandLineOutcome,
} from "../../domain/terminal/Shell.ts";

function isTerminalHistoryRowModule(
  value: unknown,
): value is Readonly<{
  TerminalHistoryRow: (...arguments_: ReadonlyArray<unknown>) => unknown;
}> {
  return (
    typeof value === "object" &&
    value !== null &&
    "TerminalHistoryRow" in value &&
    typeof value.TerminalHistoryRow === "function"
  );
}

test("does not render secret-bearing execution errors from shell history", async () => {
  const messageSecret = "rendered-history-error-message-secret";
  const stackSecret = "rendered-history-error-stack-secret";
  const nestedCauseSecret = "rendered-history-error-cause-secret";
  const fieldSecret = "rendered-history-error-field-secret";
  const cause = new Error(messageSecret, {
    cause: new Error(nestedCauseSecret),
  });

  cause.stack = stackSecret;
  Object.assign(cause, { fieldSecret });

  const initialState = createShellState({
    id: createShellId("terminal"),
    sessionId: createShellSessionId("session"),
    currentDirectory: virtualHomeDirectory(),
    scrollbackLimit: 3,
    commandHistory: [],
    commandHistoryLimit: 3,
  });
  const withInput = reduceShellState(initialState, {
    kind: "input.insert",
    text: "cat about.md",
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

  const outcome: CommandLineOutcome = {
    kind: "failed",
    failure: {
      kind: "execution-error",
      commandName: "cat",
      cause,
    },
    events: [
      {
        kind: "output",
        output: {
          kind: "diagnostic",
          id: createShellOutputId("execution-failed-output"),
          diagnostic: {
            kind: "runtime",
            id: createShellDiagnosticId("execution-failed"),
            code: "runtime.execution-failed",
            message: "The command could not complete.",
          },
        },
      },
    ],
  };
  const settled = reduceShellState(submitted, {
    kind: "command.settled",
    commandId: submitted.lifecycle.command.id,
    outcome,
  });
  const entry = settled.history[0];

  if (entry === undefined) {
    assert.fail("Expected a stored history entry.");
  }

  const vite = await createServer({
    appType: "custom",
    server: { middlewareMode: true, hmr: false, ws: false },
  });

  try {
    const loadedModule: unknown = await vite.ssrLoadModule(
      "/src/ui/terminal/TerminalHistoryRow.tsx",
    );

    if (!isTerminalHistoryRowModule(loadedModule)) {
      assert.fail("Expected TerminalHistoryRow to be available for rendering.");
    }

    const rendered = loadedModule.TerminalHistoryRow({ entry });

    if (!isValidElement(rendered)) {
      assert.fail("Expected TerminalHistoryRow to return a React element.");
    }

    const markup = renderToStaticMarkup(rendered);

    for (const secret of [
      messageSecret,
      stackSecret,
      nestedCauseSecret,
      fieldSecret,
    ]) {
      assert.equal(markup.includes(secret), false);
    }

    assert.equal(markup.includes("The command could not complete."), true);
  } finally {
    await vite.close();
  }
});
