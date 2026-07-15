import { useEffect, useState } from "react";
import type { ContentClient, ContentCorpus } from "../api/ContentClient.ts";

export type ContentCorpusState =
  | Readonly<{ kind: "loading" }>
  | Readonly<{ kind: "available"; corpus: ContentCorpus }>
  | Readonly<{ kind: "stale"; corpus: ContentCorpus }>
  | Readonly<{ kind: "empty" }>
  | Readonly<{ kind: "failed"; message: string }>;

const loadingState: ContentCorpusState = { kind: "loading" };

export function useContentCorpus(
  contentClient: ContentClient,
): ContentCorpusState {
  const [state, setState] = useState<ContentCorpusState>(loadingState);

  useEffect(() => {
    const controller = new AbortController();
    setState(loadingState);

    void contentClient
      .loadCorpus(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) {
          return;
        }

        switch (result.kind) {
          case "available":
            setState({ kind: "available", corpus: result.corpus });
            return;
          case "stale":
            setState({ kind: "stale", corpus: result.corpus });
            return;
          case "empty":
            setState({ kind: "empty" });
            return;
          case "cancelled":
            return;
          case "failed":
            setState({ kind: "failed", message: result.message });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setState({
            kind: "failed",
            message: "The content corpus could not be loaded.",
          });
        }
      });

    return (): void => {
      controller.abort();
    };
  }, [contentClient]);

  return state;
}
