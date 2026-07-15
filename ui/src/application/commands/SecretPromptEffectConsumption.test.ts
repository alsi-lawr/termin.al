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
import {
  consumePendingSecretPromptEffect,
  createSecretPromptEffectConsumptionState,
} from "./SecretPromptEffectConsumption.ts";

type SecretSubmission = Readonly<{
  request: SecretPromptRequest;
  state: ShellState;
  effect: Extract<SecretPromptEffect, { kind: "secret-submitted" }>;
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
      scrollbackLimit: 3,
      commandHistoryLimit: 3,
    }),
    { kind: "secret.begin", request },
  );
  const typed = reduceShellState(active, { kind: "input.insert", text: value });
  const submitted = reduceShellState(typed, { kind: "prompt.submit" });

  if (submitted.pendingEffect.kind !== "secret-submitted") {
    assert.fail("Expected a secret submission effect.");
  }

  return { request, state: submitted, effect: submitted.pendingEffect };
}

test("consumes one correlated secret submission without retaining it", async () => {
  const secret = "sensitive-value";
  const { effect, request, state } = createSecretSubmission(secret);
  const received: SecretPromptEffect[] = [];
  const consumption = consumePendingSecretPromptEffect({
    state: createSecretPromptEffectConsumptionState(),
    effect,
    handler: (outcome) => {
      received.push(outcome);
    },
  });

  if (consumption.kind !== "consumed") {
    assert.fail("Expected the secret effect to be consumed.");
  }

  const duplicate = consumePendingSecretPromptEffect({
    state: consumption.state,
    effect,
    handler: (outcome) => {
      received.push(outcome);
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
      scrollbackLimit: 3,
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
    handler: () => {
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
    handler: undefined,
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
    handler: () => {
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
