import type {
  CompletionCandidate,
  CompletionRequest,
  CompletionResult,
} from "../../domain/terminal/Completion.ts";
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

export function createEmptyPathCompletionProvider(): PathCompletionProvider {
  return {
    complete: async () => [],
  };
}
