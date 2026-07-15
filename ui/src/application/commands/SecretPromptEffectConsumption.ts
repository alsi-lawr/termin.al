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
  | Readonly<{
      kind: "idle";
      latestGeneration: number;
    }>
  | Readonly<{
      kind: "handled";
      requestId: SecretPromptId;
      latestGeneration: number;
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
      generation: number;
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
  return { kind: "idle", latestGeneration: 0 };
}

export function shouldApplySecretPromptEffectDiagnostic(
  state: SecretPromptEffectConsumptionState,
  generation: number,
): boolean {
  return state.latestGeneration === generation;
}

export function consumePendingSecretPromptEffect({
  state,
  effect,
  handler,
}: ConsumePendingSecretPromptEffectOptions): SecretPromptEffectConsumption {
  if (effect.kind === "none") {
    return {
      kind: "not-secret",
      state:
        state.kind === "handled"
          ? { kind: "idle", latestGeneration: state.latestGeneration }
          : state,
      effect,
    };
  }

  if (effect.kind === "execute-command" || effect.kind === "cancel-command") {
    return { kind: "not-secret", state, effect };
  }

  if (state.kind === "handled" && state.requestId === effect.requestId) {
    return { kind: "duplicate", state };
  }

  const generation = state.latestGeneration + 1;

  return {
    kind: "consumed",
    state: {
      kind: "handled",
      requestId: effect.requestId,
      latestGeneration: generation,
    },
    action: {
      kind: "secret-prompt.effect.consumed",
      requestId: effect.requestId,
    },
    generation,
    diagnostic: deliveryDiagnostic(effect, handler),
  };
}
