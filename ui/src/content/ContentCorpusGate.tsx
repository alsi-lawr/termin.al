import type { ReactElement } from "react";
import type { ApplicationMode } from "../ApplicationComposition.ts";
import type { ContentClient } from "../api/ContentClient.ts";
import type { StatsClient } from "../api/StatsClient.ts";
import { Workspace } from "../ui/workspace/Workspace.tsx";
import { useContentCorpus } from "./useContentCorpus.ts";
import type { AuthenticationBinding } from "../auth/useAuthentication.ts";
import type { PublicationClient } from "../api/PublicationClient.ts";

type ContentCorpusGateProps = Readonly<{
  applicationMode: ApplicationMode;
  contentClient: ContentClient;
  statsClient: StatsClient;
  authentication: AuthenticationBinding;
  publicationClient: PublicationClient | undefined;
}>;

function ContentStatus({
  title,
  message,
  role,
}: Readonly<{
  title: string;
  message: string;
  role: "alert" | "status";
}>): ReactElement {
  return (
    <main
      className="flex min-h-dvh items-center justify-center bg-surface-deepest px-6 text-foreground"
      role={role}
    >
      <section className="max-w-md rounded-md border border-ui-subtle bg-surface-raised p-6">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-foreground-muted">{message}</p>
      </section>
    </main>
  );
}

export function ContentCorpusGate({
  applicationMode,
  contentClient,
  statsClient,
  authentication,
  publicationClient,
}: ContentCorpusGateProps): ReactElement {
  const state = useContentCorpus(contentClient);

  switch (state.kind) {
    case "loading":
      return (
        <ContentStatus
          role="status"
          title="Loading content"
          message="Retrieving the public content corpus."
        />
      );
    case "empty":
      return (
        <ContentStatus
          role="status"
          title="No content available"
          message="The public content corpus is currently empty."
        />
      );
    case "failed":
      return (
        <ContentStatus role="alert" title="Content unavailable" message={state.message} />
      );
    case "available":
      return <Workspace applicationMode={applicationMode} authentication={authentication} corpus={state.corpus} publicationClient={publicationClient} statsClient={statsClient} />;
    case "stale":
      return (
        <div className="min-h-dvh bg-surface-deepest">
          <p className="border-b border-ui-subtle bg-surface-raised px-4 py-2 text-center text-sm text-foreground-muted" role="status">
            Displaying recently cached content while GitHub is unavailable.
          </p>
          <Workspace applicationMode={applicationMode} authentication={authentication} corpus={state.corpus} publicationClient={publicationClient} statsClient={statsClient} />
        </div>
      );
  }
}
