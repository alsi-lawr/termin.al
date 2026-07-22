import type { ContentClient } from "./api/ContentClient.ts";
import type { StatsClient } from "./api/StatsClient.ts";
import type { SessionClient } from "./api/SessionClient.ts";
import type { CvClient } from "./api/CvClient.ts";

export type ApplicationMode = "live" | "demo";

export type ApplicationClientComposition = Readonly<{
  contentClient: ContentClient;
  statsClient: StatsClient;
  sessionClient: SessionClient;
  cvClient: CvClient;
}>;
