import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  HttpContentClient,
  type ContentClient,
} from "./api/ContentClient.ts";
import { createDevelopmentFixtureContentClient } from "./content/DevelopmentFixtureContentClient.ts";
import "./index.css";
import App from "./App.tsx";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("The application root element is missing.");
}

const contentClient: ContentClient =
  import.meta.env.DEV || import.meta.env.MODE === "test"
    ? createDevelopmentFixtureContentClient()
    : new HttpContentClient();

createRoot(rootElement).render(
  <StrictMode>
    <App contentClient={contentClient} />
  </StrictMode>,
);
