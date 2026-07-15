import type { ReactElement } from "react";
import type { ApplicationMode } from "../../ApplicationComposition.ts";
import type {
  ShellCompletion,
  ShellStatus,
} from "../../domain/terminal/Shell.ts";

type TerminalStatusProps = Readonly<{
  applicationMode: ApplicationMode;
  status: ShellStatus;
  completion: ShellCompletion;
}>;

function statusMessage(status: ShellStatus, completion: ShellCompletion): string {
  if (completion.kind === "pending") {
    return "COMPLETING";
  }

  if (completion.kind === "suggestions") {
    return `${completion.candidates.length} COMPLETIONS`;
  }

  switch (status.kind) {
    case "ready":
      return status.mode.kind === "insert" ? "INSERT" : "NORMAL";
    case "secret":
      return status.mode.kind === "insert" ? "SECRET INSERT" : "SECRET NORMAL";
    case "running":
      return "RUNNING";
    case "cancelling":
      return "CANCELLING";
  }
}

export function TerminalStatus({
  applicationMode,
  status,
  completion,
}: TerminalStatusProps): ReactElement {
  return (
    <div className="mt-2 text-text-muted" role="status" aria-live="polite">
      <span>{statusMessage(status, completion)}</span>
      {applicationMode === "demo" ? (
        <span
          className="ml-2 rounded-sm border border-ui-accent bg-surface-raised px-1 text-text-bright"
          aria-label="Demo mode"
        >
          DEMO
        </span>
      ) : null}
      {completion.kind === "suggestions" ? (
        <span className="ml-2">
          {completion.candidates.map((candidate) => (
            <span key={`${candidate.kind}-${candidate.value}`} className="mr-2">
              {candidate.value}
            </span>
          ))}
        </span>
      ) : null}
    </div>
  );
}
