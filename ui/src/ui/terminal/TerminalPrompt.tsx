import type { ReactElement } from "react";
import type { VirtualDirectoryPath } from "../../domain/filesystem/VirtualFilesystem.ts";
import type {
  ShellAutosuggestion,
  ShellCompletion,
  ShellStatus,
} from "../../domain/terminal/Shell.ts";
import { normalizeUnicodeCursorOffset } from "../../domain/terminal/UnicodeCursor.ts";
import { InputRow } from "./InputRow";
import { ShellContextLine } from "./ShellContextLine";
import { TerminalStatus } from "./TerminalStatus";

type TerminalPromptProps = Readonly<{
  currentDirectory: VirtualDirectoryPath;
  promptIdentity: string;
  promptLabel: string | undefined;
  currentInput: string;
  cursorColumn: number;
  status: ShellStatus;
  completion: ShellCompletion;
  autosuggestion: ShellAutosuggestion;
}>;

export function TerminalPrompt({
  currentDirectory,
  promptIdentity,
  promptLabel,
  currentInput,
  cursorColumn,
  status,
  completion,
  autosuggestion,
}: TerminalPromptProps): ReactElement {
  const promptPrefix = "❯ ";
  const activeLine = `${promptPrefix}${currentInput}`;
  const safeCursorColumn = normalizeUnicodeCursorOffset(
    currentInput,
    cursorColumn,
  );
  const cursorIndex = promptPrefix.length + safeCursorColumn;

  return (
    <div className="pb-2">
      <ShellContextLine
        promptIdentity={promptIdentity}
        currentDirectory={currentDirectory}
        promptLabel={promptLabel}
      />
      <div aria-hidden="true" className="whitespace-pre-wrap wrap-break-words">
        <InputRow
          activeLine={activeLine}
          cursorIndex={cursorIndex}
          suggestionSuffix={autosuggestion.kind === "suggestion" ? autosuggestion.suffix : undefined}
        />
      </div>
      <TerminalStatus status={status} completion={completion} />
    </div>
  );
}
