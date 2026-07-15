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
      return "READY";
    case "secret":
      return "SECRET INPUT";
    case "running":
      return "RUNNING";
    case "cancelling":
      return "CANCELLING";
  }
}

function isSelectedCandidate(
  completion: Extract<ShellCompletion, { kind: "suggestions" }>,
  index: number,
): boolean {
  return (
    completion.selection.kind === "selected" &&
    completion.selection.index === index
  );
}

export function TerminalStatus({
  status,
  completion,
}: TerminalStatusProps): ReactElement {
  return (
    <div className="mt-2 text-text-muted">
      <div role="status" aria-live="polite">
        {statusMessage(status, completion)}
      </div>
      {completion.kind === "suggestions" ? (
        <ul
          className="mt-1 space-y-1"
          role="listbox"
          aria-label="Terminal completion candidates"
        >
          {completion.candidates.map((candidate, index) => {
            const selected = isSelectedCandidate(completion, index);

            return (
              <li
                key={`${candidate.kind}-${candidate.value}`}
                role="option"
                aria-selected={selected}
                className={selected ? "text-ui-accent" : "text-text-primary"}
              >
                <span>{candidate.value}</span>
                <span className="ml-2 text-text-muted">{candidate.label}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
