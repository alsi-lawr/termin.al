import assert from "node:assert/strict";
import test from "node:test";
import { demoContentCorpus } from "../../content/DemoContentCorpus.ts";
import { executeCommandLine } from "../../application/commands/CommandExecution.ts";
import {
  createCommandRegistry,
  type CommandMetadata,
  type CommandInvocation,
  type CommandRegistry,
} from "../../application/commands/CommandRegistry.ts";
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
  getShellAutosuggestion,
  getShellStatus,
  reduceShellState,
  type CommandOutcome,
  type ShellState,
} from "./Shell.ts";

type RecordedCommand = Readonly<{
  name: string;
  arguments: ReadonlyArray<string>;
  optionTerminatorKind: CommandInvocation["optionTerminator"]["kind"];
}>;

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
  return reduceShellState(state, {
    kind: "command.settled",
    commandId: runningCommandId(state),
    outcome: succeededOutcome(message),
  });
}

function settleClear(state: ShellState): ShellState {
  return reduceShellState(state, {
    kind: "command.settled",
    commandId: runningCommandId(state),
    outcome: {
      kind: "succeeded",
      outputs: [],
      effects: [{ kind: "clear-scrollback" }],
    },
  });
}

function compoundCommandRegistry(calls: RecordedCommand[]): CommandRegistry {
  const record = (invocation: CommandInvocation): void => {
    calls.push({
      name: invocation.name,
      arguments: invocation.arguments,
      optionTerminatorKind: invocation.optionTerminator.kind,
    });
  };
  const metadata = (name: string): CommandMetadata => ({
    group: "gnu-like",
    name,
    aliases: [],
    summary: name,
    usage: name,
    examples: [],
  });

  return createCommandRegistry({
    commands: [
      {
        metadata: metadata("pass"),
        execute: (invocation) => {
          record(invocation);
          return Promise.resolve({
            kind: "succeeded",
            outputs: [{
              kind: "text",
              id: createShellOutputId("recorded-pass-output"),
              text: "pass",
            }],
            effects: [],
          });
        },
      },
      {
        metadata: metadata("fail"),
        execute: (invocation) => {
          record(invocation);
          return Promise.resolve({
            kind: "failed",
            failure: {
              kind: "command-rejected",
              commandName: invocation.name,
              message: "Expected test failure.",
            },
            diagnostics: [
              {
                kind: "command",
                id: createShellDiagnosticId("expected-test-failure"),
                code: "command.rejected",
                message: "Expected test failure.",
              },
            ],
          });
        },
      },
      {
        metadata: metadata("cancel"),
        execute: (invocation) => {
          record(invocation);
          return Promise.resolve({
            kind: "cancelled",
            diagnostic: {
              kind: "runtime",
              id: createShellDiagnosticId("expected-test-cancellation"),
              code: "runtime.cancelled",
              message: "Expected test cancellation.",
            },
          });
        },
      },
      {
        metadata: metadata("capture"),
        execute: (invocation) => {
          record(invocation);
          return Promise.resolve({
            kind: "succeeded",
            outputs: [{
              kind: "text",
              id: createShellOutputId("recorded-capture-output"),
              text: invocation.arguments.join(" "),
            }],
            effects: [],
          });
        },
      },
    ],
  });
}

async function executeSubmittedCommand(
  source: string,
  registry: CommandRegistry,
  signal: AbortSignal = new AbortController().signal,
): Promise<CommandOutcome> {
  const submitted = submit(createState(), source);

  if (submitted.lifecycle.kind !== "running") {
    assert.fail("Expected a submitted command line.");
  }

  return executeCommandLine({
    registry,
    request: submitted.lifecycle.command,
    signal,
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
          id: "session-command-history-1",
          source: "first",
          currentDirectory: "~",
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

test("clear removes the complete transcript and preserves command history", () => {
  const withTranscript = settleSucceeded(submit(createState(), "pwd"), "~");
  const cleared = settleClear(submit(withTranscript, "clear"));

  assert.deepEqual(cleared.history, []);
  assert.deepEqual(
    cleared.commandHistory.map((entry) => entry.source),
    ["pwd", "clear"],
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
      outputs: [],
      effects: [
        {
          kind: "set-current-directory",
          directory: projectsDirectoryPath(),
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

test("executes compound lists left to right with typed short-circuit status", async () => {
  const calls: RecordedCommand[] = [];
  const registry = compoundCommandRegistry(calls);

  const outcome = await executeSubmittedCommand(
    "pass && capture and || capture skipped ; " +
      "fail && capture skipped-too || capture recovered ; capture final",
    registry,
  );

  assert.equal(outcome.kind, "succeeded");

  if (outcome.kind !== "succeeded") {
    assert.fail("Expected the recovered list to succeed.");
  }

  assert.deepEqual(
    outcome.outputs.map((output) => output.kind),
    ["text", "text", "diagnostic", "text", "text"],
  );
  assert.deepEqual(
    calls.map(({ name, arguments: argumentsList }) => [name, ...argumentsList]),
    [
      ["pass"],
      ["capture", "and"],
      ["fail"],
      ["capture", "recovered"],
      ["capture", "final"],
    ],
  );

  calls.length = 0;

  await executeSubmittedCommand(
    "pass || capture skipped && capture left-to-right",
    registry,
  );

  assert.deepEqual(
    calls.map(({ name, arguments: argumentsList }) => [name, ...argumentsList]),
    [["pass"], ["capture", "left-to-right"]],
  );
});

test("keeps quoted and escaped operators literal and preserves option terminators", async () => {
  const calls: RecordedCommand[] = [];
  const registry = compoundCommandRegistry(calls);

  const outcome = await executeSubmittedCommand(
    "capture ';' \\|\\| \"&&\" -- --literal",
    registry,
  );

  assert.equal(outcome.kind, "succeeded");
  assert.deepEqual(calls, [
    {
      name: "capture",
      arguments: [";", "||", "&&", "--literal"],
      optionTerminatorKind: "present",
    },
  ]);
});

test("rejects malformed lists and unsupported pipelines before execution", async () => {
  const cases = [
    { source: "; pass", code: "parse.unexpected-operator", position: 0 },
    { source: "pass &&", code: "parse.trailing-operator", position: 5 },
    { source: "pass || ; fail", code: "parse.unexpected-operator", position: 8 },
    {
      source: "pass & capture later",
      code: "parse.unsupported-background-operator",
      position: 5,
    },
    {
      source: "pass | capture later",
      code: "command.pipeline-unsupported",
      position: 5,
    },
    {
      source: "pass ; capture 'unfinished",
      code: "parse.unterminated-single-quote",
      position: 15,
    },
  ];

  for (const expected of cases) {
    const calls: RecordedCommand[] = [];
    const outcome = await executeSubmittedCommand(
      expected.source,
      compoundCommandRegistry(calls),
    );

    assert.equal(outcome.kind, "failed", expected.source);

    if (outcome.kind !== "failed") {
      assert.fail(`Expected '${expected.source}' to fail.`);
    }

    const diagnostic = outcome.diagnostics[0];

    assert.equal(diagnostic?.code, expected.code, expected.source);

    if (diagnostic === undefined || !("position" in diagnostic)) {
      assert.fail(`Expected '${expected.source}' to report a position.`);
    }

    assert.equal(diagnostic.position, expected.position, expected.source);
    assert.deepEqual(calls, [], expected.source);
  }
});

test("cancellation prevents every later command unit from starting", async () => {
  const calls: RecordedCommand[] = [];
  const registry = compoundCommandRegistry(calls);

  const outcome = await executeSubmittedCommand(
    "cancel ; capture later || capture fallback",
    registry,
  );

  assert.equal(outcome.kind, "cancelled");
  assert.deepEqual(
    calls.map(({ name }) => name),
    ["cancel"],
  );

  calls.length = 0;
  const controller = new AbortController();
  controller.abort();

  const preCancelled = await executeSubmittedCommand(
    "capture never",
    registry,
    controller.signal,
  );

  assert.equal(preCancelled.kind, "cancelled");
  assert.deepEqual(calls, []);
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
      diagnostics: [
        {
          kind: "runtime",
          id: createShellDiagnosticId("execution-failed"),
          code: "runtime.execution-failed",
          message: "The command could not complete.",
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
  const submitted = reduceShellState(noCompletion, { kind: "prompt.submit" });

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
  const submitted = reduceShellState(replaced, { kind: "prompt.submit" });

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
