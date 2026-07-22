import assert from "node:assert/strict";
import test from "node:test";
import { ContentId } from "../../api/ContentContracts.ts";
import {
  demoStatsSnapshot,
  type StatsClient,
  type StatsLoadResult,
  type StatsSnapshot,
  type StatsPollEvent,
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
const recordedSnapshot = snapshot({
  totalSessions: 4,
  counts: [{ id: "about", views: 5 }],
  storageState: "writable",
});
const olderBootstrapSnapshot = snapshot({
  totalSessions: 1,
  counts: [{ id: "about", views: 1 }],
  storageState: "writable",
});
const newerPollSnapshot = snapshot({
  totalSessions: 1,
  counts: [{ id: "about", views: 2 }],
  storageState: "writable",
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

test("maps non-zero, zero, and read-only polling snapshots to workspace state", async () => {
  const scenarios = [
    { snapshot: liveSnapshot, expectedPollState: "live" },
    { snapshot: zeroSnapshot, expectedPollState: "no-data" },
    { snapshot: readOnlySnapshot, expectedPollState: "stale" },
  ] as const;

  for (const scenario of scenarios) {
    let listener: (event: StatsPollEvent) => void = () => undefined;
    const client: StatsClient = {
      loadSnapshot: () => Promise.resolve({
        kind: "available",
        snapshot: scenario.snapshot,
      }),
      recordView: () => Promise.resolve({
        kind: "recorded",
        snapshot: scenario.snapshot,
      }),
      startPolling: (nextListener) => {
        listener = nextListener;
        return { close: () => undefined };
      },
    };
    let state: WorkspaceStatsState = { kind: "loading" };
    const dispatch = (
      transition: (current: WorkspaceStatsState) => WorkspaceStatsState,
    ): void => {
      state = transition(state);
    };
    const currentState = (): WorkspaceStatsState => state;
    const cleanup = connectWorkspaceStats(client, dispatch);

    listener({ kind: "snapshot", snapshot: scenario.snapshot });
    assert.equal(currentState().kind, scenario.expectedPollState);
    assert.equal(
      workspaceStatsStatus(currentState()).totalPageViews,
      scenario.snapshot.totalPageViews,
    );
    cleanup();
  }
});

test("preserves the latest polling snapshot after a later polling failure", async () => {
  const scenarios = [
    { snapshot: liveSnapshot, loadResult: { kind: "failed", message: "failed" }, expected: "live" },
    { snapshot: zeroSnapshot, loadResult: { kind: "unavailable" }, expected: "no-data" },
    { snapshot: readOnlySnapshot, loadResult: { kind: "failed", message: "failed" }, expected: "stale" },
  ] as const;

  for (const scenario of scenarios) {
    let listener: (event: StatsPollEvent) => void = () => undefined;
    let resolveLoad: (result: StatsLoadResult) => void = () => undefined;
    const loadResult = new Promise<StatsLoadResult>((resolve) => {
      resolveLoad = resolve;
    });
    const client: StatsClient = {
      loadSnapshot: () => loadResult,
      recordView: () => Promise.resolve({
        kind: "recorded",
        snapshot: scenario.snapshot,
      }),
      startPolling: (nextListener) => {
        listener = nextListener;
        return { close: () => undefined };
      },
    };
    let state: WorkspaceStatsState = { kind: "loading" };
    const dispatch = (
      transition: (current: WorkspaceStatsState) => WorkspaceStatsState,
    ): void => {
      state = transition(state);
    };
    const currentState = (): WorkspaceStatsState => state;
    const cleanup = connectWorkspaceStats(client, dispatch);

    listener({ kind: "snapshot", snapshot: scenario.snapshot });
    assert.equal(currentState().kind, scenario.expected);
    resolveLoad(scenario.loadResult);
    await Promise.resolve();
    const afterFailure = currentState();
    assert.equal(afterFailure.kind, scenario.expected);
    if ("snapshot" in afterFailure) {
      assert.strictEqual(afterFailure.snapshot, scenario.snapshot);
    }
    cleanup();
  }
});

test("preserves a newer refreshed polling snapshot when delayed initial polling read completes", async () => {
  let listener: (event: StatsPollEvent) => void = () => undefined;
  let resolveLoad: (result: StatsLoadResult) => void = () => undefined;
  const loadResult = new Promise<StatsLoadResult>((resolve) => {
    resolveLoad = resolve;
  });
  const client: StatsClient = {
    loadSnapshot: () => loadResult,
    recordView: () => Promise.resolve({
      kind: "recorded",
      snapshot: newerPollSnapshot,
    }),
    startPolling: (nextListener) => {
      listener = nextListener;
      return { close: () => undefined };
    },
  };
  let state: WorkspaceStatsState = { kind: "loading" };
  const dispatch = (
    transition: (current: WorkspaceStatsState) => WorkspaceStatsState,
  ): void => {
    state = transition(state);
  };
  const currentState = (): WorkspaceStatsState => state;
  const cleanup = connectWorkspaceStats(client, dispatch);

  listener({ kind: "snapshot", snapshot: newerPollSnapshot });
  listener({ kind: "unavailable" });
  resolveLoad({ kind: "available", snapshot: olderBootstrapSnapshot });
  await Promise.resolve();

  const afterBootstrap = currentState();
  assert.equal(afterBootstrap.kind, "reconnecting");
  if (afterBootstrap.kind === "reconnecting") {
    assert.strictEqual(afterBootstrap.snapshot, newerPollSnapshot);
    assert.equal(afterBootstrap.snapshot.totalPageViews, 2);
  }
  cleanup();
});

test("record responses update retained data without promoting reconnecting or stale lifecycle", async () => {
  const client: StatsClient = {
    loadSnapshot: () => Promise.resolve({ kind: "available", snapshot: liveSnapshot }),
    recordView: () => Promise.resolve({
      kind: "recorded",
      snapshot: recordedSnapshot,
    }),
    startPolling: () => ({ close: () => undefined }),
  };
  const signal = new AbortController().signal;
  let reconnecting: WorkspaceStatsState = {
    kind: "reconnecting",
    snapshot: liveSnapshot,
  };
  const reconnectingRecorder = createWorkspaceAcceptedOpenRecorder(
    client,
    () => signal,
    (transition) => {
      reconnecting = transition(reconnecting);
    },
  );
  let stale: WorkspaceStatsState = {
    kind: "stale",
    snapshot: readOnlySnapshot,
  };
  const staleRecorder = createWorkspaceAcceptedOpenRecorder(
    client,
    () => signal,
    (transition) => {
      stale = transition(stale);
    },
  );
  const zeroClient: StatsClient = {
    ...client,
    recordView: () => Promise.resolve({
      kind: "recorded",
      snapshot: zeroSnapshot,
    }),
  };
  let live: WorkspaceStatsState = {
    kind: "live",
    snapshot: liveSnapshot,
  };
  const liveRecorder = createWorkspaceAcceptedOpenRecorder(
    zeroClient,
    () => signal,
    (transition) => {
      live = transition(live);
    },
  );
  const currentLive = (): WorkspaceStatsState => live;

  reconnectingRecorder(contentId("about"));
  staleRecorder(contentId("note"));
  liveRecorder(contentId("zeta"));
  await Promise.resolve();

  assert.equal(reconnecting.kind, "reconnecting");
  assert.equal(stale.kind, "stale");
  assert.equal(currentLive().kind, "no-data");
  if (reconnecting.kind === "reconnecting" && stale.kind === "stale") {
    assert.strictEqual(reconnecting.snapshot, recordedSnapshot);
    assert.strictEqual(stale.snapshot, recordedSnapshot);
  }
});

test("owns one polling lifecycle, retains snapshots through poll failures, and recovers", async () => {
  let listener: (event: StatsPollEvent) => void = () => undefined;
  let activePollers = 0;
  let maximumActivePollers = 0;
  let closeCount = 0;
  const client: StatsClient = {
    loadSnapshot: () => Promise.resolve({ kind: "available", snapshot: liveSnapshot }),
    recordView: () => Promise.resolve({ kind: "recorded", snapshot: liveSnapshot }),
    startPolling: (nextListener) => {
      listener = nextListener;
      activePollers += 1;
      maximumActivePollers = Math.max(maximumActivePollers, activePollers);
      return {
        close: () => {
          activePollers -= 1;
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
  listener({ kind: "unavailable" });
  assert.equal(stateKind(), "reconnecting");
  listener({ kind: "invalid" });
  assert.equal(stateKind(), "stale");
  listener({ kind: "snapshot", snapshot: zeroSnapshot });
  assert.equal(stateKind(), "no-data");

  firstCleanup();
  assert.equal(activePollers, 0);
  const stateAfterCleanup = stateKind();
  assert.equal(stateKind(), stateAfterCleanup);

  const secondCleanup = connectWorkspaceStats(client, dispatch);
  assert.equal(activePollers, 1);
  secondCleanup();

  assert.equal(maximumActivePollers, 1);
  assert.equal(closeCount, 2);
  assert.equal(activePollers, 0);
});

test("deduplicates workspace-local accepted content IDs before recording", async () => {
  const recorded: string[] = [];
  const client: StatsClient = {
    loadSnapshot: () => Promise.resolve({ kind: "available", snapshot: liveSnapshot }),
    recordView: (id) => {
      recorded.push(id.value);
      return Promise.resolve({ kind: "recorded", snapshot: liveSnapshot });
    },
    startPolling: () => ({ close: () => undefined }),
  };
  let state: WorkspaceStatsState = { kind: "loading" };
  const dispatch = (transition: (current: WorkspaceStatsState) => WorkspaceStatsState): void => {
    state = transition(state);
  };
  const currentState = (): WorkspaceStatsState => state;
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
  const afterRecords = currentState();
  assert.equal(afterRecords.kind, "reconnecting");
  if (afterRecords.kind === "reconnecting") {
    assert.strictEqual(afterRecords.snapshot, liveSnapshot);
  }
});
