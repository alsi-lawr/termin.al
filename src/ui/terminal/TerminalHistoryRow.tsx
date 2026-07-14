import type { ReactElement } from "react";
import type {
  CommandOutcome,
  ShellHistoryEntry,
  ShellOutput,
} from "../../domain/terminal/Shell.ts";

type TerminalHistoryRowProps = Readonly<{
  entry: ShellHistoryEntry;
}>;

const outcomeClassMap = {
  succeeded: "text-green-400",
  failed: "text-red-400",
  cancelled: "text-neutral-500",
} as const satisfies Readonly<{
  [Kind in CommandOutcome["kind"]]: string;
}>;

function outputLines(output: ShellOutput): ReadonlyArray<string> {
  switch (output.kind) {
    case "text":
      return [output.text];
    case "table":
      return [
        output.columns.join("\t"),
        ...output.rows.map((row) => row.join("\t")),
      ];
    case "diagnostic":
      return [output.diagnostic.message];
    case "prompt":
      return [`${output.label} ${output.message}`];
    case "rich":
      return [output.title, ...output.lines];
  }
}

function outcomeLines(outcome: CommandOutcome): ReadonlyArray<string> {
  switch (outcome.kind) {
    case "succeeded":
      return outcome.outputs.flatMap(outputLines);
    case "failed":
      return outcome.diagnostics.map((diagnostic) => diagnostic.message);
    case "cancelled":
      return [outcome.diagnostic.message];
  }
}

export function TerminalHistoryRow({
  entry,
}: TerminalHistoryRowProps): ReactElement {
  const lines = outcomeLines(entry.outcome);
  const output = lines.join("\n");

  return (
    <div className="whitespace-pre-wrap wrap-break-words">
      <div className="text-neutral-500">
        <span className="mr-1 text-neutral-500">&gt;</span>
        <span className={outcomeClassMap[entry.outcome.kind]}>
          {entry.command.source}
        </span>
      </div>
      <div>{output}</div>
    </div>
  );
}
