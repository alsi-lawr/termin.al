import { useEffect, useRef, useState } from "react";
import {
  createCompletionRequest,
} from "../../domain/terminal/Completion.ts";
import {
  getActiveShellPrompt,
  createShellDiagnosticId,
  type CommandId,
  type CommandEffect,
  type CommandOutcome,
  type ShellAction,
  type ShellState,
} from "../../domain/terminal/Shell.ts";
import type { NormalPromptKey } from "../../domain/terminal/PromptEditor.ts";
import {
  executeCommandLine,
} from "../../application/commands/CommandExecution.ts";
import type { CommandRegistry } from "../../application/commands/CommandRegistry.ts";
import type { CompletionService } from "../../application/commands/Completion.ts";
import {
  consumePendingSecretPromptEffect,
  createSecretPromptEffectConsumptionState,
  shouldApplySecretPromptEffectDiagnostic,
  type SecretPromptEffectConsumptionDiagnostic,
  type SecretPromptEffectConsumptionState,
} from "../../application/commands/SecretPromptEffectConsumption.ts";
import type { SecretPromptOutcomeHandler } from "../../application/commands/SecretPromptDelivery.ts";

export type ShellEngineDiagnostic = SecretPromptEffectConsumptionDiagnostic;

export type ShellCommandEffectsHandler = (
  effects: ReadonlyArray<CommandEffect>,
) => void;

export type UseShellEngineOptions = Readonly<{
  state: ShellState;
  onAction: (action: ShellAction) => void;
  isSessionOpen: () => boolean;
  registry: CommandRegistry;
  completionService: CompletionService;
  secretPromptOutcomeHandler?: SecretPromptOutcomeHandler;
  onCommandEffects?: ShellCommandEffectsHandler;
}>;

export type ShellEngine = Readonly<{
  state: ShellState;
  transientDiagnostic: ShellEngineDiagnostic | undefined;
  insertText: (text: string) => void;
  replaceInputValue: (value: string, cursor: number) => void;
  moveCursor: (cursor: number) => void;
  normalKey: (key: NormalPromptKey) => void;
  submit: () => void;
  cancel: () => void;
  complete: () => void;
}>;

function discardedCommandOutcome(commandName: string): CommandOutcome {
  return {
    kind: "failed",
    failure: { kind: "execution-error", commandName },
    diagnostics: [
      {
        kind: "runtime",
        id: createShellDiagnosticId("discarded-command"),
        code: "runtime.execution-failed",
        message: "The command could not complete.",
      },
    ],
  };
}

export function useShellEngine({
  state,
  onAction,
  isSessionOpen,
  registry,
  completionService,
  secretPromptOutcomeHandler,
  onCommandEffects,
}: UseShellEngineOptions): ShellEngine {
  const [transientDiagnostic, setTransientDiagnostic] = useState<
    ShellEngineDiagnostic | undefined
  >(undefined);
  const controllers = useRef<Map<CommandId, AbortController>>(new Map());
  const completionControllers = useRef<Set<AbortController>>(new Set());
  const secretPromptEffectConsumption = useRef<SecretPromptEffectConsumptionState>(
    createSecretPromptEffectConsumptionState(),
  );
  const mounted = useRef(false);

  useEffect(() => {
    const activeControllers = controllers.current;
    const activeCompletionControllers = completionControllers.current;
    mounted.current = true;

    return () => {
      mounted.current = false;

      if (isSessionOpen()) {
        return;
      }

      for (const controller of activeControllers.values()) {
        controller.abort();
      }

      for (const controller of activeCompletionControllers) {
        controller.abort();
      }

      activeControllers.clear();
      activeCompletionControllers.clear();
    };
  }, [isSessionOpen]);

  useEffect(() => {
    const secretPromptConsumption = consumePendingSecretPromptEffect({
      state: secretPromptEffectConsumption.current,
      effect: state.pendingEffect,
      handler: secretPromptOutcomeHandler,
    });
    secretPromptEffectConsumption.current = secretPromptConsumption.state;

    if (secretPromptConsumption.kind === "duplicate") {
      return;
    }

    if (secretPromptConsumption.kind === "consumed") {
      onAction(secretPromptConsumption.action);

      const updateSecretPromptDiagnostic = async (): Promise<void> => {
        const diagnostic = await secretPromptConsumption.diagnostic;

        if (
          mounted.current &&
          isSessionOpen() &&
          shouldApplySecretPromptEffectDiagnostic(
            secretPromptEffectConsumption.current,
            secretPromptConsumption.generation,
          )
        ) {
          setTransientDiagnostic(diagnostic);
        }
      };

      void updateSecretPromptDiagnostic();
      return;
    }

    const effect = secretPromptConsumption.effect;

    if (effect.kind === "none") {
      return;
    }

    if (effect.kind === "cancel-command") {
      onAction({ kind: "effect.consumed", commandId: effect.commandId });
      controllers.current.get(effect.commandId)?.abort();
      return;
    }

    if (controllers.current.has(effect.command.id)) {
      return;
    }

    const controller = new AbortController();
    controllers.current.set(effect.command.id, controller);
    onAction({ kind: "effect.consumed", commandId: effect.command.id });

    const runCommand = async (): Promise<void> => {
      try {
        const outcome = await executeCommandLine({
          registry,
          request: effect.command,
          signal: controller.signal,
        });

        controllers.current.delete(effect.command.id);

        if (isSessionOpen()) {
          if (outcome.kind === "succeeded") {
            onCommandEffects?.(outcome.effects);
          }

          onAction({
            kind: "command.settled",
            commandId: effect.command.id,
            outcome,
          });
        }
      } catch {
        controllers.current.delete(effect.command.id);

        if (isSessionOpen()) {
          onAction({
            kind: "command.settled",
            commandId: effect.command.id,
            outcome: discardedCommandOutcome(effect.command.source),
          });
        }
      }
    };

    void runCommand();
  }, [
    onCommandEffects,
    onAction,
    isSessionOpen,
    registry,
    secretPromptOutcomeHandler,
    state.pendingEffect,
  ]);

  const complete = (): void => {
    const prompt = getActiveShellPrompt(state);

    if (prompt.kind !== "command" || prompt.editor.buffer.mode.kind !== "insert") {
      return;
    }

    for (const controller of completionControllers.current) {
      controller.abort();
    }

    completionControllers.current.clear();

    const request = createCompletionRequest(
      state.id,
      state.sessionId,
      prompt.editor.buffer.value,
      prompt.editor.buffer.cursor,
    );
    const controller = new AbortController();
    completionControllers.current.add(controller);
    onAction({ kind: "completion.request", request });

    const resolveCompletion = async (): Promise<void> => {
      try {
        const result = await completionService.complete(request, controller.signal);
        completionControllers.current.delete(controller);

        if (isSessionOpen()) {
          onAction({ kind: "completion.resolved", request, result });
        }
      } catch {
        completionControllers.current.delete(controller);

        if (isSessionOpen()) {
          onAction({ kind: "completion.failed", request });
        }
      }
    };

    void resolveCompletion();
  };

  return {
    state,
    transientDiagnostic,
    insertText: (text) => onAction({ kind: "input.insert", text }),
    replaceInputValue: (value, cursor) =>
      onAction({ kind: "input.replace", value, cursor }),
    moveCursor: (cursor) => onAction({ kind: "input.move-cursor", cursor }),
    normalKey: (key) => onAction({ kind: "prompt.normal-key", key }),
    submit: () => onAction({ kind: "prompt.submit" }),
    cancel: () => onAction({ kind: "prompt.cancel" }),
    complete,
  };
}
