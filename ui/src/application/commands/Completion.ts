import type {
  CompletionCandidate,
  CompletionRequest,
  CompletionResult,
} from "../../domain/terminal/Completion.ts";
import {
  listVirtualDirectory,
  type VirtualDirectoryPath,
  type VirtualFilesystem,
  type VirtualNode,
} from "../../domain/filesystem/VirtualFilesystem.ts";
import type { CommandRegistry } from "./CommandRegistry.ts";

export type CommandCompletionProvider = Readonly<{
  complete: (
    request: CompletionRequest,
    signal: AbortSignal,
  ) => Promise<ReadonlyArray<CompletionCandidate>>;
}>;

export type PathCompletionProvider = Readonly<{
  complete: (
    request: CompletionRequest,
    signal: AbortSignal,
  ) => Promise<ReadonlyArray<CompletionCandidate>>;
}>;

export type CompletionService = Readonly<{
  complete: (
    request: CompletionRequest,
    signal: AbortSignal,
  ) => Promise<CompletionResult>;
}>;

export type CreateCompletionServiceOptions = Readonly<{
  commands: CommandCompletionProvider;
  paths: PathCompletionProvider;
}>;

export type CreateVirtualFilesystemPathCompletionProviderOptions = Readonly<{
  filesystem: VirtualFilesystem;
  currentDirectory: VirtualDirectoryPath;
}>;

type PathCompletionLocation = Readonly<{
  directoryInput: string;
  outputPrefix: string;
  namePrefix: string;
}>;

function uniqueMatchingCandidates(
  candidates: ReadonlyArray<CompletionCandidate>,
  prefix: string,
): ReadonlyArray<CompletionCandidate> {
  const values = new Set<string>();
  const matches: CompletionCandidate[] = [];

  for (const candidate of candidates) {
    if (!candidate.value.startsWith(prefix) || values.has(candidate.value)) {
      continue;
    }

    values.add(candidate.value);
    matches.push(candidate);
  }

  return matches;
}

export function createCompletionService({
  commands,
  paths,
}: CreateCompletionServiceOptions): CompletionService {
  return {
    complete: async (request, signal) => {
      if (request.target.kind === "none") {
        return { kind: "none" };
      }

      const candidates =
        request.target.kind === "command"
          ? await commands.complete(request, signal)
          : await paths.complete(request, signal);
      const matches = uniqueMatchingCandidates(candidates, request.target.prefix);

      if (matches.length === 0) {
        return { kind: "none" };
      }

      const [candidate] = matches;

      if (matches.length === 1 && candidate) {
        return { kind: "single", candidate };
      }

      return { kind: "multiple", candidates: matches };
    },
  };
}

export function createRegistryCommandCompletionProvider(
  registry: CommandRegistry,
): CommandCompletionProvider {
  return {
    complete: async () => {
      const candidates: CompletionCandidate[] = [];

      for (const command of registry.commands) {
        candidates.push({
          kind: "command",
          value: command.metadata.name,
          label: command.metadata.summary,
        });

        for (const alias of command.metadata.aliases) {
          candidates.push({
            kind: "command",
            value: alias,
            label: `Alias for ${command.metadata.name}`,
          });
        }
      }

      return candidates;
    },
  };
}

function pathCompletionLocation(prefix: string): PathCompletionLocation {
  const separator = prefix.lastIndexOf("/");

  if (separator === -1) {
    return {
      directoryInput: ".",
      outputPrefix: "",
      namePrefix: prefix,
    };
  }

  const outputPrefix = prefix.slice(0, separator + 1);
  const directoryInput = prefix.slice(0, separator);

  if (directoryInput.length > 0) {
    return {
      directoryInput,
      outputPrefix,
      namePrefix: prefix.slice(separator + 1),
    };
  }

  if (prefix.startsWith("/")) {
    return {
      directoryInput: "/",
      outputPrefix,
      namePrefix: prefix.slice(separator + 1),
    };
  }

  return {
    directoryInput: ".",
    outputPrefix,
    namePrefix: prefix.slice(separator + 1),
  };
}

function pathCandidateLabel(node: VirtualNode): string {
  switch (node.kind) {
    case "directory":
      return "Directory";
    case "file":
      return "File";
    case "locked-file":
      return "Locked file";
  }
}

function pathCandidateValue(
  outputPrefix: string,
  node: VirtualNode,
): string {
  return `${outputPrefix}${node.name}${node.kind === "directory" ? "/" : ""}`;
}

export function createVirtualFilesystemPathCompletionProvider({
  filesystem,
  currentDirectory,
}: CreateVirtualFilesystemPathCompletionProviderOptions): PathCompletionProvider {
  return {
    complete: async (request, signal) => {
      if (signal.aborted || request.target.kind !== "path") {
        return [];
      }

      const location = pathCompletionLocation(request.target.prefix);
      const listing = listVirtualDirectory(
        filesystem,
        currentDirectory,
        location.directoryInput,
      );

      if (listing.kind !== "found") {
        return [];
      }

      return listing.entries
        .filter(
          (entry) =>
            (location.namePrefix.startsWith(".") || !entry.name.startsWith(".")) &&
            entry.name.startsWith(location.namePrefix),
        )
        .map((entry) => ({
          kind: "path",
          value: pathCandidateValue(location.outputPrefix, entry),
          label: pathCandidateLabel(entry),
        }));
    },
  };
}
