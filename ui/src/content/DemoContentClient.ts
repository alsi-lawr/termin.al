import type {
  ContentClient,
  ContentCorpusLoadResult,
} from "../api/ContentClient.ts";
import { demoContentCorpus } from "./DemoContentCorpus.ts";

export class DemoContentClient implements ContentClient {
  loadCorpus(signal: AbortSignal): Promise<ContentCorpusLoadResult> {
    return Promise.resolve(
      signal.aborted
        ? { kind: "cancelled" }
        : { kind: "available", corpus: demoContentCorpus },
    );
  }
}
