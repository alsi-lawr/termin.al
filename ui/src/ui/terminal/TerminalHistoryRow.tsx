import type { ReactElement } from "react";
import type {
  ShellHistoryEntry,
  ShellHistoryOutcome,
} from "../../domain/terminal/Shell.ts";
import { TerminalOutputBlock } from "./TerminalOutputBlock";
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
  outcome,
}: Readonly<{
  outcome: ShellHistoryOutcome;
}>): ReactElement {
  return (
    <div className="space-y-2">
      {outcome.events.map((event) =>
        event.kind === "output"
          ? (
              <TerminalOutputBlock
                key={event.output.id}
                output={event.output}
              />
            )
          : undefined
      )}
    </div>
  );
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
        outcome={entry.outcome}
      />
    </article>
  );
}
