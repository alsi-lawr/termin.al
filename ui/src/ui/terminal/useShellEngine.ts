import { useEffect, useRef, useState } from "react";
import {
  createCompletionRequest,
} from "../../domain/terminal/Completion.ts";
import {
  getActiveShellPrompt,
  createShellDiagnosticId,
  createShellOutputId,
  type CommandLineOutcome,
  type CompletionCycleDirection,
  type ShellAction,
  type ShellState,
} from "../../domain/terminal/Shell.ts";
import {
  commandHistoryPersistenceForSource,
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
  type SecretPromptSubmissionHandler,
} from "../../application/commands/SecretPromptEffectConsumption.ts";
import type { PaneShellRuntimeControl } from "../workspace/PaneShellRuntimes.ts";

export type ShellEngineDiagnostic = SecretPromptEffectConsumptionDiagnostic;

export type UseShellEngineOptions = Readonly<{
  state: ShellState;
  onAction: (action: ShellAction) => void;
  isSessionOpen: () => boolean;
  runtimeControl: PaneShellRuntimeControl;
  registry: CommandRegistry;
  completionService: CompletionService;
  secretPromptSubmissionHandler?: SecretPromptSubmissionHandler;
}>;

export type ShellEngine = Readonly<{
  state: ShellState;
  transientDiagnostic: ShellEngineDiagnostic | undefined;
  insertText: (text: string) => void;
  replaceInputValue: (value: string, cursor: number) => void;
  moveCursor: (cursor: number) => void;
  moveLeft: () => void;
  moveRight: () => void;
  moveStart: () => void;
  moveEnd: () => void;
  movePreviousWord: () => void;
  moveNextWord: () => void;
  backspace: () => void;
  delete: () => void;
  deletePreviousWord: () => void;
  browseOlderHistory: () => void;
  browseNewerHistory: () => void;
  dismissCompletion: () => void;
  submit: () => void;
  cancel: () => void;
  complete: (direction: CompletionCycleDirection) => void;
}>;

function discardedCommandOutcome(commandName: string): CommandLineOutcome {
  return {
    kind: "failed",
    failure: {
      kind: "execution-error",
      commandName,
      cause: new Error("Command execution failed."),
    },
    events: [
      {
        kind: "output",
        output: {
          kind: "diagnostic",
          id: createShellOutputId("discarded-command-output"),
          diagnostic: {
            kind: "runtime",
            id: createShellDiagnosticId("discarded-command"),
            code: "runtime.execution-failed",
            message: "The command could not complete.",
          },
        },
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
  secretPromptSubmissionHandler,
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
      submissionHandler: secretPromptSubmissionHandler,
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
    secretPromptSubmissionHandler,
    state.pendingEffect,
  ]);

  const complete = (direction: CompletionCycleDirection): void => {
    if (state.completion.kind === "suggestions") {
      onAction({ kind: "completion.cycle", direction });
      return;
    }

    const prompt = getActiveShellPrompt(state);

    if (prompt.kind !== "command") {
      return;
    }

    const request = createCompletionRequest(
      state.id,
      state.sessionId,
      prompt.line.text,
      prompt.line.cursor,
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

  const submit = (): void => {
    const prompt = getActiveShellPrompt(state);

    if (prompt.kind === "secret") {
      onAction({ kind: "prompt.submit", submission: { kind: "secret" } });
      return;
    }

    onAction({
      kind: "prompt.submit",
      submission: {
        kind: "command",
        persistence: commandHistoryPersistenceForSource(
          registry,
          prompt.line.text,
        ),
      },
    });
  };

  return {
    state,
    transientDiagnostic,
    insertText: (text) => onAction({ kind: "input.insert", text }),
    replaceInputValue: (value, cursor) =>
      onAction({ kind: "input.replace", value, cursor }),
    moveCursor: (cursor) => onAction({ kind: "input.move-cursor", cursor }),
    moveLeft: () => onAction({ kind: "input.move-left" }),
    moveRight: () => onAction({ kind: "input.move-right" }),
    moveStart: () => onAction({ kind: "input.move-start" }),
    moveEnd: () => onAction({ kind: "input.move-end" }),
    movePreviousWord: () => onAction({ kind: "input.move-previous-word" }),
    moveNextWord: () => onAction({ kind: "input.move-next-word" }),
    backspace: () => onAction({ kind: "input.backspace" }),
    delete: () => onAction({ kind: "input.delete" }),
    deletePreviousWord: () =>
      onAction({ kind: "input.delete-previous-word" }),
    browseOlderHistory: () => onAction({ kind: "history.older" }),
    browseNewerHistory: () => onAction({ kind: "history.newer" }),
    dismissCompletion: () => onAction({ kind: "completion.dismiss" }),
    submit,
    cancel: () => onAction({ kind: "prompt.cancel" }),
    complete,
  };
}
