import type { ReactElement } from "react";
import type {
  ShellDiagnostic,
  ShellOutput,
} from "../../domain/terminal/Shell.ts";

type TerminalDiagnosticBlockProps = Readonly<{
  diagnostic: ShellDiagnostic;
}>;

type TerminalOutputBlockProps = Readonly<{
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

export function TerminalDiagnosticBlock({
  diagnostic,
}: TerminalDiagnosticBlockProps): ReactElement {
  return (
    <div className="whitespace-pre-wrap wrap-break-words text-diagnostic-error">
      <span className="font-semibold">{diagnosticLabel(diagnostic)}:</span>{" "}
      <span>{diagnostic.message}</span>
    </div>
  );
}

export function TerminalOutputBlock({
  output,
}: TerminalOutputBlockProps): ReactElement {
  switch (output.kind) {
    case "text":
      return (
        <p className="whitespace-pre-wrap wrap-break-words">{output.text}</p>
      );
    case "diagnostic":
      return <TerminalDiagnosticBlock diagnostic={output.diagnostic} />;
    case "prompt":
      return (
        <div className="whitespace-pre-wrap wrap-break-words">
          <span className="font-semibold text-text-muted">{output.label}:</span>{" "}
          <span>{output.message}</span>
        </div>
      );
  }
}
