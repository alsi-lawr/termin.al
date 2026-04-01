import type { CommandResult } from "./CommandResult";

export type Command<T> = {
  name: string;
  description: string;
  manText: string;
  handler: (args: string[]) => CommandResult<T>;
};

export type CommandContext<T> = {
  command: Command<T>;
  args: string[];
};
