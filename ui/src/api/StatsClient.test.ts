import assert from "node:assert/strict";
import test from "node:test";
import {
  DemoStatsClient,
  HttpStatsClient,
  StatsContentId,
  demoStatsSnapshot,
  validateStatsSnapshot,
} from "./StatsClient.ts";

function wireSnapshot(): unknown {
  return {
    totalSessions: demoStatsSnapshot.totalSessions,
    totalPageViews: demoStatsSnapshot.totalPageViews,
    pageViewsByContent: Object.fromEntries(
      demoStatsSnapshot.pageViewsByContent.map((count) => [
        count.contentId.value,
        count.pageViews,
      ]),
    ),
    daily: demoStatsSnapshot.daily,
    storageState: demoStatsSnapshot.storageState,
  };
}

function contentId(value: string): StatsContentId {
  const validation = StatsContentId.tryCreate(value, "test content");

  if (validation.kind === "invalid") {
    assert.fail(validation.message);
  }

  return validation.value;
}

test("validates exact consecutive statistics snapshots", () => {
  const valid = validateStatsSnapshot(wireSnapshot());
  assert.equal(valid.kind, "valid");

  const invalidDaily = wireSnapshot();

  if (typeof invalidDaily !== "object" || invalidDaily === null) {
    assert.fail("Expected a statistics object fixture.");
  }

  Reflect.set(invalidDaily, "daily", demoStatsSnapshot.daily.slice(1));
  assert.equal(validateStatsSnapshot(invalidDaily).kind, "invalid");

  const mismatchedTotal = wireSnapshot();

  if (typeof mismatchedTotal !== "object" || mismatchedTotal === null) {
    assert.fail("Expected a statistics object fixture.");
  }

  Reflect.set(mismatchedTotal, "totalPageViews", 511);
  assert.equal(validateStatsSnapshot(mismatchedTotal).kind, "invalid");
});

test("uses the focused live HTTP and SSE statistics endpoints", async () => {
  const capturedRequests: Array<Readonly<{ path: string; init: RequestInit | undefined }>> = [];
  const fetchStats: typeof fetch = async (input, init) => {
    let path: string;

    if (typeof input === "string") {
      path = input;
    } else if (input instanceof URL) {
      path = input.pathname;
    } else {
      path = new URL(input.url).pathname;
    }

    capturedRequests.push({ path, init });
    return Response.json(wireSnapshot());
  };
  let closed = false;
  const source: {
    onmessage: ((event: MessageEvent<string>) => void) | null;
    onerror: ((event: Event) => void) | null;
    close: () => void;
  } = {
    onmessage: null,
    onerror: null,
    close: () => {
      closed = true;
    },
  };
  const openedPaths: string[] = [];
  const client = new HttpStatsClient({
    fetch: fetchStats,
    openEventSource: (path) => {
      openedPaths.push(path);
      return source;
    },
  });
  const controller = new AbortController();

  const loaded = await client.loadSnapshot(controller.signal);
  assert.equal(loaded.kind, "available");

  const recorded = await client.recordView(contentId("about"), controller.signal);
  assert.equal(recorded.kind, "recorded");
  assert.deepEqual(capturedRequests.map((request) => request.path), [
    "/api/stats",
    "/api/stats/view",
  ]);
  assert.equal(capturedRequests[1]?.init?.method, "POST");
  assert.equal(capturedRequests[1]?.init?.signal, controller.signal);
  assert.equal(capturedRequests[1]?.init?.body, '{"contentId":"about"}');

  const events: string[] = [];
  const subscription = client.subscribe((event) => events.push(event.kind));
  assert.deepEqual(openedPaths, ["/api/stats/events"]);
  source.onmessage?.(
    new MessageEvent<string>("message", { data: JSON.stringify(wireSnapshot()) }),
  );
  source.onerror?.(new Event("error"));
  assert.deepEqual(events, ["snapshot", "disconnected"]);

  subscription.close();
  assert.equal(source.onmessage, null);
  assert.equal(source.onerror, null);
  assert.equal(closed, true);
});

function restoreProperty(
  target: object,
  name: PropertyKey,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor === undefined) {
    Reflect.deleteProperty(target, name);
    return;
  }

  Object.defineProperty(target, name, descriptor);
}

test("DemoStatsClient performs no network, storage, timer, or random work", async () => {
  const guardedNames = [
    "fetch",
    "EventSource",
    "localStorage",
    "sessionStorage",
    "setTimeout",
    "setInterval",
    "crypto",
  ];
  const descriptors = new Map(
    guardedNames.map((name) => [
      name,
      Object.getOwnPropertyDescriptor(globalThis, name),
    ]),
  );
  const originalRandom = Math.random;
  const forbidden = (): never => {
    throw new Error("Demo statistics attempted an external side effect.");
  };

  try {
    for (const name of guardedNames) {
      Object.defineProperty(globalThis, name, {
        configurable: true,
        get: forbidden,
        set: forbidden,
      });
    }

    Math.random = forbidden;
    const client = new DemoStatsClient();
    const controller = new AbortController();
    const loaded = await client.loadSnapshot(controller.signal);
    const recorded = await client.recordView(contentId("about"), controller.signal);
    const events: string[] = [];
    const subscription = client.subscribe((event) => events.push(event.kind));
    subscription.close();

    assert.equal(loaded.kind, "available");
    assert.equal(recorded.kind, "recorded");
    assert.deepEqual(events, ["snapshot"]);
  } finally {
    Math.random = originalRandom;

    for (const name of guardedNames) {
      restoreProperty(globalThis, name, descriptors.get(name));
    }
  }
});
