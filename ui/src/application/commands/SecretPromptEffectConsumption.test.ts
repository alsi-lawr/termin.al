import assert from "node:assert/strict";
import test from "node:test";
import {
  createSecretPromptId,
  createSecretPromptRequest,
  createShellId,
  createShellSessionId,
  createShellState,
  reduceShellState,
  type SecretPromptEffect,
  type SecretPromptRequest,
  type ShellState,
} from "../../domain/terminal/Shell.ts";
import { virtualHomeDirectory } from "../../domain/filesystem/VirtualFilesystem.ts";
import {
  consumePendingSecretPromptEffect,
  createSecretPromptEffectConsumptionState,
  shouldApplySecretPromptEffectDiagnostic,
  type SecretPromptEffectConsumptionDiagnostic,
  type SecretPromptEffectConsumptionState,
  type SecretPromptSubmissionHandler,
} from "./SecretPromptEffectConsumption.ts";

type SecretSubmission = Readonly<{
  request: SecretPromptRequest;
  state: ShellState;
  effect: Extract<SecretPromptEffect, { kind: "secret-submitted" }>;
}>;

type SecretCancellation = Readonly<{
  request: SecretPromptRequest;
  state: ShellState;
  effect: Extract<SecretPromptEffect, { kind: "secret-cancelled" }>;
}>;

type DeferredSecretPromptSubmissionHandler = Readonly<{
  submissionHandler: SecretPromptSubmissionHandler;
  resolve: () => void;
  reject: (error: Error) => void;
}>;

function createSecretSubmission(value: string): SecretSubmission {
  const request = createSecretPromptRequest(
    createSecretPromptId("cv-key"),
    "CV access key",
  );
  const active = reduceShellState(
    createShellState({
      id: createShellId("terminal"),
      sessionId: createShellSessionId("session"),
      currentDirectory: virtualHomeDirectory(),
      scrollbackLimit: 3,
      commandHistory: [],
      commandHistoryLimit: 3,
    }),
    { kind: "secret.begin", request },
  );
  const typed = reduceShellState(active, { kind: "input.insert", text: value });
  const submitted = reduceShellState(typed, {
    kind: "prompt.submit",
    submission: { kind: "secret" },
  });

  if (submitted.pendingEffect.kind !== "secret-submitted") {
    assert.fail("Expected a secret submission effect.");
  }

  return { request, state: submitted, effect: submitted.pendingEffect };
}

function createSecretCancellation(value: string): SecretCancellation {
  const request = createSecretPromptRequest(
    createSecretPromptId("cv-key"),
    "CV access key",
  );
  const active = reduceShellState(
    createShellState({
      id: createShellId("terminal"),
      sessionId: createShellSessionId("session"),
      currentDirectory: virtualHomeDirectory(),
      scrollbackLimit: 3,
      commandHistory: [],
      commandHistoryLimit: 3,
    }),
    { kind: "secret.begin", request },
  );
  const typed = reduceShellState(active, { kind: "input.insert", text: value });
  const cancelled = reduceShellState(typed, { kind: "prompt.cancel" });

  if (cancelled.pendingEffect.kind !== "secret-cancelled") {
    assert.fail("Expected a secret cancellation effect.");
  }

  return { request, state: cancelled, effect: cancelled.pendingEffect };
}

function createDeferredSecretPromptSubmissionHandler(): DeferredSecretPromptSubmissionHandler {
  let resolveDeferred: (() => void) | undefined;
  let rejectDeferred: ((error: Error) => void) | undefined;
  const promise = new Promise<void>((resolve, reject) => {
    resolveDeferred = resolve;
    rejectDeferred = (error: Error) => reject(error);
  });

  return {
    submissionHandler: () => promise,
    resolve: () => {
      const resolve = resolveDeferred;

      if (resolve === undefined) {
        throw new Error("Expected a deferred handler resolver.");
      }

      resolve();
    },
    reject: (error) => {
      const reject = rejectDeferred;

      if (reject === undefined) {
        throw new Error("Expected a deferred handler rejecter.");
      }

      reject(error);
    },
  };
}

function clearSecretPromptEffect(
  state: SecretPromptEffectConsumptionState,
): SecretPromptEffectConsumptionState {
  const clearance = consumePendingSecretPromptEffect({
    state,
    effect: { kind: "none" },
    submissionHandler: undefined,
  });

  if (clearance.kind !== "not-secret") {
    assert.fail("Expected the consumed secret effect to clear.");
  }

  return clearance.state;
}

function assertSecretIsNotRetained(state: ShellState, secret: string): void {
  assert.deepEqual(state.pendingEffect, { kind: "none" });
  assert.deepEqual(state.history, []);
  assert.deepEqual(state.commandHistory, []);
  assert.deepEqual(state.completion, { kind: "idle" });
  assert.equal(JSON.stringify(state).includes(secret), false);
}

test("rejects plain numbers as secret prompt effect generations", () => {
  const state = createSecretPromptEffectConsumptionState();

  // @ts-expect-error: Diagnostic generations must come from the consumption adapter.
  shouldApplySecretPromptEffectDiagnostic(state, 1);
});

test("consumes one correlated secret submission without retaining it", async () => {
  const secret = "sensitive-value";
  const { effect, request, state } = createSecretSubmission(secret);
  const received: SecretPromptEffect[] = [];
  const consumption = consumePendingSecretPromptEffect({
    state: createSecretPromptEffectConsumptionState(),
    effect,
    submissionHandler: (submission) => {
      received.push(submission);
    },
  });

  if (consumption.kind !== "consumed") {
    assert.fail("Expected the secret effect to be consumed.");
  }

  const duplicate = consumePendingSecretPromptEffect({
    state: consumption.state,
    effect,
    submissionHandler: (submission) => {
      received.push(submission);
    },
  });
  const consumed = reduceShellState(state, consumption.action);

  assert.equal(duplicate.kind, "duplicate");
  assert.equal(await consumption.diagnostic, undefined);
  assert.deepEqual(received, [effect]);
  assert.deepEqual(consumption.action, {
    kind: "secret-prompt.effect.consumed",
    requestId: request.id,
  });
  assert.deepEqual(consumed.secretPrompt, { kind: "none" });
  assert.deepEqual(consumed.history, []);
  assert.deepEqual(consumed.commandHistory, []);
  assert.equal(JSON.stringify(consumption).includes(secret), false);
  assert.equal(JSON.stringify(consumed).includes(secret), false);
});

test("consumes secret cancellation without invoking a handler", async () => {
  const secret = "sensitive-value";
  const request = createSecretPromptRequest(
    createSecretPromptId("oauth-code"),
    "One-time code",
  );
  const active = reduceShellState(
    createShellState({
      id: createShellId("terminal"),
      sessionId: createShellSessionId("session"),
      currentDirectory: virtualHomeDirectory(),
      scrollbackLimit: 3,
      commandHistory: [],
      commandHistoryLimit: 3,
    }),
    { kind: "secret.begin", request },
  );
  const typed = reduceShellState(active, { kind: "input.insert", text: secret });
  const cancelled = reduceShellState(typed, { kind: "prompt.cancel" });

  if (cancelled.pendingEffect.kind !== "secret-cancelled") {
    assert.fail("Expected a secret cancellation effect.");
  }

  let calls = 0;
  const consumption = consumePendingSecretPromptEffect({
    state: createSecretPromptEffectConsumptionState(),
    effect: cancelled.pendingEffect,
    submissionHandler: () => {
      calls += 1;
    },
  });

  if (consumption.kind !== "consumed") {
    assert.fail("Expected the secret cancellation effect to be consumed.");
  }

  const consumed = reduceShellState(cancelled, consumption.action);

  assert.equal(await consumption.diagnostic, undefined);
  assert.equal(calls, 0);
  assert.deepEqual(consumed.pendingEffect, { kind: "none" });
  assert.deepEqual(consumed.history, []);
  assert.deepEqual(consumed.commandHistory, []);
  assert.equal(JSON.stringify(consumed).includes(secret), false);
});

test("reports a secret-free diagnostic when no submission handler is available", async () => {
  const secret = "sensitive-value";
  const { effect } = createSecretSubmission(secret);
  const consumption = consumePendingSecretPromptEffect({
    state: createSecretPromptEffectConsumptionState(),
    effect,
    submissionHandler: undefined,
  });

  if (consumption.kind !== "consumed") {
    assert.fail("Expected the secret effect to be consumed.");
  }

  const diagnostic = await consumption.diagnostic;

  assert.deepEqual(diagnostic, {
    kind: "secret-prompt-delivery-failed",
    message: "Secret prompt delivery failed.",
  });
  assert.equal(JSON.stringify(diagnostic).includes(secret), false);
  assert.equal(JSON.stringify(consumption.state).includes(secret), false);
});

test("reports a secret-free diagnostic when a submission handler fails", async () => {
  const secret = "sensitive-value";
  const { effect } = createSecretSubmission(secret);
  let attempts = 0;
  const consumption = consumePendingSecretPromptEffect({
    state: createSecretPromptEffectConsumptionState(),
    effect,
    submissionHandler: () => {
      attempts += 1;
      throw new Error(secret);
    },
  });

  if (consumption.kind !== "consumed") {
    assert.fail("Expected the secret effect to be consumed.");
  }

  const diagnostic = await consumption.diagnostic;

  assert.equal(attempts, 1);
  assert.deepEqual(diagnostic, {
    kind: "secret-prompt-delivery-failed",
    message: "Secret prompt delivery failed.",
  });
  assert.equal(JSON.stringify(diagnostic).includes(secret), false);
  assert.equal(JSON.stringify(consumption.state).includes(secret), false);
});

test("preserves the approved generic CV failure without retaining the submitted value", async () => {
  const submission = createSecretSubmission("synthetic-viewer-key");
  const result = consumePendingSecretPromptEffect({
    state: createSecretPromptEffectConsumptionState(),
    effect: submission.effect,
    submissionHandler: () => ({ kind: "failed", message: "CV access failed." }),
  });

  if (result.kind !== "consumed") {
    assert.fail("Expected the CV secret submission to be consumed.");
  }

  assert.deepEqual(await result.diagnostic, {
    kind: "secret-prompt-delivery-failed",
    message: "CV access failed.",
  });
  assert.equal(JSON.stringify(result).includes("synthetic-viewer-key"), false);
});

test("suppresses a stale failed secret delivery after a later success with the same request ID", async () => {
  const olderSecret = "older-sensitive-value";
  const newerSecret = "newer-sensitive-value";
  const olderSubmission = createSecretSubmission(olderSecret);
  const newerSubmission = createSecretSubmission(newerSecret);
  const olderHandler = createDeferredSecretPromptSubmissionHandler();
  const newerHandler = createDeferredSecretPromptSubmissionHandler();

  assert.equal(olderSubmission.request.id, newerSubmission.request.id);

  const olderConsumption = consumePendingSecretPromptEffect({
    state: createSecretPromptEffectConsumptionState(),
    effect: olderSubmission.effect,
    submissionHandler: olderHandler.submissionHandler,
  });

  if (olderConsumption.kind !== "consumed") {
    assert.fail("Expected the older secret effect to be consumed.");
  }

  const olderState = reduceShellState(
    olderSubmission.state,
    olderConsumption.action,
  );
  const afterOlderConsumption = clearSecretPromptEffect(olderConsumption.state);
  const newerConsumption = consumePendingSecretPromptEffect({
    state: afterOlderConsumption,
    effect: newerSubmission.effect,
    submissionHandler: newerHandler.submissionHandler,
  });

  if (newerConsumption.kind !== "consumed") {
    assert.fail("Expected the newer secret effect to be consumed.");
  }

  const newerState = reduceShellState(
    newerSubmission.state,
    newerConsumption.action,
  );
  const afterNewerConsumption = clearSecretPromptEffect(newerConsumption.state);
  let visibleDiagnostic: SecretPromptEffectConsumptionDiagnostic | undefined;

  newerHandler.resolve();
  const newerDiagnostic = await newerConsumption.diagnostic;

  if (
    shouldApplySecretPromptEffectDiagnostic(
      afterNewerConsumption,
      newerConsumption.generation,
    )
  ) {
    visibleDiagnostic = newerDiagnostic;
  }

  olderHandler.reject(new Error(olderSecret));
  const olderDiagnostic = await olderConsumption.diagnostic;

  assert.equal(newerDiagnostic, undefined);
  assert.deepEqual(olderDiagnostic, {
    kind: "secret-prompt-delivery-failed",
    message: "Secret prompt delivery failed.",
  });
  assert.equal(
    shouldApplySecretPromptEffectDiagnostic(
      afterNewerConsumption,
      olderConsumption.generation,
    ),
    false,
  );

  if (
    shouldApplySecretPromptEffectDiagnostic(
      afterNewerConsumption,
      olderConsumption.generation,
    )
  ) {
    visibleDiagnostic = olderDiagnostic;
  }

  assert.equal(visibleDiagnostic, undefined);
  assertSecretIsNotRetained(olderState, olderSecret);
  assertSecretIsNotRetained(newerState, newerSecret);
  assert.equal(
    JSON.stringify({ olderConsumption, newerConsumption, visibleDiagnostic }).includes(
      olderSecret,
    ),
    false,
  );
  assert.equal(
    JSON.stringify({ olderConsumption, newerConsumption, visibleDiagnostic }).includes(
      newerSecret,
    ),
    false,
  );
});

test("suppresses a stale failed secret delivery after a later cancellation with the same request ID", async () => {
  const olderSecret = "older-sensitive-value";
  const cancelledSecret = "cancelled-sensitive-value";
  const olderSubmission = createSecretSubmission(olderSecret);
  const laterCancellation = createSecretCancellation(cancelledSecret);
  const olderHandler = createDeferredSecretPromptSubmissionHandler();
  let cancellationHandlerCalls = 0;

  assert.equal(olderSubmission.request.id, laterCancellation.request.id);

  const olderConsumption = consumePendingSecretPromptEffect({
    state: createSecretPromptEffectConsumptionState(),
    effect: olderSubmission.effect,
    submissionHandler: olderHandler.submissionHandler,
  });

  if (olderConsumption.kind !== "consumed") {
    assert.fail("Expected the older secret effect to be consumed.");
  }

  const olderState = reduceShellState(
    olderSubmission.state,
    olderConsumption.action,
  );
  const afterOlderConsumption = clearSecretPromptEffect(olderConsumption.state);
  const cancellationConsumption = consumePendingSecretPromptEffect({
    state: afterOlderConsumption,
    effect: laterCancellation.effect,
    submissionHandler: () => {
      cancellationHandlerCalls += 1;
    },
  });

  if (cancellationConsumption.kind !== "consumed") {
    assert.fail("Expected the cancellation effect to be consumed.");
  }

  const cancellationState = reduceShellState(
    laterCancellation.state,
    cancellationConsumption.action,
  );
  const afterCancellation = clearSecretPromptEffect(cancellationConsumption.state);
  let visibleDiagnostic: SecretPromptEffectConsumptionDiagnostic | undefined;
  const cancellationDiagnostic = await cancellationConsumption.diagnostic;

  if (
    shouldApplySecretPromptEffectDiagnostic(
      afterCancellation,
      cancellationConsumption.generation,
    )
  ) {
    visibleDiagnostic = cancellationDiagnostic;
  }

  olderHandler.reject(new Error(olderSecret));
  const olderDiagnostic = await olderConsumption.diagnostic;

  assert.equal(cancellationHandlerCalls, 0);
  assert.equal(cancellationDiagnostic, undefined);
  assert.deepEqual(olderDiagnostic, {
    kind: "secret-prompt-delivery-failed",
    message: "Secret prompt delivery failed.",
  });
  assert.equal(
    shouldApplySecretPromptEffectDiagnostic(
      afterCancellation,
      olderConsumption.generation,
    ),
    false,
  );

  if (
    shouldApplySecretPromptEffectDiagnostic(
      afterCancellation,
      olderConsumption.generation,
    )
  ) {
    visibleDiagnostic = olderDiagnostic;
  }

  assert.equal(visibleDiagnostic, undefined);
  assertSecretIsNotRetained(olderState, olderSecret);
  assertSecretIsNotRetained(cancellationState, cancelledSecret);
  assert.equal(
    JSON.stringify({
      olderConsumption,
      cancellationConsumption,
      visibleDiagnostic,
    }).includes(olderSecret),
    false,
  );
  assert.equal(
    JSON.stringify({
      olderConsumption,
      cancellationConsumption,
      visibleDiagnostic,
    }).includes(cancelledSecret),
    false,
  );
});
