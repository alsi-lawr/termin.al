import assert from "node:assert/strict";
import test from "node:test";
import { PromptMode } from "./PromptBuffer.ts";
import {
  createShellId,
  createShellSessionId,
  createShellState,
  getShellStatus,
  reduceShellState,
  type CommandOutcome,
  type ShellState,
} from "./Shell.ts";

function createState(historyLimit = 3): ShellState {
  return createShellState({
    id: createShellId("terminal"),
    sessionId: createShellSessionId("session"),
    historyLimit,
  });
}

function submittedState(source: string, historyLimit = 3): ShellState {
  const withInput = reduceShellState(createState(historyLimit), {
    kind: "input.insert",
    text: source,
  });

  return reduceShellState(withInput, { kind: "command.submit" });
}

function runningCommandId(state: ShellState) {
  if (state.lifecycle.kind !== "running") {
    assert.fail("Expected the shell to be running a command.");
  }

  return state.lifecycle.command.id;
}

function succeededOutcome(message: string): CommandOutcome {
  return {
    kind: "succeeded",
    outputs: [{ kind: "text", text: message }],
    effects: [],
  };
}

test("reduces immutable prompt editing transitions", () => {
  const initial = createState();
  const inserted = reduceShellState(initial, {
    kind: "input.insert",
    text: "ac",
  });
  const moved = reduceShellState(inserted, { kind: "input.move-left" });
  const completed = reduceShellState(moved, {
    kind: "input.insert",
    text: "b",
  });
  const deleted = reduceShellState(completed, { kind: "input.delete" });
  const backspaced = reduceShellState(deleted, { kind: "input.backspace" });
  const normal = reduceShellState(backspaced, {
    kind: "input.set-mode",
    mode: PromptMode.Normal,
  });
  const right = reduceShellState(normal, { kind: "input.move-right" });

  assert.deepEqual(initial.input, {
    value: "",
    cursor: 0,
    mode: { kind: "insert" },
  });
  assert.deepEqual(inserted.input, {
    value: "ac",
    cursor: 2,
    mode: { kind: "insert" },
  });
  assert.deepEqual(completed.input, {
    value: "abc",
    cursor: 2,
    mode: { kind: "insert" },
  });
  assert.deepEqual(deleted.input, {
    value: "ab",
    cursor: 2,
    mode: { kind: "insert" },
  });
  assert.deepEqual(backspaced.input, {
    value: "a",
    cursor: 1,
    mode: { kind: "insert" },
  });
  assert.deepEqual(right.input, {
    value: "a",
    cursor: 1,
    mode: { kind: "normal" },
  });
  assert.deepEqual(getShellStatus(right), {
    kind: "ready",
    mode: { kind: "normal" },
  });
});

test("creates, consumes, and settles a command execution", () => {
  const submitted = submittedState("unknown");
  const commandId = runningCommandId(submitted);

  assert.deepEqual(submitted.input, {
    value: "",
    cursor: 0,
    mode: { kind: "insert" },
  });
  assert.deepEqual(submitted.pendingEffect, {
    kind: "execute-command",
    command: {
      id: commandId,
      shellId: "terminal",
      sessionId: "session",
      source: "unknown",
    },
  });

  const consumed = reduceShellState(submitted, {
    kind: "effect.consumed",
    commandId,
  });
  const settled = reduceShellState(consumed, {
    kind: "command.settled",
    commandId,
    outcome: succeededOutcome("done"),
  });

  assert.deepEqual(consumed.pendingEffect, { kind: "none" });
  assert.deepEqual(settled.lifecycle, { kind: "idle" });
  assert.deepEqual(settled.pendingEffect, { kind: "none" });
  assert.deepEqual(settled.history, [
    {
      id: "session-history-1",
      command: {
        id: "session-command-1",
        shellId: "terminal",
        sessionId: "session",
        source: "unknown",
      },
      outcome: succeededOutcome("done"),
    },
  ]);
});

test("cancels a running command and records its cancellation", () => {
  const submitted = submittedState("wait");
  const commandId = runningCommandId(submitted);
  const cancelling = reduceShellState(submitted, { kind: "command.cancel" });

  assert.deepEqual(cancelling.lifecycle, {
    kind: "cancelling",
    command: {
      id: commandId,
      shellId: "terminal",
      sessionId: "session",
      source: "wait",
    },
  });
  assert.deepEqual(cancelling.pendingEffect, {
    kind: "cancel-command",
    commandId,
  });

  const settled = reduceShellState(cancelling, {
    kind: "command.settled",
    commandId,
    outcome: {
      kind: "cancelled",
      diagnostic: {
        kind: "runtime",
        code: "runtime.cancelled",
        message: "Command cancelled.",
      },
    },
  });

  assert.equal(settled.lifecycle.kind, "idle");
  assert.equal(settled.history[0]?.outcome.kind, "cancelled");
});

test("records expected failures and bounds history per shell", () => {
  const firstSubmitted = submittedState("missing", 1);
  const firstCommandId = runningCommandId(firstSubmitted);
  const firstSettled = reduceShellState(firstSubmitted, {
    kind: "command.settled",
    commandId: firstCommandId,
    outcome: {
      kind: "failed",
      failure: { kind: "command-not-found", commandName: "missing" },
      diagnostics: [
        {
          kind: "command",
          code: "command.not-found",
          message: "Command not found: missing",
        },
      ],
    },
  });
  const secondWithInput = reduceShellState(firstSettled, {
    kind: "input.insert",
    text: "next",
  });
  const secondSubmitted = reduceShellState(secondWithInput, {
    kind: "command.submit",
  });
  const secondCommandId = runningCommandId(secondSubmitted);
  const secondSettled = reduceShellState(secondSubmitted, {
    kind: "command.settled",
    commandId: secondCommandId,
    outcome: succeededOutcome("next"),
  });

  assert.deepEqual(secondSettled.history.map((entry) => entry.command.source), [
    "next",
  ]);
  assert.equal(secondSettled.history[0]?.outcome.kind, "succeeded");
});

test("ignores stale settlements and disallows cancelling an idle shell", () => {
  const idle = createState();
  const cancelled = reduceShellState(idle, { kind: "command.cancel" });
  const submitted = submittedState("active");
  const commandId = runningCommandId(submitted);
  const settled = reduceShellState(submitted, {
    kind: "command.settled",
    commandId,
    outcome: succeededOutcome("done"),
  });
  const stale = reduceShellState(settled, {
    kind: "command.settled",
    commandId,
    outcome: succeededOutcome("ignored"),
  });

  assert.equal(cancelled, idle);
  assert.equal(stale, settled);
});
