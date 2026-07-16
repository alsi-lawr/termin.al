import type { StatsSnapshot } from "../../api/StatsClient.ts";

export type WorkspaceStatsState =
  | Readonly<{ kind: "loading" }>
  | Readonly<{ kind: "live"; snapshot: StatsSnapshot }>
  | Readonly<{ kind: "reconnecting"; snapshot: StatsSnapshot }>
  | Readonly<{ kind: "stale"; snapshot: StatsSnapshot }>
  | Readonly<{ kind: "no-data"; snapshot: StatsSnapshot }>
  | Readonly<{ kind: "unavailable" }>;

export type WorkspaceStatsStatus = Readonly<{
  label: "LIVE" | "RECONNECTING" | "STALE" | "NO DATA" | "UNAVAILABLE";
  totalSessions: number;
  totalPageViews: number;
}>;

export function workspaceStatsFromSnapshot(
  snapshot: StatsSnapshot,
): WorkspaceStatsState {
  if (snapshot.totalSessions === 0 && snapshot.totalPageViews === 0) {
    return { kind: "no-data", snapshot };
  }

  return snapshot.storageState === "read-only"
    ? { kind: "stale", snapshot }
    : { kind: "live", snapshot };
}

export function workspaceStatsAfterDisconnect(
  state: WorkspaceStatsState,
): WorkspaceStatsState {
  return "snapshot" in state
    ? { kind: "reconnecting", snapshot: state.snapshot }
    : { kind: "unavailable" };
}

export function workspaceStatsAfterInvalidEvent(
  state: WorkspaceStatsState,
): WorkspaceStatsState {
  return "snapshot" in state
    ? { kind: "stale", snapshot: state.snapshot }
    : { kind: "unavailable" };
}

export function workspaceStatsStatus(
  state: WorkspaceStatsState,
): WorkspaceStatsStatus {
  switch (state.kind) {
    case "loading":
    case "unavailable":
      return { label: "UNAVAILABLE", totalSessions: 0, totalPageViews: 0 };
    case "live":
      return {
        label: "LIVE",
        totalSessions: state.snapshot.totalSessions,
        totalPageViews: state.snapshot.totalPageViews,
      };
    case "reconnecting":
      return {
        label: "RECONNECTING",
        totalSessions: state.snapshot.totalSessions,
        totalPageViews: state.snapshot.totalPageViews,
      };
    case "stale":
      return {
        label: "STALE",
        totalSessions: state.snapshot.totalSessions,
        totalPageViews: state.snapshot.totalPageViews,
      };
    case "no-data":
      return { label: "NO DATA", totalSessions: 0, totalPageViews: 0 };
  }
}

export function formatPortfolioStats(
  state: WorkspaceStatsState,
  currentUtcDate: string,
): string {
  if (state.kind === "loading" || state.kind === "unavailable") {
    return "STATISTICS\nSTATUS       UNAVAILABLE";
  }

  const status = workspaceStatsStatus(state);
  const currentDay = state.snapshot.daily.find(
    (bucket) => bucket.date === currentUtcDate,
  );
  const daySessions = currentDay?.sessions ?? 0;
  const dayViews = currentDay?.pageViews ?? 0;
  const contentLines = [...state.snapshot.pageViewsByContent]
    .sort((left, right) => left.contentId.value.localeCompare(right.contentId.value))
    .map((count) => `${count.contentId.value.padEnd(20)} ${count.pageViews}`);

  return [
    "STATISTICS",
    `STATUS       ${status.label}`,
    `SESSIONS     ${state.snapshot.totalSessions}`,
    `VIEWS        ${state.snapshot.totalPageViews}`,
    `UTC ${currentUtcDate}  SESSIONS ${daySessions}  VIEWS ${dayViews}`,
    "BY CONTENT",
    ...(contentLines.length === 0 ? ["(none)"] : contentLines),
  ].join("\n");
}
