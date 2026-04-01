import type { Command } from "./Command";
import { success } from "./CommandResult";

export const ListCommand: Command<string> = {
  name: "list",
  description: "List all file descriptors",
  manText: `
Usage: ls [OPTION]... [FILE]...

List information about the FILEs (the current directory by default).

Options:
  -a, --all             do not ignore entries starting with .
  -l                    use a long listing format
  -h, --human-readable  with -l, print sizes like 1K, 234M, 2G
  -r, --reverse         reverse order while sorting
  -t                    sort by time, newest first
      --help            display this help and exit
    `,
  handler: (args: string[]) => success("TODO"),
};

type LsDirectoryEntry = {
  name: string;
  hidden?: boolean;
  size?: number;
  modifiedAt?: string;
};

type LsDirectoryMap = Record<string, LsDirectoryEntry[]>;
