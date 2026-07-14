export const CommandExecutionState = {
  Cancelled: "cancelled",
  Error: "error",
  Success: "success",
} as const;

export type CommandExecutionState =
  (typeof CommandExecutionState)[keyof typeof CommandExecutionState];

export type CommandExecution = Readonly<{
  input: string;
  state: CommandExecutionState;
  output: string;
}>;
