import type { OptionTerminator } from "../../domain/terminal/ArgumentLexer.ts";
import type {
  CommandHistoryEntry,
  CommandOutcome,
  ShellId,
  ShellSessionId,
} from "../../domain/terminal/Shell.ts";
import type { VirtualDirectoryPath } from "../../domain/filesystem/VirtualFilesystem.ts";

export type CommandGroup = "gnu-like" | "application" | "navigation";

export type CommandMetadata = Readonly<{
  group: CommandGroup;
  name: string;
  aliases: ReadonlyArray<string>;
  summary: string;
  usage: string;
  examples: ReadonlyArray<string>;
}>;

export type CommandInvocation = Readonly<{
  source: string;
  name: string;
  arguments: ReadonlyArray<string>;
  optionTerminator: OptionTerminator;
}>;

export type CommandExecutionContext = Readonly<{
  shellId: ShellId;
  sessionId: ShellSessionId;
  currentDirectory: VirtualDirectoryPath;
  commandHistory: ReadonlyArray<CommandHistoryEntry>;
  registry: CommandRegistry;
  signal: AbortSignal;
}>;

export type CommandDefinition = Readonly<{
  metadata: CommandMetadata;
  execute: (
    invocation: CommandInvocation,
    context: CommandExecutionContext,
  ) => Promise<CommandOutcome>;
}>;

export type CommandRegistry = Readonly<{
  commands: ReadonlyArray<CommandDefinition>;
}>;

export type CommandResolution =
  | Readonly<{
      kind: "found";
      command: CommandDefinition;
    }>
  | Readonly<{
      kind: "missing";
      requestedName: string;
    }>;

export type CreateCommandRegistryOptions = Readonly<{
  commands: ReadonlyArray<CommandDefinition>;
}>;

function assertCommandName(name: string): void {
  if (name.length === 0 || name.trim() !== name) {
    throw new Error("Command names and aliases must be non-empty trimmed strings.");
  }
}

export function createCommandRegistry({
  commands,
}: CreateCommandRegistryOptions): CommandRegistry {
  const registeredNames = new Set<string>();

  for (const command of commands) {
    const names = [command.metadata.name, ...command.metadata.aliases];

    for (const name of names) {
      assertCommandName(name);

      if (registeredNames.has(name)) {
        throw new Error(`Command name '${name}' is registered more than once.`);
      }

      registeredNames.add(name);
    }
  }

  return { commands: [...commands] };
}

export function resolveCommand(
  registry: CommandRegistry,
  requestedName: string,
): CommandResolution {
  const command = registry.commands.find(
    (definition) =>
      definition.metadata.name === requestedName ||
      definition.metadata.aliases.includes(requestedName),
  );

  if (!command) {
    return { kind: "missing", requestedName };
  }

  return { kind: "found", command };
}
