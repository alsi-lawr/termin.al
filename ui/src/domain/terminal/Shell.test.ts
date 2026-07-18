import assert from "node:assert/strict";
import test from "node:test";
import { demoContentCorpus } from "../../content/DemoContentCorpus.ts";
import { createCompletionRequest } from "./Completion.ts";
import {
  resolveVirtualDirectory,
  virtualHomeDirectory,
} from "../filesystem/VirtualFilesystem.ts";
import {
  createSecretPromptId,
  createCommandHistoryTieBreaker,
  createCommandHistoryTimestamp,
  createSecretPromptRequest,
  createShellDiagnosticId,
  createShellId,
  createShellOutputId,
  createShellSessionId,
  createShellState,
  getActiveShellPrompt,
  getShellAutosuggestion,
  getShellStatus,
  reduceShellState,
  type CommandLineOutcome,
  type CommandHistoryEntry,
  type CommandSubmission,
  type ShellOutput,
  type ShellState,
} from "./Shell.ts";
import {
  clearPersistedCommandHistory,
  commandHistoryFromStoredValue,
  commandHistoryStorageKey,
  mergeCommandHistory,
  persistCommandHistory,
  readCommandHistory,
} from "../../ui/workspace/CommandHistoryStorage.ts";

function createState(
  scrollbackLimit = 3,
  commandHistoryLimit = 3,
): ShellState {
  return createShellState({
    id: createShellId("terminal"),
    sessionId: createShellSessionId("session"),
    currentDirectory: virtualHomeDirectory(),
    scrollbackLimit,
    commandHistory: [],
    commandHistoryLimit,
  });
}

function persistentSubmission(state: ShellState): CommandSubmission {
  return {
    kind: "command",
    timestamp: createCommandHistoryTimestamp(state.nextCommandHistorySequence),
    tieBreaker: createCommandHistoryTieBreaker(
      state.nextCommandHistorySequence,
    ),
    persistence: { kind: "persistent" },
  };
}

function historyEntry(
  source: string,
  timestamp: number,
  tieBreaker: number,
  persistence: CommandHistoryEntry["persistence"] = { kind: "persistent" },
): CommandHistoryEntry {
  return {
    source,
    currentDirectory: virtualHomeDirectory(),
    timestamp: createCommandHistoryTimestamp(timestamp),
    tieBreaker: createCommandHistoryTieBreaker(tieBreaker),
    persistence,
  };
}

function submit(state: ShellState, source: string): ShellState {
  const withInput = reduceShellState(state, {
    kind: "input.insert",
    text: source,
  });

  return reduceShellState(withInput, {
    kind: "prompt.submit",
    submission: persistentSubmission(withInput),
  });
}

function runningCommandId(state: ShellState) {
  if (state.lifecycle.kind !== "running") {
    assert.fail("Expected the shell to be running a command.");
  }

  return state.lifecycle.command.id;
}

function succeededOutcome(message: string): CommandLineOutcome {
  return {
    kind: "succeeded",
    events: [
      {
        kind: "output",
        output: {
          kind: "text",
          id: createShellOutputId("command-output"),
          text: message,
        },
      },
    ],
  };
}

function settleSucceeded(state: ShellState, message: string): ShellState {
  return reduceShellState(state, {
    kind: "command.settled",
    commandId: runningCommandId(state),
    outcome: succeededOutcome(message),
  });
}

function projectsDirectoryPath() {
  const resolution = resolveVirtualDirectory(
    demoContentCorpus.filesystem,
    virtualHomeDirectory(),
    "projects",
  );

  if (resolution.kind !== "found") {
    assert.fail("Expected the development projects directory.");
  }

  return resolution.directory.path;
}

test("derives meaningful terminal lifecycle statuses", () => {
  const ready = createState();
  const running = submit(ready, "echo ready");
  const commandId = runningCommandId(running);
  const cancelling = reduceShellState(running, { kind: "command.cancel" });
  const secret = reduceShellState(ready, {
    kind: "secret.begin",
    request: createSecretPromptRequest(
      createSecretPromptId("status-secret"),
      "Secret",
    ),
  });

  assert.deepEqual(getShellStatus(ready), { kind: "ready" });
  assert.deepEqual(getShellStatus(running), {
    kind: "running",
    commandId,
  });
  assert.deepEqual(getShellStatus(cancelling), {
    kind: "cancelling",
    commandId,
  });
  assert.deepEqual(getShellStatus(secret), { kind: "secret" });
});

test("reduces command execution and captures stable command cwd history", () => {
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
          source: "first",
          currentDirectory: "~",
          timestamp: 1,
          tieBreaker: 1,
          persistence: { kind: "persistent" },
        },
      ],
    },
  });

  const firstSettled = settleSucceeded(firstSubmitted, "one");
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
  assert.deepEqual(
    thirdSettled.commandHistory.map((entry) => entry.currentDirectory),
    ["~", "~"],
  );
  assert.deepEqual(thirdSettled.lifecycle, { kind: "idle" });
  assert.deepEqual(thirdSettled.pendingEffect, { kind: "none" });
});

test("hydrates navigation and autosuggestion and collapses consecutive duplicate submissions", () => {
  const hydrated = createShellState({
    id: createShellId("hydrated-terminal"),
    sessionId: createShellSessionId("hydrated-session"),
    currentDirectory: virtualHomeDirectory(),
    scrollbackLimit: 3,
    commandHistoryLimit: 100,
    commandHistory: [historyEntry("echo first", 1, 1)],
  });
  const older = reduceShellState(hydrated, { kind: "history.older" });
  const suggested = reduceShellState(hydrated, {
    kind: "input.insert",
    text: "echo f",
  });
  const firstDuplicate = settleSucceeded(
    submit(hydrated, "echo first"),
    "first",
  );
  const secondDuplicate = submit(firstDuplicate, "echo first");

  assert.equal(older.input.text, "echo first");
  assert.deepEqual(getShellAutosuggestion(suggested), {
    kind: "suggestion",
    value: "echo first",
    suffix: "irst",
  });
  assert.equal(secondDuplicate.commandHistory.length, 1);
  assert.equal(secondDuplicate.commandHistory[0]?.timestamp, 2);
});

test("clears command history without applying scrollback clear semantics", () => {
  const submitted = submit(
    settleSucceeded(submit(createState(), "echo retained"), "retained"),
    "history clear",
  );
  const cleared = reduceShellState(submitted, {
    kind: "command.settled",
    commandId: runningCommandId(submitted),
    outcome: {
      kind: "succeeded",
      events: [{ kind: "effect", effect: { kind: "clear-command-history" } }],
    },
  });

  assert.deepEqual(cleared.commandHistory, []);
  assert.equal(cleared.history.length, 2);
});

test("merges stored history deterministically, bounds it, and validates guarded records", () => {
  const equalTimestamp = mergeCommandHistory(
    [historyEntry("zeta", 1, 1)],
    [historyEntry("alpha 😀", 1, 1)],
  );
  const bounded = mergeCommandHistory(
    Array.from({ length: 101 }, (_, index) =>
      historyEntry(`echo ${index}`, index, index)
    ),
  );
  const validRecord = JSON.stringify({
    version: 1,
    entries: [{
      source: "echo 😀",
      currentDirectory: "~",
      timestamp: 2,
      tieBreaker: 3,
    }],
  });
  const hydrated = commandHistoryFromStoredValue(
    validRecord,
    demoContentCorpus.filesystem,
  );

  assert.deepEqual(equalTimestamp.map((entry) => entry.source), [
    "alpha 😀",
    "zeta",
  ]);
  assert.equal(bounded.length, 100);
  assert.equal(bounded[0]?.source, "echo 1");
  assert.equal(hydrated.kind, "available");
  if (hydrated.kind === "available") {
    assert.equal(hydrated.entries[0]?.source, "echo 😀");
  }
  assert.equal(
    commandHistoryFromStoredValue("{", demoContentCorpus.filesystem).kind,
    "unavailable",
  );
  assert.equal(
    commandHistoryFromStoredValue(
      JSON.stringify({ version: 2, entries: [] }),
      demoContentCorpus.filesystem,
    ).kind,
    "unavailable",
  );
  assert.equal(
    commandHistoryFromStoredValue(
      "x".repeat(128 * 1024 + 1),
      demoContentCorpus.filesystem,
    ).kind,
    "unavailable",
  );
});

test("persists only eligible command fields and falls back without payload diagnostics", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string): string | null => values.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      values.set(key, value);
    },
    removeItem: (key: string): void => {
      values.delete(key);
    },
  };
  const secretSource = "credential-command private-token";
  const persisted = persistCommandHistory(
    storage,
    demoContentCorpus.filesystem,
    [
      historyEntry("echo public", 1, 1),
      historyEntry(secretSource, 2, 2, {
        kind: "memory-only",
        reason: "credential-arguments",
      }),
    ],
  );
  const stored = values.get(commandHistoryStorageKey) ?? "";
  const cleared = clearPersistedCommandHistory(storage);
  const storedAfterClear = values.get(commandHistoryStorageKey) ?? "";
  const blocked = readCommandHistory(
    {
      getItem: () => {
        throw new Error(secretSource);
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    },
    demoContentCorpus.filesystem,
  );
  const quotaSecret = "quota-private-payload";
  const quotaFailed = persistCommandHistory(
    {
      getItem: () => null,
      setItem: () => {
        throw new Error(quotaSecret);
      },
      removeItem: () => undefined,
    },
    demoContentCorpus.filesystem,
    [historyEntry("echo quota", 3, 3)],
  );

  assert.equal(persisted.kind, "available");
  assert.equal(stored.includes("echo public"), true);
  assert.equal(stored.includes(secretSource), false);
  assert.equal(stored.includes("persistence"), false);
  assert.equal(stored.includes("id"), false);
  assert.equal(cleared.kind, "available");
  const hydratedAfterClear = commandHistoryFromStoredValue(
    storedAfterClear,
    demoContentCorpus.filesystem,
  );
  assert.equal(hydratedAfterClear.kind, "available");
  if (hydratedAfterClear.kind === "available") {
    assert.deepEqual(hydratedAfterClear.entries, []);
  }
  assert.equal(blocked.kind, "unavailable");
  if (blocked.kind === "unavailable") {
    assert.equal(blocked.diagnostic.includes(secretSource), false);
  }
  assert.equal(quotaFailed.kind, "unavailable");
  if (quotaFailed.kind === "unavailable") {
    assert.equal(quotaFailed.diagnostic.includes(quotaSecret), false);
  }
});

test("clear removes earlier output while preserving later output and command history", () => {
  const withTranscript = settleSucceeded(submit(createState(), "pwd"), "~");
  const submitted = submit(withTranscript, "clear ; pwd");
  const output: ShellOutput = {
    kind: "text",
    id: createShellOutputId("post-clear-output"),
    text: "~",
  };
  const cleared = reduceShellState(submitted, {
    kind: "command.settled",
    commandId: runningCommandId(submitted),
    outcome: {
      kind: "succeeded",
      events: [
        { kind: "effect", effect: { kind: "clear-scrollback" } },
        { kind: "output", output },
      ],
    },
  });

  assert.deepEqual(cleared.history[0]?.outcome.events, [
    { kind: "output", output },
  ]);
  assert.deepEqual(
    cleared.commandHistory.map((entry) => entry.source),
    ["pwd", "clear ; pwd"],
  );
  assert.deepEqual(cleared.lifecycle, { kind: "idle" });
  assert.deepEqual(cleared.pendingEffect, { kind: "none" });
});

test("keeps each shell current directory immutable and records submission context", () => {
  const first = submit(createState(), "cd projects");
  const second = createState();
  const commandId = runningCommandId(first);
  const settled = reduceShellState(first, {
    kind: "command.settled",
    commandId,
    outcome: {
      kind: "succeeded",
      events: [
        {
          kind: "effect",
          effect: {
            kind: "set-current-directory",
            directory: projectsDirectoryPath(),
          },
        },
      ],
    },
  });

  assert.equal(first.currentDirectory, "~");
  assert.equal(second.currentDirectory, "~");
  assert.equal(settled.currentDirectory, "~/projects");
  assert.equal(settled.history[0]?.command.currentDirectory, "~");
  assert.equal(settled.commandHistory[0]?.currentDirectory, "~");
});

test("requests cancellation through the active command AbortSignal seam", () => {
  const submitted = submit(createState(), "wait");
  const commandId = runningCommandId(submitted);
  const cancelling = reduceShellState(submitted, { kind: "prompt.cancel" });

  assert.deepEqual(cancelling.pendingEffect, {
    kind: "cancel-command",
    commandId,
  });

  const settled = reduceShellState(cancelling, {
    kind: "command.settled",
    commandId,
    outcome: {
      kind: "cancelled",
      events: [{
        kind: "output",
        output: {
          kind: "diagnostic",
          id: createShellOutputId("cancelled-output"),
          diagnostic: {
            kind: "runtime",
            id: createShellDiagnosticId("cancelled-command"),
            code: "runtime.cancelled",
            message: "Command cancelled.",
          },
        },
      }],
    },
  });

  assert.equal(settled.lifecycle.kind, "idle");
  assert.equal(settled.history[0]?.outcome.kind, "cancelled");
});

test("discards execution causes when storing shell history", () => {
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
  const settled = reduceShellState(submitted, {
    kind: "command.settled",
    commandId,
    outcome: {
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
    },
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

test("navigates history with Up and Down while restoring its command draft", () => {
  const first = settleSucceeded(submit(createState(), "first"), "one");
  const second = settleSucceeded(submit(first, "second"), "two");
  const withDraft = reduceShellState(second, {
    kind: "input.insert",
    text: "draft",
  });
  const previous = reduceShellState(withDraft, { kind: "history.older" });
  const oldest = reduceShellState(previous, { kind: "history.older" });
  const newer = reduceShellState(oldest, { kind: "history.newer" });
  const draft = reduceShellState(newer, { kind: "history.newer" });

  assert.equal(previous.input.text, "second");
  assert.equal(oldest.input.text, "first");
  assert.equal(newer.input.text, "second");
  assert.equal(draft.input.text, "draft");
  assert.deepEqual(draft.historyNavigation, { kind: "not-browsing" });
});

test("derives, accepts, and dismisses a history autosuggestion without mutating input", () => {
  const history = settleSucceeded(submit(createState(), "help 😀"), "one");
  const typed = reduceShellState(history, {
    kind: "input.insert",
    text: "h",
  });

  assert.equal(typed.input.text, "h");
  assert.deepEqual(getShellAutosuggestion(typed), {
    kind: "suggestion",
    value: "help 😀",
    suffix: "elp 😀",
  });

  const acceptedWithRight = reduceShellState(typed, {
    kind: "input.move-right",
  });
  const acceptedWithEnd = reduceShellState(typed, { kind: "input.move-end" });

  for (const accepted of [acceptedWithRight, acceptedWithEnd]) {
    assert.equal(accepted.input.text, "help 😀");
    assert.equal(accepted.input.cursor, "help 😀".length);
  }

  const refreshed = reduceShellState(history, {
    kind: "input.insert",
    text: "he",
  });
  const dismissed = reduceShellState(refreshed, {
    kind: "completion.dismiss",
  });

  assert.deepEqual(getShellAutosuggestion(dismissed), { kind: "none" });
  assert.equal(dismissed.input.text, "he");
});

test("keeps secret values out of history, autosuggestion, and retained state", () => {
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

  assert.equal(activePrompt.prompt.line.text, "sensitive-value");
  assert.deepEqual(getShellAutosuggestion(typed), { kind: "none" });

  const requestWhileSecret = createCompletionRequest(
    typed.id,
    typed.sessionId,
    "sensitive-value",
    "sensitive-value".length,
  );
  const noCompletion = reduceShellState(typed, {
    kind: "completion.request",
    request: requestWhileSecret,
  });
  const submitted = reduceShellState(noCompletion, {
    kind: "prompt.submit",
    submission: { kind: "secret" },
  });

  assert.deepEqual(submitted.secretPrompt, { kind: "none" });
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

  assert.equal(JSON.stringify(consumed).includes("sensitive-value"), false);
});

test("uses one-line native replacements and preserves astral command input", () => {
  const source = "echo 😀\r\nnext\rthen\nlast";
  const expected = "echo 😀 next then last";
  const replaced = reduceShellState(createState(), {
    kind: "input.replace",
    value: source,
    cursor: source.length,
  });
  const moved = reduceShellState(replaced, { kind: "input.move-left" });
  const deleted = reduceShellState(moved, { kind: "input.delete" });
  const submitted = reduceShellState(replaced, {
    kind: "prompt.submit",
    submission: persistentSubmission(replaced),
  });

  assert.equal(replaced.input.text, expected);
  assert.equal(replaced.input.cursor, expected.length);
  assert.equal(deleted.input.text, "echo 😀 next then las");

  if (submitted.lifecycle.kind !== "running") {
    assert.fail("Expected a command to run.");
  }

  assert.equal(submitted.lifecycle.command.source, expected);
});

test("applies common completion prefixes, cycles candidates, and has no terminal Vim state", () => {
  const input = reduceShellState(createState(), {
    kind: "input.insert",
    text: "open pro",
  });
  const request = createCompletionRequest(
    input.id,
    input.sessionId,
    input.input.text,
    input.input.cursor,
  );
  const pending = reduceShellState(input, {
    kind: "completion.request",
    request,
  });
  const suggestions = reduceShellState(pending, {
    kind: "completion.resolved",
    request,
    result: {
      kind: "multiple",
      candidates: [
        { kind: "path", value: "project-one", label: "Directory" },
        { kind: "path", value: "project-two", label: "Directory" },
      ],
    },
  });

  assert.equal(suggestions.input.text, "open project-");
  assert.equal(suggestions.completion.kind, "suggestions");

  const selected = reduceShellState(suggestions, {
    kind: "completion.cycle",
    direction: "next",
  });

  if (selected.completion.kind !== "suggestions") {
    assert.fail("Expected completion candidates to remain visible.");
  }

  assert.deepEqual(selected.completion.selection, { kind: "selected", index: 0 });
  assert.equal(selected.input.text, "open project-");

  const accepted = reduceShellState(selected, { kind: "input.move-right" });

  assert.equal(accepted.input.text, "open project-one");
  assert.deepEqual(accepted.completion, { kind: "idle" });

  const dismissed = reduceShellState(selected, { kind: "completion.dismiss" });

  assert.deepEqual(dismissed.completion, { kind: "idle" });
  assert.equal("mode" in getShellStatus(createState()), false);
});

test("retains a browser Tab completion when native selection repeats the request cursor", () => {
  const input = reduceShellState(createState(), {
    kind: "input.insert",
    text: "h",
  });
  const request = createCompletionRequest(
    input.id,
    input.sessionId,
    input.input.text,
    input.input.cursor,
  );
  const pending = reduceShellState(input, {
    kind: "completion.request",
    request,
  });
  const repeatedNativeSelection = reduceShellState(pending, {
    kind: "input.move-cursor",
    cursor: request.cursor,
  });

  assert.strictEqual(repeatedNativeSelection, pending);

  const resolved = reduceShellState(repeatedNativeSelection, {
    kind: "completion.resolved",
    request,
    result: {
      kind: "multiple",
      candidates: [
        { kind: "command", value: "head", label: "GNU-like" },
        { kind: "command", value: "help", label: "Application" },
        { kind: "command", value: "history", label: "GNU-like" },
      ],
    },
  });

  assert.equal(resolved.input.text, "h");
  assert.equal(resolved.completion.kind, "suggestions");
});

test("applies a unique virtual-path completion at the cursor end", () => {
  const input = reduceShellState(createState(), {
    kind: "input.insert",
    text: "cat pro",
  });
  const request = createCompletionRequest(
    input.id,
    input.sessionId,
    input.input.text,
    input.input.cursor,
  );
  const pending = reduceShellState(input, {
    kind: "completion.request",
    request,
  });
  const resolved = reduceShellState(pending, {
    kind: "completion.resolved",
    request,
    result: {
      kind: "single",
      candidate: {
        kind: "path",
        value: "projects/",
        label: "Directory",
      },
    },
  });

  assert.equal(resolved.input.text, "cat projects/");
  assert.equal(resolved.input.cursor, "cat projects/".length);
  assert.deepEqual(resolved.completion, { kind: "idle" });
});
