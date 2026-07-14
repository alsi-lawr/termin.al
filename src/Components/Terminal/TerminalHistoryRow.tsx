import type { ReactElement } from "react";
import {
  TerminalHistoryState,
  type TerminalHistoryEntry,
  type TerminalHistoryState as TerminalHistoryStateValue,
} from "./TerminalHistory";

const stateClassMap = {
  [TerminalHistoryState.Cancelled]: "text-neutral-500",
  [TerminalHistoryState.Error]: "text-red-400",
  [TerminalHistoryState.Success]: "text-green-400",
} satisfies Record<TerminalHistoryStateValue, string>;

export function TerminalHistoryRow({
  value,
  state,
  result,
}: TerminalHistoryEntry): ReactElement {
  return (
    <div className="whitespace-pre-wrap wrap-break-words">
      <div className="text-neutral-500">
        <span className="mr-1 text-neutral-500">&gt;</span>
        <span className={stateClassMap[state]}>{value}</span>
      </div>
      <div>{result}</div>
    </div>
  );
}
