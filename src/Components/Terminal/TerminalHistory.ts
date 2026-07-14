export const TerminalHistoryState = {
  Cancelled: "cancelled",
  Error: "error",
  Success: "success",
} as const;

export type TerminalHistoryState =
  (typeof TerminalHistoryState)[keyof typeof TerminalHistoryState];

declare const terminalHistoryEntryIdBrand: unique symbol;

export type TerminalHistoryEntryId = string & {
  readonly [terminalHistoryEntryIdBrand]: "TerminalHistoryEntryId";
};

export type TerminalSubmission = Readonly<{
  value: string;
  state: TerminalHistoryState;
  result: string;
}>;

export type TerminalHistoryEntry = TerminalSubmission &
  Readonly<{
    id: TerminalHistoryEntryId;
  }>;

export type CreateTerminalHistoryEntryOptions = Readonly<{
  sequence: number;
  submission: TerminalSubmission;
}>;

export function createTerminalHistoryEntry({
  sequence,
  submission,
}: CreateTerminalHistoryEntryOptions): TerminalHistoryEntry {
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error("Terminal history sequence numbers must be positive integers.");
  }

  return {
    id: `history-${sequence}` as TerminalHistoryEntryId,
    ...submission,
  };
}
