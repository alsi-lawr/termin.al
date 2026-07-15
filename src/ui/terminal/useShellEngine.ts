import { useEffect, useReducer, useRef, useState } from "react";
import {
  createCompletionRequest,
} from "../../domain/terminal/Completion.ts";
import {
  getActiveShellPrompt,
  createShellDiagnosticId,
  reduceShellState,
  type CommandId,
  type CommandOutcome,
  type SecretPromptId,
  type ShellState,
} from "../../domain/terminal/Shell.ts";
import type { NormalPromptKey } from "../../domain/terminal/PromptEditor.ts";
import {
  executeCommandLine,
} from "../../application/commands/CommandExecution.ts";
import type { CommandRegistry } from "../../application/commands/CommandRegistry.ts";
import type { CompletionService } from "../../application/commands/Completion.ts";
import {
  deliverSecretPromptEffect,
  type SecretPromptOutcomeHandler,
} from "../../application/commands/SecretPromptDelivery.ts";

export type ShellEngineDiagnostic = Readonly<{
  kind: "secret-prompt-delivery-failed";
  message: "Secret prompt delivery failed.";
}>;

export type UseShellEngineOptions = Readonly<{
  initialState: ShellState;
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

const secretPromptDeliveryFailureDiagnostic = {
  kind: "secret-prompt-delivery-failed",
  message: "Secret prompt delivery failed.",
} as const satisfies ShellEngineDiagnostic;

export function useShellEngine({
  initialState,
  registry,
  completionService,
  secretPromptOutcomeHandler,
}: UseShellEngineOptions): ShellEngine {
  const [state, dispatch] = useReducer(reduceShellState, initialState);
  const [transientDiagnostic, setTransientDiagnostic] = useState<
    ShellEngineDiagnostic | undefined
  >(undefined);
  const controllers = useRef<Map<CommandId, AbortController>>(new Map());
  const completionControllers = useRef<Set<AbortController>>(new Set());
  const handledSecretPromptRequestId = useRef<SecretPromptId | undefined>(
    undefined,
  );
  const mounted = useRef(false);

  useEffect(() => {
    const activeControllers = controllers.current;
    const activeCompletionControllers = completionControllers.current;
    mounted.current = true;

    return () => {
      mounted.current = false;

      for (const controller of activeControllers.values()) {
        controller.abort();
      }

      for (const controller of activeCompletionControllers) {
        controller.abort();
      }

      activeControllers.clear();
      activeCompletionControllers.clear();
    };
  }, []);

  useEffect(() => {
    const effect = state.pendingEffect;

    if (effect.kind === "none") {
      handledSecretPromptRequestId.current = undefined;
      return;
    }

    if (effect.kind === "cancel-command") {
      dispatch({ kind: "effect.consumed", commandId: effect.commandId });
      controllers.current.get(effect.commandId)?.abort();
      return;
    }

    if (
      effect.kind === "secret-submitted" ||
      effect.kind === "secret-cancelled"
    ) {
      if (handledSecretPromptRequestId.current === effect.requestId) {
        return;
      }

      handledSecretPromptRequestId.current = effect.requestId;
      dispatch({
        kind: "secret-prompt.effect.consumed",
        requestId: effect.requestId,
      });

      const deliverSecretPromptOutcome = async (): Promise<void> => {
        const result = await deliverSecretPromptEffect({
          effect,
          handler: secretPromptOutcomeHandler,
        });

        if (!mounted.current) {
          return;
        }

        if (result.kind === "delivered") {
          setTransientDiagnostic(undefined);
          return;
        }

        setTransientDiagnostic(secretPromptDeliveryFailureDiagnostic);
      };

      void deliverSecretPromptOutcome();
      return;
    }

    if (controllers.current.has(effect.command.id)) {
      return;
    }

    const controller = new AbortController();
    controllers.current.set(effect.command.id, controller);
    dispatch({ kind: "effect.consumed", commandId: effect.command.id });

    const runCommand = async (): Promise<void> => {
      try {
        const outcome = await executeCommandLine({
          registry,
          request: effect.command,
          signal: controller.signal,
        });

        controllers.current.delete(effect.command.id);

        if (mounted.current) {
          dispatch({
            kind: "command.settled",
            commandId: effect.command.id,
            outcome,
          });
        }
      } catch {
        controllers.current.delete(effect.command.id);

        if (mounted.current) {
          dispatch({
            kind: "command.settled",
            commandId: effect.command.id,
            outcome: discardedCommandOutcome(effect.command.source),
          });
        }
      }
    };

    void runCommand();
  }, [registry, secretPromptOutcomeHandler, state.pendingEffect]);

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
    dispatch({ kind: "completion.request", request });

    const resolveCompletion = async (): Promise<void> => {
      try {
        const result = await completionService.complete(request, controller.signal);
        completionControllers.current.delete(controller);

        if (mounted.current) {
          dispatch({ kind: "completion.resolved", request, result });
        }
      } catch {
        completionControllers.current.delete(controller);

        if (mounted.current) {
          dispatch({ kind: "completion.failed", request });
        }
      }
    };

    void resolveCompletion();
  };

  return {
    state,
    transientDiagnostic,
    insertText: (text) => dispatch({ kind: "input.insert", text }),
    replaceInputValue: (value, cursor) =>
      dispatch({ kind: "input.replace", value, cursor }),
    moveCursor: (cursor) => dispatch({ kind: "input.move-cursor", cursor }),
    normalKey: (key) => dispatch({ kind: "prompt.normal-key", key }),
    submit: () => dispatch({ kind: "prompt.submit" }),
    cancel: () => dispatch({ kind: "prompt.cancel" }),
    complete,
  };
}
