import type { ReactElement } from "react";
import type { ApplicationMode } from "../../ApplicationComposition.ts";
import type {
  ShellCompletion,
  ShellStatus,
} from "../../domain/terminal/Shell.ts";
import { normalizeUnicodeCursorOffset } from "../../domain/terminal/UnicodeCursor.ts";
import { InputRow } from "./InputRow";
import { TerminalStatus } from "./TerminalStatus";

type TerminalPromptProps = Readonly<{
  prompt: string;
  applicationMode: ApplicationMode;
  currentInput: string;
  cursorColumn: number;
  status: ShellStatus;
  completion: ShellCompletion;
}>;

export function TerminalPrompt({
  prompt,
  applicationMode,
  currentInput,
  cursorColumn,
  status,
  completion,
}: TerminalPromptProps): ReactElement {
  const activeLine = `${prompt} ${currentInput}`;
  const safeCursorColumn = normalizeUnicodeCursorOffset(
    currentInput,
    cursorColumn,
  );
  const cursorIndex = `${prompt} `.length + safeCursorColumn;

  return (
    <div className="pb-2">
      <div aria-hidden="true">
        <InputRow activeLine={activeLine} cursorIndex={cursorIndex} />
      </div>
      <TerminalStatus
        applicationMode={applicationMode}
        status={status}
        completion={completion}
      />
    </div>
  );
}
