import type { ReactElement } from "react";
import type { VirtualDirectoryPath } from "../../domain/filesystem/VirtualFilesystem.ts";

type ShellContextLineProps = Readonly<{
  currentDirectory: VirtualDirectoryPath;
  promptLabel: string | undefined;
  promptIdentity: string;
}>;

export function ShellContextLine({
  currentDirectory,
  promptLabel,
  promptIdentity,
}: ShellContextLineProps): ReactElement {
  return (
    <div className="text-text-muted">
      <span className="text-ui-accent">{promptIdentity}</span>
      <span> {currentDirectory}</span>
      {promptLabel === undefined ? null : <span> · {promptLabel}</span>}
    </div>
  );
}
