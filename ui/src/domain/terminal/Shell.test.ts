import assert from "node:assert/strict";
import test from "node:test";
import { developmentFixtureCorpus } from "../../content/DevelopmentFixtureCorpus.ts";
import { createCompletionRequest } from "./Completion.ts";
import {
  resolveVirtualDirectory,
  virtualHomeDirectory,
} from "../filesystem/VirtualFilesystem.ts";
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
    currentDirectory: virtualHomeDirectory(),
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

function projectsDirectory() {
  const resolution = resolveVirtualDirectory(
    developmentFixtureCorpus.filesystem,
    virtualHomeDirectory(),
    "projects",
  );

  if (resolution.kind !== "found") {
    assert.fail("Expected the development projects directory.");
  }

  return resolution.directory;
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
      currentDirectory: "~",
      commandHistory: [
        {
          id: "session-command-history-1",
          source: "first",
        },
      ],
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

test("keeps each shell current directory in its own immutable state", () => {
  const first = submit(createState(), "cd projects");
  const second = createState();
  const commandId = runningCommandId(first);
  const settled = reduceShellState(first, {
    kind: "command.settled",
    commandId,
    outcome: {
      kind: "succeeded",
      outputs: [],
      effects: [
        {
          kind: "set-current-directory",
          directory: projectsDirectory().path,
        },
      ],
    },
  });

  assert.equal(first.currentDirectory, "~");
  assert.equal(second.currentDirectory, "~");
  assert.equal(settled.currentDirectory, "~/projects");
  assert.equal(
    settled.history[0]?.command.currentDirectory,
    "~",
  );
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

test("discards execution causes only when storing shell history", () => {
  const messageSecret = "history-error-message-secret";
  const stackSecret = "history-error-stack-secret";
  const nestedCauseSecret = "history-error-cause-secret";
  const fieldSecret = "history-error-field-secret";
  const cause = new Error(messageSecret, {
    cause: new Error(nestedCauseSecret),
  });

  cause.stack = stackSecret;
  Object.assign(cause, { fieldSecret });

  const submitted = submit(createState(), "cat about.md");
  const commandId = runningCommandId(submitted);
  const outcome: CommandOutcome = {
    kind: "failed",
    failure: {
      kind: "execution-error",
      commandName: "cat",
      cause,
    },
    diagnostics: [
      {
        kind: "runtime",
        id: createShellDiagnosticId("execution-failed"),
        code: "runtime.execution-failed",
        message: "The command could not complete.",
      },
    ],
  };

  assert.equal(outcome.kind, "failed");
  if (outcome.kind !== "failed" || outcome.failure.kind !== "execution-error") {
    assert.fail("Expected an execution-error outcome.");
  }

  assert.strictEqual(outcome.failure.cause, cause);

  const settled = reduceShellState(submitted, {
    kind: "command.settled",
    commandId,
    outcome,
  });
  const entry = settled.history[0];

  if (
    entry === undefined ||
    entry.outcome.kind !== "failed" ||
    entry.outcome.failure.kind !== "execution-error"
  ) {
    assert.fail("Expected a stored execution-error outcome.");
  }

  assert.deepEqual(entry.outcome.failure, {
    kind: "execution-error",
    commandName: "cat",
  });
  assert.equal("cause" in entry.outcome.failure, false);

  const serializedState = JSON.stringify(settled);

  for (const secret of [
    messageSecret,
    stackSecret,
    nestedCauseSecret,
    fieldSecret,
  ]) {
    assert.equal(serializedState.includes(secret), false);
  }
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

  assert.equal(activePrompt.prompt.request.id, request.id);
  assert.equal(activePrompt.prompt.editor.buffer.value, "sensitive-value");

  const submitted = reduceShellState(typed, { kind: "prompt.submit" });

  assert.deepEqual(submitted.secretPrompt, { kind: "none" });
  assert.equal(submitted.input.buffer.value, "");
  assert.deepEqual(submitted.history, []);
  assert.deepEqual(submitted.commandHistory, []);
  assert.deepEqual(submitted.completion, { kind: "idle" });
  assert.deepEqual(submitted.pendingEffect, {
    kind: "secret-submitted",
    requestId: request.id,
    value: "sensitive-value",
  });

  const consumed = reduceShellState(submitted, {
    kind: "secret-prompt.effect.consumed",
    requestId: request.id,
  });
  const repeated = reduceShellState(consumed, { kind: "prompt.submit" });

  assert.deepEqual(consumed.pendingEffect, { kind: "none" });
  assert.deepEqual(repeated.pendingEffect, { kind: "none" });
  assert.deepEqual(repeated.history, []);
  assert.deepEqual(repeated.commandHistory, []);
});

test("emits one correlated secret cancellation without retaining the typed value", () => {
  const request = createSecretPromptRequest(
    createSecretPromptId("oauth-code"),
    "One-time code",
  );
  const active = reduceShellState(createState(), {
    kind: "secret.begin",
    request,
  });
  const typed = reduceShellState(active, {
    kind: "input.insert",
    text: "sensitive-value",
  });
  const cancelled = reduceShellState(typed, { kind: "prompt.cancel" });

  assert.deepEqual(cancelled.secretPrompt, { kind: "none" });
  assert.deepEqual(cancelled.pendingEffect, {
    kind: "secret-cancelled",
    requestId: request.id,
  });
  assert.equal(JSON.stringify(cancelled).includes("sensitive-value"), false);

  const consumed = reduceShellState(cancelled, {
    kind: "secret-prompt.effect.consumed",
    requestId: request.id,
  });
  const repeated = reduceShellState(consumed, { kind: "prompt.cancel" });

  assert.deepEqual(consumed.pendingEffect, { kind: "none" });
  assert.deepEqual(repeated.pendingEffect, { kind: "none" });
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

test("preserves astral input through cursor editing and command submission", () => {
  const normalized = reduceShellState(createState(), {
    kind: "input.replace",
    value: "😀",
    cursor: 1,
  });
  const backspaced = reduceShellState(
    reduceShellState(createState(), {
      kind: "input.insert",
      text: "😀",
    }),
    { kind: "input.backspace" },
  );
  const deleted = reduceShellState(normalized, { kind: "input.delete" });
  const submitted = reduceShellState(
    reduceShellState(createState(), {
      kind: "input.insert",
      text: "echo 😀",
    }),
    { kind: "prompt.submit" },
  );

  assert.equal(normalized.input.buffer.cursor, 0);
  assert.equal(backspaced.input.buffer.value, "");
  assert.equal(deleted.input.buffer.value, "");

  if (submitted.lifecycle.kind !== "running") {
    assert.fail("Expected astral input to submit a command.");
  }

  assert.equal(submitted.lifecycle.command.source, "echo 😀");
  assert.equal(submitted.commandHistory[0]?.source, "echo 😀");
});
