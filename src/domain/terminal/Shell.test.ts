import assert from "node:assert/strict";
import test from "node:test";
import { createCompletionRequest } from "./Completion.ts";
import {
  createSecretPromptId,
  createSecretPromptRequest,
  createShellDiagnosticId,
  createShellId,
  createShellOutputId,
  createShellSessionId,
  createShellState,
  getActiveShellPrompt,
  reduceShellState,
  type CommandOutcome,
  type ShellState,
} from "./Shell.ts";

function createState(
  scrollbackLimit = 3,
  commandHistoryLimit = 3,
): ShellState {
  return createShellState({
    id: createShellId("terminal"),
    sessionId: createShellSessionId("session"),
    scrollbackLimit,
    commandHistoryLimit,
  });
}

function submit(state: ShellState, source: string): ShellState {
  const withInput = reduceShellState(state, {
    kind: "input.insert",
    text: source,
  });

  return reduceShellState(withInput, { kind: "prompt.submit" });
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
    outputs: [
      {
        kind: "text",
        id: createShellOutputId("command-output"),
        text: message,
      },
    ],
    effects: [],
  };
}

function settleSucceeded(state: ShellState, message: string): ShellState {
  const commandId = runningCommandId(state);

  return reduceShellState(state, {
    kind: "command.settled",
    commandId,
    outcome: succeededOutcome(message),
  });
}

test("reduces command execution and bounds per-shell histories", () => {
  const firstSubmitted = submit(createState(2, 2), "first");
  const firstCommandId = runningCommandId(firstSubmitted);

  assert.deepEqual(firstSubmitted.pendingEffect, {
    kind: "execute-command",
    command: {
      id: firstCommandId,
      shellId: "terminal",
      sessionId: "session",
      source: "first",
    },
  });

  const consumed = reduceShellState(firstSubmitted, {
    kind: "effect.consumed",
    commandId: firstCommandId,
  });
  const firstSettled = reduceShellState(consumed, {
    kind: "command.settled",
    commandId: firstCommandId,
    outcome: succeededOutcome("one"),
  });
  const secondSettled = settleSucceeded(submit(firstSettled, "second"), "two");
  const thirdSettled = settleSucceeded(submit(secondSettled, "third"), "three");

  assert.deepEqual(
    thirdSettled.history.map((entry) => entry.command.source),
    ["second", "third"],
  );
  assert.deepEqual(
    thirdSettled.commandHistory.map((entry) => entry.source),
    ["second", "third"],
  );
  assert.deepEqual(thirdSettled.lifecycle, { kind: "idle" });
  assert.deepEqual(thirdSettled.pendingEffect, { kind: "none" });
});

test("requests cancellation through the active command AbortSignal seam", () => {
  const submitted = submit(createState(), "wait");
  const commandId = runningCommandId(submitted);
  const cancelling = reduceShellState(submitted, { kind: "prompt.cancel" });

  assert.deepEqual(cancelling.lifecycle, {
    kind: "cancelling",
    command: submitted.lifecycle.kind === "running"
      ? submitted.lifecycle.command
      : assert.fail("Expected a running command."),
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
        id: createShellDiagnosticId("cancelled-command"),
        code: "runtime.cancelled",
        message: "Command cancelled.",
      },
    },
  });

  assert.equal(settled.lifecycle.kind, "idle");
  assert.equal(settled.history[0]?.outcome.kind, "cancelled");
});

test("navigates bounded command history with normal-mode k and j", () => {
  const first = settleSucceeded(submit(createState(), "first"), "one");
  const second = settleSucceeded(submit(first, "second"), "two");
  const normal = reduceShellState(second, {
    kind: "prompt.normal-key",
    key: { kind: "escape" },
  });
  const previous = reduceShellState(normal, {
    kind: "prompt.normal-key",
    key: { kind: "history-older" },
  });
  const oldest = reduceShellState(previous, {
    kind: "prompt.normal-key",
    key: { kind: "history-older" },
  });
  const newer = reduceShellState(oldest, {
    kind: "prompt.normal-key",
    key: { kind: "history-newer" },
  });
  const draft = reduceShellState(newer, {
    kind: "prompt.normal-key",
    key: { kind: "history-newer" },
  });

  assert.equal(previous.input.buffer.value, "second");
  assert.equal(oldest.input.buffer.value, "first");
  assert.equal(newer.input.buffer.value, "second");
  assert.equal(draft.input.buffer.value, "");
  assert.deepEqual(draft.historyNavigation, { kind: "not-browsing" });
});

test("keeps secret prompts separate from command input and all histories", () => {
  const request = createSecretPromptRequest(
    createSecretPromptId("cv-key"),
    "CV access key",
  );
  const secret = reduceShellState(createState(), {
    kind: "secret.begin",
    request,
  });
  const typed = reduceShellState(secret, {
    kind: "input.insert",
    text: "sensitive-value",
  });
  const activePrompt = getActiveShellPrompt(typed);

  if (activePrompt.kind !== "secret") {
    assert.fail("Expected a secret prompt.");
  }

  assert.equal(activePrompt.prompt.editor.buffer.value, "sensitive-value");

  const submitted = reduceShellState(typed, { kind: "prompt.submit" });

  assert.deepEqual(submitted.secretPrompt, { kind: "none" });
  assert.equal(submitted.input.buffer.value, "");
  assert.deepEqual(submitted.history, []);
  assert.deepEqual(submitted.commandHistory, []);
});

test("opens a typed secret prompt requested by a command effect", () => {
  const submitted = submit(createState(), "login");
  const commandId = runningCommandId(submitted);
  const request = createSecretPromptRequest(
    createSecretPromptId("oauth-code"),
    "One-time code",
  );
  const settled = reduceShellState(submitted, {
    kind: "command.settled",
    commandId,
    outcome: {
      kind: "succeeded",
      outputs: [
        {
          kind: "prompt",
          id: createShellOutputId("login-prompt"),
          label: "login",
          message: "Authorise access",
        },
      ],
      effects: [{ kind: "request-secret-prompt", request }],
    },
  });

  assert.equal(settled.secretPrompt.kind, "active");
  assert.equal(settled.history.length, 1);
  assert.equal(settled.commandHistory.length, 1);
});

test("applies current single completions and exposes multiple matches", () => {
  const withInput = reduceShellState(createState(), {
    kind: "input.insert",
    text: "op",
  });
  const request = createCompletionRequest(
    withInput.id,
    withInput.sessionId,
    "op",
    2,
  );
  const pending = reduceShellState(withInput, {
    kind: "completion.request",
    request,
  });
  const completed = reduceShellState(pending, {
    kind: "completion.resolved",
    request,
    result: {
      kind: "single",
      candidate: { kind: "command", value: "open", label: "Open content" },
    },
  });

  assert.equal(completed.input.buffer.value, "open");
  assert.equal(completed.input.buffer.cursor, 4);

  const pathInput = reduceShellState(createState(), {
    kind: "input.insert",
    text: "open pro",
  });
  const pathRequest = createCompletionRequest(
    pathInput.id,
    pathInput.sessionId,
    "open pro",
    8,
  );
  const pathPending = reduceShellState(pathInput, {
    kind: "completion.request",
    request: pathRequest,
  });
  const suggestions = reduceShellState(pathPending, {
    kind: "completion.resolved",
    request: pathRequest,
    result: {
      kind: "multiple",
      candidates: [
        { kind: "path", value: "projects", label: "Projects" },
        { kind: "path", value: "profile", label: "Profile" },
      ],
    },
  });

  assert.equal(suggestions.completion.kind, "suggestions");
});
