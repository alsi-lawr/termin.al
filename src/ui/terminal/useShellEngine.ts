import { useEffect, useReducer, useRef } from "react";
import {
  reduceShellState,
  type CommandId,
  type ShellState,
} from "../../domain/terminal/Shell.ts";
import {
  executeCommandLine,
} from "../../application/commands/CommandExecution.ts";
import type { CommandRegistry } from "../../application/commands/CommandRegistry.ts";

export type UseShellEngineOptions = Readonly<{
  initialState: ShellState;
  registry: CommandRegistry;
}>;

export type ShellEngine = Readonly<{
  state: ShellState;
  insertText: (text: string) => void;
  moveCursorLeft: () => void;
  moveCursorRight: () => void;
  backspace: () => void;
  deleteAtCursor: () => void;
  submit: () => void;
  cancel: () => void;
}>;

function discardedCommandOutcome(commandName: string) {
  return {
    kind: "failed" as const,
    failure: { kind: "execution-error" as const, commandName },
    diagnostics: [
      {
        kind: "runtime" as const,
        code: "runtime.execution-failed" as const,
        message: "The command could not complete.",
      },
    ],
  };
}

export function useShellEngine({
  initialState,
  registry,
}: UseShellEngineOptions): ShellEngine {
  const [state, dispatch] = useReducer(reduceShellState, initialState);
  const controllers = useRef<Map<CommandId, AbortController>>(new Map());
  const mounted = useRef(false);

  useEffect(() => {
    const activeControllers = controllers.current;
    mounted.current = true;

    return () => {
      mounted.current = false;

      for (const controller of activeControllers.values()) {
        controller.abort();
      }

      activeControllers.clear();
    };
  }, []);

  useEffect(() => {
    const effect = state.pendingEffect;

    if (effect.kind === "none") {
      return;
    }

    if (effect.kind === "cancel-command") {
      dispatch({ kind: "effect.consumed", commandId: effect.commandId });
      controllers.current.get(effect.commandId)?.abort();
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
  }, [registry, state.pendingEffect]);

  return {
    state,
    insertText: (text) => dispatch({ kind: "input.insert", text }),
    moveCursorLeft: () => dispatch({ kind: "input.move-left" }),
    moveCursorRight: () => dispatch({ kind: "input.move-right" }),
    backspace: () => dispatch({ kind: "input.backspace" }),
    deleteAtCursor: () => dispatch({ kind: "input.delete" }),
    submit: () => dispatch({ kind: "command.submit" }),
    cancel: () => dispatch({ kind: "command.cancel" }),
  };
}
