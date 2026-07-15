import type {
  SecretPromptEffect,
  SecretPromptId,
  ShellEffect,
} from "../../domain/terminal/Shell.ts";
import {
  deliverSecretPromptEffect,
  type SecretPromptOutcomeHandler,
} from "./SecretPromptDelivery.ts";

export type SecretPromptEffectConsumptionState =
  | Readonly<{ kind: "idle" }>
  | Readonly<{
      kind: "handled";
      requestId: SecretPromptId;
    }>;

export type SecretPromptEffectConsumptionDiagnostic = Readonly<{
  kind: "secret-prompt-delivery-failed";
  message: "Secret prompt delivery failed.";
}>;

export type SecretPromptEffectConsumedAction = Readonly<{
  kind: "secret-prompt.effect.consumed";
  requestId: SecretPromptId;
}>;

export type NonSecretShellEffect = Exclude<ShellEffect, SecretPromptEffect>;

export type SecretPromptEffectConsumption =
  | Readonly<{
      kind: "not-secret";
      state: SecretPromptEffectConsumptionState;
      effect: NonSecretShellEffect;
    }>
  | Readonly<{
      kind: "duplicate";
      state: SecretPromptEffectConsumptionState;
    }>
  | Readonly<{
      kind: "consumed";
      state: SecretPromptEffectConsumptionState;
      action: SecretPromptEffectConsumedAction;
      diagnostic: Promise<SecretPromptEffectConsumptionDiagnostic | undefined>;
    }>;

export type ConsumePendingSecretPromptEffectOptions = Readonly<{
  state: SecretPromptEffectConsumptionState;
  effect: ShellEffect;
  handler: SecretPromptOutcomeHandler | undefined;
}>;

const secretPromptDeliveryFailureDiagnostic = {
  kind: "secret-prompt-delivery-failed",
  message: "Secret prompt delivery failed.",
} as const satisfies SecretPromptEffectConsumptionDiagnostic;

function deliveryDiagnostic(
  effect: SecretPromptEffect,
  handler: SecretPromptOutcomeHandler | undefined,
): Promise<SecretPromptEffectConsumptionDiagnostic | undefined> {
  if (effect.kind === "secret-cancelled") {
    return Promise.resolve(undefined);
  }

  return Promise.resolve()
    .then(() => deliverSecretPromptEffect({ effect, handler }))
    .then((result) =>
      result.kind === "delivered"
        ? undefined
        : secretPromptDeliveryFailureDiagnostic,
    )
    .catch(() => secretPromptDeliveryFailureDiagnostic);
}

export function createSecretPromptEffectConsumptionState(): SecretPromptEffectConsumptionState {
  return { kind: "idle" };
}

export function consumePendingSecretPromptEffect({
  state,
  effect,
  handler,
}: ConsumePendingSecretPromptEffectOptions): SecretPromptEffectConsumption {
  if (effect.kind === "none") {
    return {
      kind: "not-secret",
      state: createSecretPromptEffectConsumptionState(),
      effect,
    };
  }

  if (effect.kind === "execute-command" || effect.kind === "cancel-command") {
    return { kind: "not-secret", state, effect };
  }

  if (state.kind === "handled" && state.requestId === effect.requestId) {
    return { kind: "duplicate", state };
  }

  return {
    kind: "consumed",
    state: { kind: "handled", requestId: effect.requestId },
    action: {
      kind: "secret-prompt.effect.consumed",
      requestId: effect.requestId,
    },
    diagnostic: deliveryDiagnostic(effect, handler),
  };
}
