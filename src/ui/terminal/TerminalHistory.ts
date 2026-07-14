import type { CommandExecution } from "../../application/commands/CommandExecution";

declare const terminalHistoryEntryIdBrand: unique symbol;

export type TerminalHistoryEntryId = string & {
  readonly [terminalHistoryEntryIdBrand]: "TerminalHistoryEntryId";
};

export type TerminalHistoryEntry = CommandExecution &
  Readonly<{
    id: TerminalHistoryEntryId;
  }>;

export type CreateTerminalHistoryEntryOptions = Readonly<{
  sequence: number;
  execution: CommandExecution;
}>;

export function createTerminalHistoryEntry({
  sequence,
  execution,
}: CreateTerminalHistoryEntryOptions): TerminalHistoryEntry {
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error("Terminal history sequence numbers must be positive integers.");
  }

  return {
    id: `history-${sequence}` as TerminalHistoryEntryId,
    ...execution,
  };
}
