import type { ContentClient } from "./api/ContentClient.ts";

export type ApplicationMode = "live" | "demo";

export type ApplicationClientComposition = Readonly<{
  contentClient: ContentClient;
}>;
