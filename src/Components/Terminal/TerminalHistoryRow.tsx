export const TerminalHistoryState = {
  Cancelled: "cancelled",
  Error: "error",
  Success: "success",
} as const;

export type TerminalHistoryState =
  (typeof TerminalHistoryState)[keyof typeof TerminalHistoryState];

export type TerminalHistoryProps = {
  value: string;
  state: TerminalHistoryState;
  result: string;
};

const stateClassMap: Record<TerminalHistoryState, string> = {
  [TerminalHistoryState.Cancelled]: "text-neutral-500",
  [TerminalHistoryState.Error]: "text-red-400",
  [TerminalHistoryState.Success]: "text-green-400",
};

export function TerminalHistoryRow({
  value,
  state,
  result,
}: TerminalHistoryProps) {
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
