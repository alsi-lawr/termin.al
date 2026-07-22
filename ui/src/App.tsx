import type { ReactElement } from "react";
import type {
  ApplicationClientComposition,
  ApplicationMode,
} from "./ApplicationComposition.ts";
import { ContentCorpusGate } from "./content/ContentCorpusGate.tsx";
import { useAuthentication } from "./auth/useAuthentication.ts";

type AppProps = Readonly<{
  applicationClientComposition: ApplicationClientComposition;
  applicationMode: ApplicationMode;
}>;

function App({
  applicationClientComposition,
  applicationMode,
}: AppProps): ReactElement {
  const authentication = useAuthentication(
    applicationClientComposition.sessionClient,
    applicationClientComposition.cvClient,
  );

  return (
    <ContentCorpusGate
      applicationMode={applicationMode}
      contentClient={applicationClientComposition.contentClient}
      statsClient={applicationClientComposition.statsClient}
      authentication={authentication}
      publicationClient={applicationClientComposition.publicationClient}
    />
  );
}

export default App;
