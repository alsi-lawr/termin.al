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
} from "../../domain/terminal/Shell.ts";
import { deliverSecretPromptEffect } from "./SecretPromptDelivery.ts";

test("delivers a correlated secret submission once without retaining it in shell history", async () => {
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
  const typed = reduceShellState(active, {
    kind: "input.insert",
    text: "sensitive-value",
  });
  const submitted = reduceShellState(typed, { kind: "prompt.submit" });

  if (submitted.pendingEffect.kind !== "secret-submitted") {
    assert.fail("Expected a secret submission effect.");
  }

  const received: SecretPromptEffect[] = [];
  const result = await deliverSecretPromptEffect({
    effect: submitted.pendingEffect,
    handler: (effect) => {
      received.push(effect);
    },
  });
  const consumed = reduceShellState(submitted, {
    kind: "secret-prompt.effect.consumed",
    requestId: request.id,
  });

  assert.deepEqual(result, { kind: "delivered" });
  assert.deepEqual(received, [
    {
      kind: "secret-submitted",
      requestId: request.id,
      value: "sensitive-value",
    },
  ]);
  assert.deepEqual(consumed.secretPrompt, { kind: "none" });
  assert.deepEqual(consumed.history, []);
  assert.deepEqual(consumed.commandHistory, []);
  assert.equal(JSON.stringify(consumed).includes("sensitive-value"), false);
});

test("delivers a correlated secret cancellation once", async () => {
  const effect: SecretPromptEffect = {
    kind: "secret-cancelled",
    requestId: createSecretPromptId("oauth-code"),
  };
  const received: SecretPromptEffect[] = [];

  const result = await deliverSecretPromptEffect({
    effect,
    handler: (outcome) => {
      received.push(outcome);
    },
  });

  assert.deepEqual(result, { kind: "delivered" });
  assert.deepEqual(received, [effect]);
});

test("does not retry an unavailable or failing secret delivery handler", async () => {
  const effect: SecretPromptEffect = {
    kind: "secret-cancelled",
    requestId: createSecretPromptId("oauth-code"),
  };
  let attempts = 0;

  const unavailable = await deliverSecretPromptEffect({
    effect,
    handler: undefined,
  });
  const failed = await deliverSecretPromptEffect({
    effect,
    handler: () => {
      attempts += 1;
      throw new Error("sensitive-value");
    },
  });

  assert.deepEqual(unavailable, { kind: "failed" });
  assert.deepEqual(failed, { kind: "failed" });
  assert.equal(attempts, 1);
  assert.equal(JSON.stringify(failed).includes("sensitive-value"), false);
});
