import assert from "node:assert/strict";
import test from "node:test";
import { ContentId } from "../../api/ContentContracts.ts";
import {
  demoStatsSnapshot,
  type StatsClient,
  type StatsLoadResult,
  type StatsSnapshot,
  type StatsStreamEvent,
} from "../../api/StatsClient.ts";
import {
  formatPortfolioStats,
  workspaceStatsAfterDisconnect,
  workspaceStatsAfterInvalidEvent,
  workspaceStatsFromSnapshot,
  workspaceStatsStatus,
  type WorkspaceStatsState,
} from "./WorkspaceStats.ts";
import {
  connectWorkspaceStats,
  createWorkspaceAcceptedOpenRecorder,
} from "./useWorkspaceStats.ts";

function contentId(value: string): ContentId {
  const validation = ContentId.tryCreate(value, "workspace stats test content");

  if (validation.kind === "invalid") {
    assert.fail(validation.message);
  }

  return validation.value;
}

function snapshot(options: Readonly<{
  totalSessions: number;
  counts: ReadonlyArray<Readonly<{ id: string; views: number }>>;
  storageState: "writable" | "read-only";
}>): StatsSnapshot {
  const totalPageViews = options.counts.reduce(
    (total, count) => total + count.views,
    0,
  );
  const daily = demoStatsSnapshot.daily.map((bucket, index, buckets) =>
    index === buckets.length - 1
      ? {
          ...bucket,
          sessions: options.totalSessions,
          pageViews: totalPageViews,
        }
      : { ...bucket, sessions: 0, pageViews: 0 }
  );

  return {
    totalSessions: options.totalSessions,
    totalPageViews,
    pageViewsByContent: options.counts.map((count) => ({
      contentId: contentId(count.id),
      pageViews: count.views,
    })),
    daily,
    storageState: options.storageState,
  };
}

const liveSnapshot = snapshot({
  totalSessions: 2,
  counts: [
    { id: "zeta", views: 1 },
    { id: "about", views: 2 },
  ],
  storageState: "writable",
});
const zeroSnapshot = snapshot({
  totalSessions: 0,
  counts: [],
  storageState: "writable",
});
const readOnlySnapshot = snapshot({
  totalSessions: 2,
  counts: [{ id: "about", views: 3 }],
  storageState: "read-only",
});

test("presents live, reconnecting, stale, no-data, loading, and unavailable states", () => {
  const live = workspaceStatsFromSnapshot(liveSnapshot);
  const noData = workspaceStatsFromSnapshot(zeroSnapshot);
  const readOnly = workspaceStatsFromSnapshot(readOnlySnapshot);

  assert.equal(live.kind, "live");
  assert.equal(noData.kind, "no-data");
  assert.equal(readOnly.kind, "stale");
  assert.deepEqual(workspaceStatsStatus(live), {
    label: "LIVE",
    totalSessions: 2,
    totalPageViews: 3,
  });
  assert.equal(workspaceStatsStatus(workspaceStatsAfterDisconnect(live)).label, "RECONNECTING");
  assert.equal(workspaceStatsStatus(workspaceStatsAfterInvalidEvent(live)).label, "STALE");
  assert.equal(workspaceStatsAfterDisconnect({ kind: "loading" }).kind, "unavailable");
  assert.equal(workspaceStatsAfterInvalidEvent({ kind: "loading" }).kind, "unavailable");
  assert.equal(workspaceStatsStatus(noData).label, "NO DATA");
  assert.equal(
    workspaceStatsFromSnapshot({ ...zeroSnapshot, storageState: "read-only" }).kind,
    "no-data",
  );
  assert.equal(workspaceStatsStatus({ kind: "loading" }).label, "UNAVAILABLE");
  assert.equal(workspaceStatsStatus({ kind: "unavailable" }).label, "UNAVAILABLE");
});

test("formats current UTC, sorted content, no-data, stale, and unavailable command output", () => {
  const currentDate = liveSnapshot.daily.at(-1)?.date;

  if (currentDate === undefined) {
    assert.fail("Expected a final daily bucket.");
  }

  const live = formatPortfolioStats({ kind: "live", snapshot: liveSnapshot }, currentDate);
  const stale = formatPortfolioStats({ kind: "stale", snapshot: readOnlySnapshot }, currentDate);
  const noData = formatPortfolioStats({ kind: "no-data", snapshot: zeroSnapshot }, currentDate);

  assert.match(live, /STATUS       LIVE/u);
  assert.match(live, /SESSIONS     2/u);
  assert.match(live, /VIEWS        3/u);
  assert.match(live, new RegExp(`UTC ${currentDate}  SESSIONS 2  VIEWS 3`, "u"));
  assert.equal(live.indexOf("about"), live.lastIndexOf("about"));
  assert.equal(live.indexOf("about") < live.indexOf("zeta"), true);
  assert.match(stale, /STATUS       STALE/u);
  assert.match(noData, /STATUS       NO DATA/u);
  assert.match(noData, /BY CONTENT\n\(none\)$/u);
  assert.equal(
    formatPortfolioStats({ kind: "unavailable" }, currentDate),
    "STATISTICS\nSTATUS       UNAVAILABLE",
  );
});

test("owns one stream lifecycle, retains snapshots through disconnects, and recovers", async () => {
  let listener: (event: StatsStreamEvent) => void = () => undefined;
  let activeStreams = 0;
  let maximumActiveStreams = 0;
  let closeCount = 0;
  let loadSignal: AbortSignal | undefined;
  let resolveLoad: (result: StatsLoadResult) => void = () => undefined;
  const loadResult = new Promise<StatsLoadResult>((resolve) => {
    resolveLoad = resolve;
  });
  const client: StatsClient = {
    loadSnapshot: (signal) => {
      loadSignal = signal;
      return loadResult;
    },
    recordView: () => Promise.resolve({ kind: "recorded", snapshot: liveSnapshot }),
    subscribe: (nextListener) => {
      listener = nextListener;
      activeStreams += 1;
      maximumActiveStreams = Math.max(maximumActiveStreams, activeStreams);
      return {
        close: () => {
          activeStreams -= 1;
          closeCount += 1;
        },
      };
    },
  };
  let state: WorkspaceStatsState = { kind: "loading" };
  const dispatch = (transition: (current: WorkspaceStatsState) => WorkspaceStatsState): void => {
    state = transition(state);
  };
  const stateKind = (): WorkspaceStatsState["kind"] => state.kind;

  const firstCleanup = connectWorkspaceStats(client, dispatch);
  listener({ kind: "snapshot", snapshot: liveSnapshot });
  listener({ kind: "disconnected" });
  assert.equal(stateKind(), "reconnecting");
  listener({ kind: "invalid" });
  assert.equal(stateKind(), "stale");
  listener({ kind: "snapshot", snapshot: zeroSnapshot });
  assert.equal(stateKind(), "no-data");

  firstCleanup();
  assert.equal(loadSignal?.aborted, true);
  assert.equal(activeStreams, 0);
  const stateAfterCleanup = stateKind();
  resolveLoad({ kind: "available", snapshot: readOnlySnapshot });
  await Promise.resolve();
  assert.equal(stateKind(), stateAfterCleanup);

  const secondCleanup = connectWorkspaceStats(client, dispatch);
  assert.equal(activeStreams, 1);
  secondCleanup();

  assert.equal(maximumActiveStreams, 1);
  assert.equal(closeCount, 2);
  assert.equal(activeStreams, 0);
});

test("deduplicates workspace-local accepted content IDs before recording", async () => {
  const recorded: string[] = [];
  const client: StatsClient = {
    loadSnapshot: () => Promise.resolve({ kind: "available", snapshot: liveSnapshot }),
    recordView: (id) => {
      recorded.push(id.value);
      return Promise.resolve({ kind: "recorded", snapshot: liveSnapshot });
    },
    subscribe: () => ({ close: () => undefined }),
  };
  let state: WorkspaceStatsState = { kind: "loading" };
  const dispatch = (transition: (current: WorkspaceStatsState) => WorkspaceStatsState): void => {
    state = transition(state);
  };
  const recorder = createWorkspaceAcceptedOpenRecorder(
    client,
    () => new AbortController().signal,
    dispatch,
  );

  recorder(contentId("about"));
  recorder(contentId("about"));
  recorder(contentId("note"));
  await Promise.resolve();

  assert.deepEqual(recorded, ["about", "note"]);
  assert.equal(state.kind, "live");
});
