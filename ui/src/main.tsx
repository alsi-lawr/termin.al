import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type {
  ApplicationClientComposition,
  ApplicationMode,
} from "./ApplicationComposition.ts";
import "./index.css";
import App from "./App.tsx";

function normalizePathname(pathname: string): string {
  return pathname === "/demo/" ? "/demo" : pathname;
}

async function createApplicationClientComposition(
  applicationMode: ApplicationMode,
): Promise<ApplicationClientComposition> {
  switch (applicationMode) {
    case "demo": {
      const { DemoContentClient } = await import("./content/DemoContentClient.ts");
      const { DemoStatsClient } = await import("./api/StatsClient.ts");
      const { DemoCapabilityState, DemoSessionClient } = await import("./api/SessionClient.ts");
      const { DemoCvClient } = await import("./api/CvClient.ts");

      const demoCapabilities = new DemoCapabilityState();

      return Object.freeze({
        contentClient: new DemoContentClient(),
        statsClient: new DemoStatsClient(),
        sessionClient: new DemoSessionClient(demoCapabilities),
        cvClient: new DemoCvClient(demoCapabilities),
        publicationClient: undefined,
      });
    }
    case "live": {
      const { BrowserGrpcContext } = await import("./api/BrowserGrpcContext.ts");
      const { GrpcContentClient } = await import("./api/ContentClient.ts");
      const { GrpcStatsClient } = await import("./api/StatsClient.ts");
      const { GrpcSessionClient } = await import("./api/SessionClient.ts");
      const { GrpcCvClient } = await import("./api/CvClient.ts");
      const { GrpcPublicationClient } = await import("./api/PublicationClient.ts");

      const grpcContext = new BrowserGrpcContext();
      const sessionClient = new GrpcSessionClient(grpcContext);

      return Object.freeze({
        contentClient: new GrpcContentClient(grpcContext),
        statsClient: new GrpcStatsClient(grpcContext),
        sessionClient,
        cvClient: new GrpcCvClient(grpcContext, sessionClient),
        publicationClient: new GrpcPublicationClient(grpcContext, sessionClient),
      });
    }
  }
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("The application root element is missing.");
}

const normalizedPathname = normalizePathname(window.location.pathname);
const applicationMode: ApplicationMode =
  normalizedPathname === "/demo" || import.meta.env.MODE === "demo"
    ? "demo"
    : "live";
const applicationClientComposition = await createApplicationClientComposition(
  applicationMode,
);

createRoot(rootElement).render(
  <StrictMode>
    <App
      applicationClientComposition={applicationClientComposition}
      applicationMode={applicationMode}
    />
  </StrictMode>,
);
