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
import { ContentId } from "./ContentContracts.ts";


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
  | Readonly<{ kind: "unavailable" }>;

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

function mapStorageState(value: StatsStorageState): "writable" | "read-only" {
  switch (value) {
    case StatsStorageState.WRITABLE:
      return "writable";
    case StatsStorageState.READ_ONLY:
      return "read-only";
    case StatsStorageState.UNSPECIFIED:
    default:
      throw new Error("The generated statistics storage state is unsupported.");
  }
}

function mapSnapshot(message: StatsSnapshotMessage): StatsSnapshot {
  return {
    totalSessions: Number(message.totalSessions),
    totalPageViews: Number(message.totalPageViews),
    pageViewsByContent: message.pageViewsByContent.map((count) => ({
      contentId: { value: count.contentId },
      pageViews: Number(count.pageViews),
    })),
    daily: message.daily.map((count) => ({
      date: count.date,
      sessions: Number(count.sessions),
      pageViews: Number(count.pageViews),
    })),
    storageState: mapStorageState(message.storageState),
  };
}

export class GrpcStatsClient implements StatsClient {
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
    let response: StatsSnapshotMessage;

    try {
      response = await this.client.readSnapshot(
        {},
        { meta: this.context.metadata(), abort: signal },
      ).response;
    } catch (error: unknown) {
      if (signal.aborted || isAbortError(error)) {
        return { kind: "cancelled" };
      }

      return error instanceof RpcError && error.code === "UNAVAILABLE"
        ? { kind: "unavailable" }
        : { kind: "failed", message: "The statistics API could not be reached." };
    }

    return { kind: "available", snapshot: mapSnapshot(response) };
  }

  async recordView(contentId: ContentId, signal: AbortSignal): Promise<StatsRecordResult> {
    let response: StatsSnapshotMessage;

    try {
      response = await this.client.recordView(
        { contentId: contentId.value },
        { meta: this.context.metadata(), abort: signal },
      ).response;
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

    return { kind: "recorded", snapshot: mapSnapshot(response) };
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
