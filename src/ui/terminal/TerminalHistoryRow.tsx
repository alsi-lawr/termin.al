import type { ReactElement } from "react";
import {
  CommandExecutionState,
  type CommandExecutionState as CommandExecutionStateValue,
} from "../../application/commands/CommandExecution";
import type { TerminalHistoryEntry } from "./TerminalHistory";

const stateClassMap = {
  [CommandExecutionState.Cancelled]: "text-neutral-500",
  [CommandExecutionState.Error]: "text-red-400",
  [CommandExecutionState.Success]: "text-green-400",
} satisfies Record<CommandExecutionStateValue, string>;

export function TerminalHistoryRow({
  input,
  state,
  output,
}: TerminalHistoryEntry): ReactElement {
  return (
    <div className="whitespace-pre-wrap wrap-break-words">
      <div className="text-neutral-500">
        <span className="mr-1 text-neutral-500">&gt;</span>
        <span className={stateClassMap[state]}>{input}</span>
      </div>
      <div>{output}</div>
    </div>
  );
}
