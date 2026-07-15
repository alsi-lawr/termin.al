import type { ReactElement } from "react";
import type {
  ShellDiagnostic,
  ShellHistoryEntryId,
  ShellOutput,
  ShellTableColumn,
} from "../../domain/terminal/Shell.ts";

type TerminalDiagnosticBlockProps = Readonly<{
  diagnostic: ShellDiagnostic;
}>;

type TerminalOutputBlockProps = Readonly<{
  historyEntryId: ShellHistoryEntryId;
  output: ShellOutput;
}>;

function diagnosticLabel(diagnostic: ShellDiagnostic): string {
  switch (diagnostic.kind) {
    case "parse":
      return "Parse error";
    case "command":
      return "Command error";
    case "runtime":
      return "Runtime error";
  }
}

function columnHeaderId(
  historyEntryId: ShellHistoryEntryId,
  outputId: ShellOutput["id"],
  column: ShellTableColumn,
): string {
  return `${historyEntryId}-${outputId}-column-${column.id}`;
}

export function TerminalDiagnosticBlock({
  diagnostic,
}: TerminalDiagnosticBlockProps): ReactElement {
  return (
    <div className="whitespace-pre-wrap wrap-break-words text-red-400">
      <span className="font-semibold">{diagnosticLabel(diagnostic)}:</span>{" "}
      <span>{diagnostic.message}</span>
    </div>
  );
}

export function TerminalOutputBlock({
  historyEntryId,
  output,
}: TerminalOutputBlockProps): ReactElement {
  switch (output.kind) {
    case "text":
      return (
        <p className="whitespace-pre-wrap wrap-break-words">{output.text}</p>
      );
    case "table":
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">Command output table</caption>
            <thead className="border-b border-neutral-800 text-neutral-500">
              <tr>
                {output.columns.map((column) => (
                  <th
                    key={column.id}
                    id={columnHeaderId(historyEntryId, output.id, column)}
                    scope="col"
                    className="px-2 py-1 font-semibold"
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {output.rows.map((row) => (
                <tr key={row.id} className="border-b border-neutral-800">
                  {row.cells.map((cell) => (
                    <td
                      key={cell.id}
                      headers={`${historyEntryId}-${output.id}-column-${cell.columnId}`}
                      className="px-2 py-1 align-top whitespace-pre-wrap wrap-break-words"
                    >
                      {cell.value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "diagnostic":
      return <TerminalDiagnosticBlock diagnostic={output.diagnostic} />;
    case "prompt":
      return (
        <div className="whitespace-pre-wrap wrap-break-words">
          <span className="font-semibold text-neutral-500">{output.label}:</span>{" "}
          <span>{output.message}</span>
        </div>
      );
    case "rich":
      return (
        <section aria-label={output.title}>
          <h3 className="font-semibold text-green-400">{output.title}</h3>
          <dl>
            {output.fields.map((field) => (
              <div key={field.id} className="grid grid-cols-1 gap-1 py-1 sm:grid-cols-2">
                <dt className="font-semibold text-neutral-500">{field.label}</dt>
                <dd className="whitespace-pre-wrap wrap-break-words">{field.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      );
  }
}
