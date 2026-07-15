import { useEffect, useRef, useState } from "react";
import {
  createCompletionRequest,
} from "../../domain/terminal/Completion.ts";
import {
  getActiveShellPrompt,
  createShellDiagnosticId,
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
import type { PaneShellRuntimeControl } from "../workspace/PaneShellRuntimes.ts";

export type ShellEngineDiagnostic = SecretPromptEffectConsumptionDiagnostic;

export type UseShellEngineOptions = Readonly<{
  state: ShellState;
  onAction: (action: ShellAction) => void;
  isSessionOpen: () => boolean;
  runtimeControl: PaneShellRuntimeControl;
  registry: CommandRegistry;
  completionService: CompletionService;
  secretPromptOutcomeHandler?: SecretPromptOutcomeHandler;
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
  runtimeControl,
  registry,
  completionService,
  secretPromptOutcomeHandler,
}: UseShellEngineOptions): ShellEngine {
  const [transientDiagnostic, setTransientDiagnostic] = useState<
    ShellEngineDiagnostic | undefined
  >(undefined);
  const secretPromptEffectConsumption = useRef<SecretPromptEffectConsumptionState>(
    createSecretPromptEffectConsumptionState(),
  );
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

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
      runtimeControl.abortCommand(effect.commandId);
      return;
    }

    const controller = runtimeControl.startCommand(effect.command.id);

    if (controller === undefined) {
      return;
    }

    onAction({ kind: "effect.consumed", commandId: effect.command.id });

    const runCommand = async (): Promise<void> => {
      try {
        const outcome = await executeCommandLine({
          registry,
          request: effect.command,
          signal: controller.signal,
        });

        if (
          runtimeControl.finishCommand(
            effect.command.id,
            controller,
            outcome,
          ) && isSessionOpen()
        ) {
          onAction({
            kind: "command.settled",
            commandId: effect.command.id,
            outcome,
          });
        }
      } catch {
        const outcome = discardedCommandOutcome(effect.command.source);

        if (
          runtimeControl.finishCommand(
            effect.command.id,
            controller,
            outcome,
          ) && isSessionOpen()
        ) {
          onAction({
            kind: "command.settled",
            commandId: effect.command.id,
            outcome,
          });
        }
      }
    };

    void runCommand();
  }, [
    onAction,
    isSessionOpen,
    registry,
    runtimeControl,
    secretPromptOutcomeHandler,
    state.pendingEffect,
  ]);

  const complete = (): void => {
    const prompt = getActiveShellPrompt(state);

    if (prompt.kind !== "command" || prompt.editor.buffer.mode.kind !== "insert") {
      return;
    }

    const request = createCompletionRequest(
      state.id,
      state.sessionId,
      prompt.editor.buffer.value,
      prompt.editor.buffer.cursor,
    );
    const controller = runtimeControl.startCompletion();

    if (controller === undefined) {
      return;
    }

    onAction({ kind: "completion.request", request });

    const resolveCompletion = async (): Promise<void> => {
      try {
        const result = await completionService.complete(request, controller.signal);

        if (runtimeControl.finishCompletion(controller) && isSessionOpen()) {
          onAction({ kind: "completion.resolved", request, result });
        }
      } catch {
        if (runtimeControl.finishCompletion(controller) && isSessionOpen()) {
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
