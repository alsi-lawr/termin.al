import type { ReactElement } from "react";
import type {
  ShellHistoryEntry,
  ShellHistoryOutcome,
} from "../../domain/terminal/Shell.ts";
import {
  TerminalDiagnosticBlock,
  TerminalOutputBlock,
} from "./TerminalOutputBlock";

type TerminalHistoryRowProps = Readonly<{
  entry: ShellHistoryEntry;
}>;

const outcomeClassMap = {
  succeeded: "text-green-400",
  failed: "text-red-400",
  cancelled: "text-neutral-500",
} as const satisfies Readonly<{
  [Kind in ShellHistoryOutcome["kind"]]: string;
}>;

function TerminalHistoryOutcome({
  historyEntryId,
  outcome,
}: Readonly<{
  historyEntryId: ShellHistoryEntry["id"];
  outcome: ShellHistoryOutcome;
}>): ReactElement {
  switch (outcome.kind) {
    case "succeeded":
      return (
        <div className="space-y-2">
          {outcome.outputs.map((output) => (
            <TerminalOutputBlock
              key={output.id}
              historyEntryId={historyEntryId}
              output={output}
            />
          ))}
        </div>
      );
    case "failed":
      return (
        <div className="space-y-1">
          {outcome.diagnostics.map((diagnostic) => (
            <TerminalDiagnosticBlock
              key={diagnostic.id}
              diagnostic={diagnostic}
            />
          ))}
        </div>
      );
    case "cancelled":
      return <TerminalDiagnosticBlock diagnostic={outcome.diagnostic} />;
  }
}

export function TerminalHistoryRow({
  entry,
}: TerminalHistoryRowProps): ReactElement {
  const commandLabelId = `${entry.id}-command`;

  return (
    <article
      className="space-y-1 pb-4"
      aria-labelledby={commandLabelId}
    >
      <div id={commandLabelId} className="whitespace-pre-wrap wrap-break-words">
        <span className="mr-1 text-neutral-500" aria-hidden="true">
          &gt;
        </span>
        <span className={outcomeClassMap[entry.outcome.kind]}>
          {entry.command.source}
        </span>
      </div>
      <TerminalHistoryOutcome
        historyEntryId={entry.id}
        outcome={entry.outcome}
      />
    </article>
  );
}
