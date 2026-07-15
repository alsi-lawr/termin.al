import type { VimMode } from "../../domain/vim/VimBuffer.ts";

export function vimEditorModeStatus(mode: VimMode): string {
  switch (mode.kind) {
    case "normal":
      return "NORMAL";
    case "insert":
      return "INSERT";
    case "visual":
      return "VISUAL LINE";
    case "command":
      return mode.prompt === ":" ? "COMMAND" : "SEARCH";
  }
}
