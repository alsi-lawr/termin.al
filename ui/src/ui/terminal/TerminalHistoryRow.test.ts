import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
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
import { TerminalHistoryRow } from "./TerminalHistoryRow.tsx";

test("does not render secret-bearing execution errors from shell history", () => {
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

  const markup = renderToStaticMarkup(TerminalHistoryRow({
    entry,
    promptIdentity: "anonymous@termin.al",
  }));

  for (const secret of [
    messageSecret,
    stackSecret,
    nestedCauseSecret,
    fieldSecret,
  ]) {
    assert.equal(markup.includes(secret), false);
  }

  assert.equal(markup.includes("The command could not complete."), true);
});
