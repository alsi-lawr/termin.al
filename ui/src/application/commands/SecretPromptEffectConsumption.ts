declare const secretPromptEffectGenerationBrand: unique symbol;

import type {
  SecretPromptEffect,
  SecretPromptId,
  ShellEffect,
} from "../../domain/terminal/Shell.ts";
import {
  deliverSecretPromptEffect,
  type SecretPromptOutcomeHandler,
} from "./SecretPromptDelivery.ts";

export type SecretPromptEffectGeneration = number & {
  readonly [secretPromptEffectGenerationBrand]: "SecretPromptEffectGeneration";
};

export type SecretPromptEffectConsumptionState =
  | Readonly<{
      kind: "idle";
      latestGeneration: SecretPromptEffectGeneration;
    }>
  | Readonly<{
      kind: "handled";
      requestId: SecretPromptId;
      latestGeneration: SecretPromptEffectGeneration;
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
      generation: SecretPromptEffectGeneration;
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

const initialSecretPromptEffectGeneration =
  0 as SecretPromptEffectGeneration;

function incrementSecretPromptEffectGeneration(
  generation: SecretPromptEffectGeneration,
): SecretPromptEffectGeneration {
  return (generation + 1) as SecretPromptEffectGeneration;
}

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
  return { kind: "idle", latestGeneration: initialSecretPromptEffectGeneration };
}

export function shouldApplySecretPromptEffectDiagnostic(
  state: SecretPromptEffectConsumptionState,
  generation: SecretPromptEffectGeneration,
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

  const generation = incrementSecretPromptEffectGeneration(state.latestGeneration);

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
