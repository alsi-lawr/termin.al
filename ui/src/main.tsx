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
      const { createDevelopmentFixtureContentClient } = await import(
        "./content/DevelopmentFixtureContentClient.ts"
      );

      return Object.freeze({
        contentClient: createDevelopmentFixtureContentClient(),
      });
    }
    case "live": {
      const { HttpContentClient } = await import("./api/ContentClient.ts");

      return Object.freeze({ contentClient: new HttpContentClient() });
    }
  }
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("The application root element is missing.");
}

const normalizedPathname = normalizePathname(window.location.pathname);
const applicationMode: ApplicationMode =
  normalizedPathname === "/demo" ? "demo" : "live";
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
