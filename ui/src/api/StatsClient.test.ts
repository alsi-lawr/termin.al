import assert from "node:assert/strict";
import test from "node:test";
import type { RpcMetadata } from "@protobuf-ts/runtime-rpc";
import {
  StatsDailyCount,
  StatsSnapshot,
  StatsStorageState,
} from "../generated/browser/browser.ts";
import { BrowserGrpcContext, csrfToken } from "./BrowserGrpcContext.ts";
import { ContentId } from "./ContentContracts.ts";
import {
  DemoStatsClient,
  GrpcStatsClient,
  demoStatsSnapshot,
} from "./StatsClient.ts";

function generatedSnapshot(): StatsSnapshot {
  return StatsSnapshot.create({
    totalSessions: 128n,
    totalPageViews: 512n,
    pageViewsByContent: [{ contentId: "about", pageViews: 512n }],
    daily: demoStatsSnapshot.daily.map((count) => StatsDailyCount.create({
      date: count.date,
      sessions: BigInt(count.sessions),
      pageViews: BigInt(count.pageViews),
    })),
    storageState: StatsStorageState.WRITABLE,
  });
}

function contentId(value: string): ContentId {
  const validation = ContentId.tryCreate(value, "test content");
  if (validation.kind === "invalid") assert.fail(validation.message);
  return validation.value;
}

test("uses generated unary calls and one non-overlapping 30-second polling lifecycle", async () => {
  const context = new BrowserGrpcContext();
  const token = csrfToken("statistics-antiforgery-token");
  if (token === undefined) assert.fail("Expected valid antiforgery fixture.");
  context.recordCsrfToken(token);
  const calls: Array<Readonly<{ method: string; meta: RpcMetadata; abort: AbortSignal }>> = [];
  const scheduled: Array<Readonly<{ callback: () => void; milliseconds: number }>> = [];
  const client = new GrpcStatsClient(context, {
    readSnapshot: (_request, options) => {
      calls.push({ method: "read", meta: options.meta, abort: options.abort });
      return { response: Promise.resolve(generatedSnapshot()) };
    },
    recordView: (request, options) => {
      assert.equal(request.contentId, "about");
      calls.push({ method: "record", meta: options.meta, abort: options.abort });
      return { response: Promise.resolve(generatedSnapshot()) };
    },
  }, {
    set: (callback, milliseconds) => {
      scheduled.push({ callback, milliseconds });
      return {} as ReturnType<typeof setTimeout>;
    },
    clear: () => undefined,
  });
  const signal = new AbortController().signal;
  assert.equal((await client.loadSnapshot(signal)).kind, "available");
  assert.equal((await client.recordView(contentId("about"), signal)).kind, "recorded");

  const events: string[] = [];
  const polling = client.startPolling((event) => events.push(event.kind));
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(events, ["snapshot"]);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0]?.milliseconds, 30_000);
  assert.equal(calls.every((call) => call.meta["X-CSRF-TOKEN"] === "statistics-antiforgery-token"), true);
  scheduled[0]?.callback();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(scheduled.length, 2);
  polling.close();
  assert.equal(calls.at(-1)?.abort.aborted, true);
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
    const polling = client.startPolling((event) => events.push(event.kind));
    polling.close();

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
