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

      return Object.freeze({
        contentClient: new DemoContentClient(),
        statsClient: new DemoStatsClient(),
      });
    }
    case "live": {
      const { HttpContentClient } = await import("./api/ContentClient.ts");
      const { HttpStatsClient } = await import("./api/StatsClient.ts");

      return Object.freeze({
        contentClient: new HttpContentClient(),
        statsClient: new HttpStatsClient(),
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
