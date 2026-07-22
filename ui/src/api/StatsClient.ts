import { RpcError, type RpcMetadata } from "@protobuf-ts/runtime-rpc";
import {
  StatsStorageState,
  type StatsSnapshot as StatsSnapshotMessage,
} from "../generated/browser/browser.ts";
import { StatisticsApiClient } from "../generated/browser/browser.client.ts";
import {
  BrowserGrpcContext,
  createBrowserGrpcTransport,
} from "./BrowserGrpcContext.ts";
import { ContentId, type ContentValidation } from "./ContentContracts.ts";

export type StatsValidation<Value> = ContentValidation<Value>;

export type StatsDailyCount = Readonly<{
  date: string;
  sessions: number;
  pageViews: number;
}>;

export type StatsContentCount = Readonly<{
  contentId: ContentId;
  pageViews: number;
}>;

export type StatsSnapshot = Readonly<{
  totalSessions: number;
  totalPageViews: number;
  pageViewsByContent: ReadonlyArray<StatsContentCount>;
  daily: ReadonlyArray<StatsDailyCount>;
  storageState: "writable" | "read-only";
}>;

export type StatsLoadResult =
  | Readonly<{ kind: "available"; snapshot: StatsSnapshot }>
  | Readonly<{ kind: "unavailable" }>
  | Readonly<{ kind: "cancelled" }>
  | Readonly<{ kind: "failed"; message: string }>;

export type StatsRecordResult =
  | Readonly<{ kind: "recorded"; snapshot: StatsSnapshot }>
  | Readonly<{ kind: "rate-limited" }>
  | Readonly<{ kind: "unavailable" }>
  | Readonly<{ kind: "cancelled" }>
  | Readonly<{ kind: "failed"; message: string }>;

export type StatsPollEvent =
  | Readonly<{ kind: "snapshot"; snapshot: StatsSnapshot }>
  | Readonly<{ kind: "unavailable" }>
  | Readonly<{ kind: "invalid" }>;

export type StatsPolling = Readonly<{
  close: () => void;
}>;

export type StatsClient = Readonly<{
  loadSnapshot: (signal: AbortSignal) => Promise<StatsLoadResult>;
  recordView: (
    contentId: ContentId,
    signal: AbortSignal,
  ) => Promise<StatsRecordResult>;
  startPolling: (listener: (event: StatsPollEvent) => void) => StatsPolling;
}>;

type StatsRpcClient = Readonly<{
  readSnapshot: (
    request: Readonly<Record<string, never>>,
    options: Readonly<{ meta: RpcMetadata; abort: AbortSignal }>,
  ) => Readonly<{ response: Promise<StatsSnapshotMessage> }>;
  recordView: (
    request: Readonly<{ contentId: string }>,
    options: Readonly<{ meta: RpcMetadata; abort: AbortSignal }>,
  ) => Readonly<{ response: Promise<StatsSnapshotMessage> }>;
}>;

type PollScheduler = Readonly<{
  set: (callback: () => void, milliseconds: number) => ReturnType<typeof setTimeout>;
  clear: (timer: ReturnType<typeof setTimeout>) => void;
}>;

const pollIntervalMilliseconds = 30_000;
const liveScheduler: PollScheduler = {
  set: (callback, milliseconds) => globalThis.setTimeout(callback, milliseconds),
  clear: (timer) => globalThis.clearTimeout(timer),
};

function isAbortError(value: unknown): boolean {
  return value instanceof Error && value.name === "AbortError";
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function property(value: object, name: string): unknown {
  return Object.hasOwn(value, name) ? Reflect.get(value, name) : undefined;
}

function validateNonNegativeInteger(value: unknown): StatsValidation<number> {
  return typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0
    ? { kind: "valid", value }
    : { kind: "invalid", message: "The count must be a non-negative integer." };
}

function validateDailyCount(
  value: unknown,
  index: number,
): StatsValidation<StatsDailyCount> {
  if (!isObject(value)) {
    return { kind: "invalid", message: `daily[${index}] must be an object.` };
  }

  const date = property(value, "date");
  const sessions = validateNonNegativeInteger(property(value, "sessions"));
  const pageViews = validateNonNegativeInteger(property(value, "pageViews"));
  const datePattern = /^\d{4}-\d{2}-\d{2}$/u;

  if (
    typeof date !== "string" ||
    !datePattern.test(date) ||
    !Number.isFinite(Date.parse(`${date}T00:00:00.000Z`)) ||
    new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date ||
    sessions.kind === "invalid" ||
    pageViews.kind === "invalid"
  ) {
    return { kind: "invalid", message: `daily[${index}] is invalid.` };
  }

  return {
    kind: "valid",
    value: { date, sessions: sessions.value, pageViews: pageViews.value },
  };
}

function validateDaily(value: unknown): StatsValidation<ReadonlyArray<StatsDailyCount>> {
  if (!Array.isArray(value) || value.length !== 400) {
    return { kind: "invalid", message: "daily must contain exactly 400 buckets." };
  }

  const counts: StatsDailyCount[] = [];

  for (const [index, candidate] of value.entries()) {
    const validation = validateDailyCount(candidate, index);

    if (validation.kind === "invalid") {
      return validation;
    }

    const previous = counts.at(-1);

    if (previous !== undefined) {
      const expected = new Date(`${previous.date}T00:00:00.000Z`);
      expected.setUTCDate(expected.getUTCDate() + 1);

      if (validation.value.date !== expected.toISOString().slice(0, 10)) {
        return { kind: "invalid", message: "daily buckets must be consecutive UTC dates." };
      }
    }

    counts.push(validation.value);
  }

  return { kind: "valid", value: counts };
}

function validateContentCounts(
  value: unknown,
): StatsValidation<ReadonlyArray<StatsContentCount>> {
  if (!isObject(value)) {
    return { kind: "invalid", message: "pageViewsByContent must be an object." };
  }

  const counts: StatsContentCount[] = [];

  for (const contentIdValue of Object.keys(value).sort()) {
    const contentId = ContentId.tryCreate(
      contentIdValue,
      "pageViewsByContent key",
    );
    const pageViews = validateNonNegativeInteger(property(value, contentIdValue));

    if (contentId.kind === "invalid" || pageViews.kind === "invalid") {
      return { kind: "invalid", message: "pageViewsByContent is invalid." };
    }

    counts.push({ contentId: contentId.value, pageViews: pageViews.value });
  }

  return { kind: "valid", value: counts };
}

export function validateStatsSnapshot(
  value: unknown,
): StatsValidation<StatsSnapshot> {
  if (!isObject(value)) {
    return { kind: "invalid", message: "The statistics snapshot must be an object." };
  }

  const totalSessions = validateNonNegativeInteger(property(value, "totalSessions"));
  const totalPageViews = validateNonNegativeInteger(property(value, "totalPageViews"));
  const contentCounts = validateContentCounts(property(value, "pageViewsByContent"));
  const daily = validateDaily(property(value, "daily"));
  const storageState = property(value, "storageState");

  if (
    totalSessions.kind === "invalid" ||
    totalPageViews.kind === "invalid" ||
    contentCounts.kind === "invalid" ||
    daily.kind === "invalid" ||
    (storageState !== "writable" && storageState !== "read-only")
  ) {
    return { kind: "invalid", message: "The statistics snapshot is invalid." };
  }

  let countedPageViews = 0;

  for (const count of contentCounts.value) {
    countedPageViews += count.pageViews;
  }

  if (countedPageViews !== totalPageViews.value) {
    return { kind: "invalid", message: "Statistics content totals do not match." };
  }

  return {
    kind: "valid",
    value: {
      totalSessions: totalSessions.value,
      totalPageViews: totalPageViews.value,
      pageViewsByContent: contentCounts.value,
      daily: daily.value,
      storageState,
    },
  };
}

function safeCount(value: bigint): number | undefined {
  return value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(value)
    : undefined;
}

function decodedSnapshot(message: StatsSnapshotMessage): StatsValidation<StatsSnapshot> {
  const pageViewsByContent: Record<string, number> = {};

  for (const count of message.pageViewsByContent) {
    const pageViews = safeCount(count.pageViews);

    if (pageViews === undefined || Object.hasOwn(pageViewsByContent, count.contentId)) {
      return { kind: "invalid", message: "The statistics snapshot is invalid." };
    }

    pageViewsByContent[count.contentId] = pageViews;
  }

  const daily = message.daily.map((count) => ({
    date: count.date,
    sessions: safeCount(count.sessions),
    pageViews: safeCount(count.pageViews),
  }));
  const totalSessions = safeCount(message.totalSessions);
  const totalPageViews = safeCount(message.totalPageViews);
  const storageState = message.storageState === StatsStorageState.WRITABLE
    ? "writable"
    : message.storageState === StatsStorageState.READ_ONLY
    ? "read-only"
    : "invalid";

  return validateStatsSnapshot({
    totalSessions,
    totalPageViews,
    pageViewsByContent,
    daily,
    storageState,
  });
}

export class HttpStatsClient implements StatsClient {
  private readonly context: BrowserGrpcContext;
  private readonly client: StatsRpcClient;
  private readonly scheduler: PollScheduler;

  constructor(
    context: BrowserGrpcContext,
    client: StatsRpcClient = new StatisticsApiClient(createBrowserGrpcTransport()),
    scheduler: PollScheduler = liveScheduler,
  ) {
    this.context = context;
    this.client = client;
    this.scheduler = scheduler;
  }

  async loadSnapshot(signal: AbortSignal): Promise<StatsLoadResult> {
    try {
      const response = await this.client.readSnapshot(
        {},
        { meta: this.context.metadata(), abort: signal },
      ).response;
      const validation = decodedSnapshot(response);
      return validation.kind === "valid"
        ? { kind: "available", snapshot: validation.value }
        : { kind: "failed", message: "The statistics API returned an invalid snapshot." };
    } catch (error: unknown) {
      if (signal.aborted || isAbortError(error)) {
        return { kind: "cancelled" };
      }

      return error instanceof RpcError && error.code === "UNAVAILABLE"
        ? { kind: "unavailable" }
        : { kind: "failed", message: "The statistics API could not be reached." };
    }
  }

  async recordView(contentId: ContentId, signal: AbortSignal): Promise<StatsRecordResult> {
    try {
      const response = await this.client.recordView(
        { contentId: contentId.value },
        { meta: this.context.metadata(), abort: signal },
      ).response;
      const validation = decodedSnapshot(response);
      return validation.kind === "valid"
        ? { kind: "recorded", snapshot: validation.value }
        : { kind: "failed", message: "The statistics API returned an invalid snapshot." };
    } catch (error: unknown) {
      if (signal.aborted || isAbortError(error)) {
        return { kind: "cancelled" };
      }

      if (error instanceof RpcError && error.code === "RESOURCE_EXHAUSTED") {
        return { kind: "rate-limited" };
      }

      return error instanceof RpcError && error.code === "UNAVAILABLE"
        ? { kind: "unavailable" }
        : { kind: "failed", message: "The statistics view could not be recorded." };
    }
  }

  startPolling(listener: (event: StatsPollEvent) => void): StatsPolling {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    const poll = async (): Promise<void> => {
      const result = await this.loadSnapshot(controller.signal);

      if (closed) {
        return;
      }

      if (result.kind === "available") {
        listener({ kind: "snapshot", snapshot: result.snapshot });
      } else if (result.kind !== "cancelled") {
        listener({ kind: "unavailable" });
      }

      timer = this.scheduler.set(() => void poll(), pollIntervalMilliseconds);
    };

    void poll();

    return {
      close: () => {
        closed = true;
        controller.abort();

        if (timer !== undefined) {
          this.scheduler.clear(timer);
        }
      },
    };
  }
}

function demoDailyCounts(): ReadonlyArray<StatsDailyCount> {
  const firstDate = new Date("2025-06-12T00:00:00.000Z");
  const counts: StatsDailyCount[] = [];

  for (let offset = 0; offset < 400; offset += 1) {
    const date = new Date(firstDate);
    date.setUTCDate(date.getUTCDate() + offset);
    const isToday = offset === 399;
    counts.push({
      date: date.toISOString().slice(0, 10),
      sessions: isToday ? 3 : 0,
      pageViews: isToday ? 5 : 0,
    });
  }

  return counts;
}

function requiredContentId(value: string): ContentId {
  const validation = ContentId.tryCreate(value, "demo content");

  if (validation.kind === "invalid") {
    throw new Error(validation.message);
  }

  return validation.value;
}

export const demoStatsSnapshot: StatsSnapshot = Object.freeze({
  totalSessions: 128,
  totalPageViews: 512,
  pageViewsByContent: Object.freeze([
    Object.freeze({
      contentId: requiredContentId("about"),
      pageViews: 512,
    }),
  ]),
  daily: Object.freeze(demoDailyCounts()),
  storageState: "writable",
});

export class DemoStatsClient implements StatsClient {
  loadSnapshot(signal: AbortSignal): Promise<StatsLoadResult> {
    return Promise.resolve(
      signal.aborted
        ? { kind: "cancelled" }
        : { kind: "available", snapshot: demoStatsSnapshot },
    );
  }

  recordView(
    _contentId: ContentId,
    signal: AbortSignal,
  ): Promise<StatsRecordResult> {
    return Promise.resolve(
      signal.aborted
        ? { kind: "cancelled" }
        : { kind: "recorded", snapshot: demoStatsSnapshot },
    );
  }

  startPolling(listener: (event: StatsPollEvent) => void): StatsPolling {
    listener({ kind: "snapshot", snapshot: demoStatsSnapshot });

    return { close: () => undefined };
  }
}
