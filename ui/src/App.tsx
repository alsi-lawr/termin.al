import type { ReactElement } from "react";
import type { ContentClient } from "./api/ContentClient.ts";
import { ContentCorpusGate } from "./content/ContentCorpusGate.tsx";

type AppProps = Readonly<{
  contentClient: ContentClient;
}>;

function App({ contentClient }: AppProps): ReactElement {
  return <ContentCorpusGate contentClient={contentClient} />;
}

export default App;
