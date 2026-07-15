import type { ReactElement } from "react";
import type {
  ShellHistoryEntry,
  ShellHistoryOutcome,
} from "../../domain/terminal/Shell.ts";
import {
  TerminalDiagnosticBlock,
  TerminalOutputBlock,
} from "./TerminalOutputBlock";
import { ShellContextLine } from "./ShellContextLine";

type TerminalHistoryRowProps = Readonly<{
  entry: ShellHistoryEntry;
}>;

const outcomeClassMap = {
  succeeded: "text-diagnostic-success",
  failed: "text-diagnostic-error",
  cancelled: "text-text-muted",
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
      <div id={commandLabelId}>
        <ShellContextLine
          currentDirectory={entry.command.currentDirectory}
          promptLabel={undefined}
        />
        <div className="whitespace-pre-wrap wrap-break-words">
          <span className="mr-1 text-ui-accent" aria-hidden="true">
            ❯
          </span>
          <span className={outcomeClassMap[entry.outcome.kind]}>
            {entry.command.source}
          </span>
        </div>
      </div>
      <TerminalHistoryOutcome
        historyEntryId={entry.id}
        outcome={entry.outcome}
      />
    </article>
  );
}
