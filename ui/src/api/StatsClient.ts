import { apiPathPrefix } from "./ApiPath.ts";
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

export type StatsStreamEvent =
  | Readonly<{ kind: "snapshot"; snapshot: StatsSnapshot }>
  | Readonly<{ kind: "disconnected" }>
  | Readonly<{ kind: "invalid" }>;

export type StatsSubscription = Readonly<{
  close: () => void;
}>;

export type StatsClient = Readonly<{
  loadSnapshot: (signal: AbortSignal) => Promise<StatsLoadResult>;
  recordView: (
    contentId: ContentId,
    signal: AbortSignal,
  ) => Promise<StatsRecordResult>;
  subscribe: (listener: (event: StatsStreamEvent) => void) => StatsSubscription;
}>;

type StatsEventSource = {
  onmessage: ((event: MessageEvent<string>) => void) | null;
  onerror: ((event: Event) => void) | null;
  close: () => void;
};

export type HttpStatsClientDependencies = Readonly<{
  fetch: typeof fetch;
  openEventSource: (path: string) => StatsEventSource;
}>;

function statsApiPath(path: string): string {
  return `${apiPathPrefix}/stats${path}`;
}

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

type ResponsePayload =
  | Readonly<{ kind: "payload"; value: unknown }>
  | Readonly<{ kind: "invalid" }>;

async function responsePayload(response: Response): Promise<ResponsePayload> {
  try {
    return { kind: "payload", value: await response.json() };
  } catch {
    return { kind: "invalid" };
  }
}

const liveDependencies: HttpStatsClientDependencies = {
  fetch: (input, init) => globalThis.fetch(input, init),
  openEventSource: (path) => new EventSource(path),
};

export class HttpStatsClient implements StatsClient {
  private readonly dependencies: HttpStatsClientDependencies;

  constructor(dependencies: HttpStatsClientDependencies = liveDependencies) {
    this.dependencies = dependencies;
  }

  async loadSnapshot(signal: AbortSignal): Promise<StatsLoadResult> {
    try {
      const response = await this.dependencies.fetch(statsApiPath(""), {
        signal,
        headers: { Accept: "application/json" },
      });

      if (response.status === 503) {
        return { kind: "unavailable" };
      }

      const payload = await responsePayload(response);

      if (!response.ok) {
        return { kind: "failed", message: "The statistics API rejected the request." };
      }

      if (payload.kind === "invalid") {
        return { kind: "failed", message: "The statistics API returned invalid JSON." };
      }

      const validation = validateStatsSnapshot(payload.value);

      return validation.kind === "valid"
        ? { kind: "available", snapshot: validation.value }
        : { kind: "failed", message: "The statistics API returned an invalid snapshot." };
    } catch (error: unknown) {
      if (signal.aborted || isAbortError(error)) {
        return { kind: "cancelled" };
      }

      return { kind: "failed", message: "The statistics API could not be reached." };
    }
  }

  async recordView(
    contentId: ContentId,
    signal: AbortSignal,
  ): Promise<StatsRecordResult> {
    try {
      const response = await this.dependencies.fetch(statsApiPath("/view"), {
        method: "POST",
        signal,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ contentId: contentId.value }),
      });

      if (response.status === 429) {
        return { kind: "rate-limited" };
      }

      if (response.status === 503) {
        return { kind: "unavailable" };
      }

      const payload = await responsePayload(response);

      if (!response.ok) {
        return { kind: "failed", message: "The statistics view was rejected." };
      }

      if (payload.kind === "invalid") {
        return { kind: "failed", message: "The statistics API returned invalid JSON." };
      }

      const validation = validateStatsSnapshot(payload.value);

      return validation.kind === "valid"
        ? { kind: "recorded", snapshot: validation.value }
        : { kind: "failed", message: "The statistics API returned an invalid snapshot." };
    } catch (error: unknown) {
      if (signal.aborted || isAbortError(error)) {
        return { kind: "cancelled" };
      }

      return { kind: "failed", message: "The statistics view could not be recorded." };
    }
  }

  subscribe(listener: (event: StatsStreamEvent) => void): StatsSubscription {
    const source = this.dependencies.openEventSource(statsApiPath("/events"));

    source.onmessage = (event) => {
      try {
        const validation = validateStatsSnapshot(JSON.parse(event.data));

        listener(
          validation.kind === "valid"
            ? { kind: "snapshot", snapshot: validation.value }
            : { kind: "invalid" },
        );
      } catch {
        listener({ kind: "invalid" });
      }
    };
    source.onerror = () => listener({ kind: "disconnected" });

    return {
      close: () => {
        source.onmessage = null;
        source.onerror = null;
        source.close();
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

  subscribe(listener: (event: StatsStreamEvent) => void): StatsSubscription {
    listener({ kind: "snapshot", snapshot: demoStatsSnapshot });

    return { close: () => undefined };
  }
}
