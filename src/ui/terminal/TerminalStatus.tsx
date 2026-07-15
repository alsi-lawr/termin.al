import type { ReactElement } from "react";
import type {
  ShellCompletion,
  ShellStatus,
} from "../../domain/terminal/Shell.ts";

type TerminalStatusProps = Readonly<{
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
  status,
  completion,
}: TerminalStatusProps): ReactElement {
  return (
    <div className="mt-2 text-neutral-500" role="status" aria-live="polite">
      <span>{statusMessage(status, completion)}</span>
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
