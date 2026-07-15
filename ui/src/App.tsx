import type { ReactElement } from "react";
import type {
  ApplicationClientComposition,
  ApplicationMode,
} from "./ApplicationComposition.ts";
import { ContentCorpusGate } from "./content/ContentCorpusGate.tsx";

type AppProps = Readonly<{
  applicationClientComposition: ApplicationClientComposition;
  applicationMode: ApplicationMode;
}>;

function App({
  applicationClientComposition,
  applicationMode,
}: AppProps): ReactElement {
  return (
    <ContentCorpusGate
      applicationMode={applicationMode}
      contentClient={applicationClientComposition.contentClient}
    />
  );
}

export default App;
