import type { SecretPromptEffect } from "../../domain/terminal/Shell.ts";

export type SecretPromptOutcomeHandler = (
  effect: SecretPromptEffect,
) => void | Promise<void>;

export type SecretPromptDeliveryResult =
  | Readonly<{ kind: "delivered" }>
  | Readonly<{ kind: "failed" }>;

export type DeliverSecretPromptEffectOptions = Readonly<{
  effect: SecretPromptEffect;
  handler: SecretPromptOutcomeHandler | undefined;
}>;

export async function deliverSecretPromptEffect({
  effect,
  handler,
}: DeliverSecretPromptEffectOptions): Promise<SecretPromptDeliveryResult> {
  if (handler === undefined) {
    return { kind: "failed" };
  }

  try {
    await handler(effect);
    return { kind: "delivered" };
  } catch {
    return { kind: "failed" };
  }
}
