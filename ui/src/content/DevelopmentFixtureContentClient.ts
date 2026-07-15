import type {
  ContentClient,
  ContentCorpusLoadResult,
} from "../api/ContentClient.ts";
import { developmentFixtureCorpus } from "./DevelopmentFixtureCorpus.ts";

export function createDevelopmentFixtureContentClient(): ContentClient {
  return {
    loadCorpus: async (signal): Promise<ContentCorpusLoadResult> =>
      signal.aborted
        ? { kind: "cancelled" }
        : { kind: "available", corpus: developmentFixtureCorpus },
  };
}
