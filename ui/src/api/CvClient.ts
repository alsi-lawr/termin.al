import { RpcError, type RpcMetadata } from "@protobuf-ts/runtime-rpc";
import type { CvDocumentResponse, EmptyRequest } from "../generated/browser/browser.ts";
import { CvApiClient } from "../generated/browser/browser.client.ts";
import {
  BrowserGrpcContext,
  createBrowserGrpcTransport,
} from "./BrowserGrpcContext.ts";
import { DemoCapabilityState, type SessionClient } from "./SessionClient.ts";

export type CvViewerKey = string & { readonly __brand: "CvViewerKey" };

export type CvKeyResult =
  | Readonly<{ kind: "valid"; key: CvViewerKey }>
  | Readonly<{ kind: "invalid" }>;

export type CvAccessResult =
  | Readonly<{ kind: "unlocked" }>
  | Readonly<{ kind: "locked" }>
  | Readonly<{ kind: "failed"; message: "CV access failed." }>;

export type CvDocumentResult =
  | Readonly<{ kind: "available"; markdown: string }>
  | Readonly<{ kind: "locked" }>
  | Readonly<{ kind: "failed"; message: "CV access failed." }>;

export interface CvClient {
  unlock(key: CvViewerKey, signal: AbortSignal): Promise<CvAccessResult>;
  lock(signal: AbortSignal): Promise<CvAccessResult>;
  read(signal: AbortSignal): Promise<CvDocumentResult>;
}

type CvRpcClient = Readonly<{
  unlock: (
    request: Readonly<{ key: string }>,
    options: Readonly<{ meta: RpcMetadata; abort: AbortSignal }>,
  ) => Readonly<{ response: Promise<EmptyRequest> }>;
  lock: (
    request: Readonly<Record<string, never>>,
    options: Readonly<{ meta: RpcMetadata; abort: AbortSignal }>,
  ) => Readonly<{ response: Promise<EmptyRequest> }>;
  read: (
    request: Readonly<Record<string, never>>,
    options: Readonly<{ meta: RpcMetadata; abort: AbortSignal }>,
  ) => Readonly<{ response: Promise<CvDocumentResponse> }>;
}>;

const cvAccessFailed = {
  kind: "failed",
  message: "CV access failed.",
} as const satisfies CvAccessResult;

const cvDocumentFailed = {
  kind: "failed",
  message: "CV access failed.",
} as const satisfies CvDocumentResult;

export function cvViewerKeyFrom(value: string): CvKeyResult {
  return value.length >= 32 && value.length <= 256
    ? { kind: "valid", key: value as CvViewerKey }
    : { kind: "invalid" };
}

export class GrpcCvClient implements CvClient {
  private readonly context: BrowserGrpcContext;
  private readonly sessionClient: SessionClient;
  private readonly client: CvRpcClient;

  constructor(
    context: BrowserGrpcContext,
    sessionClient: SessionClient,
    client: CvRpcClient = new CvApiClient(createBrowserGrpcTransport()),
  ) {
    this.context = context;
    this.sessionClient = sessionClient;
    this.client = client;
  }

  private async prepareMutation(signal: AbortSignal): Promise<boolean> {
    const session = await this.sessionClient.read(signal);
    return session.kind === "available";
  }

  async unlock(key: CvViewerKey, signal: AbortSignal): Promise<CvAccessResult> {
    if (!await this.prepareMutation(signal)) {
      return cvAccessFailed;
    }

    try {
      await this.client.unlock(
        { key },
        { meta: this.context.metadata(), abort: signal },
      ).response;
      return { kind: "unlocked" };
    } catch (error: unknown) {
      if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }

      return cvAccessFailed;
    }
  }

  async lock(signal: AbortSignal): Promise<CvAccessResult> {
    if (!await this.prepareMutation(signal)) {
      return cvAccessFailed;
    }

    try {
      await this.client.lock(
        {},
        { meta: this.context.metadata(), abort: signal },
      ).response;
      return { kind: "locked" };
    } catch (error: unknown) {
      if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }

      return cvAccessFailed;
    }
  }

  async read(signal: AbortSignal): Promise<CvDocumentResult> {
    try {
      const response = await this.client.read(
        {},
        { meta: this.context.metadata(), abort: signal },
      ).response;

      return { kind: "available", markdown: response.markdown };
    } catch (error: unknown) {
      if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }

      if (error instanceof RpcError && error.code === "PERMISSION_DENIED") {
        return { kind: "locked" };
      }

      return cvDocumentFailed;
    }
  }
}

const syntheticCv = [
  "# Demo CV",
  "",
  "This synthetic document demonstrates protected Markdown presentation.",
  "",
  "## Experience",
  "",
  "- Example systems engineering engagement",
].join("\n");

export class DemoCvClient implements CvClient {
  private readonly state: DemoCapabilityState;

  constructor(state: DemoCapabilityState = new DemoCapabilityState()) {
    this.state = state;
  }

  unlock(_key: CvViewerKey, _signal: AbortSignal): Promise<CvAccessResult> {
    const session = this.state.current();

    switch (session.kind) {
      case "anonymous":
        this.state.replace({ kind: "cv-viewer" });
        break;
      case "github-viewer":
        this.state.replace({ kind: "github-cv-viewer", login: session.login });
        break;
      case "cv-viewer":
      case "github-cv-viewer":
      case "owner":
        break;
    }

    return Promise.resolve({ kind: "unlocked" });
  }

  lock(_signal: AbortSignal): Promise<CvAccessResult> {
    const session = this.state.current();

    switch (session.kind) {
      case "cv-viewer":
        this.state.replace({ kind: "anonymous" });
        break;
      case "github-cv-viewer":
        this.state.replace({ kind: "github-viewer", login: session.login });
        break;
      case "anonymous":
      case "github-viewer":
      case "owner":
        break;
    }

    return Promise.resolve({ kind: "locked" });
  }

  read(_signal: AbortSignal): Promise<CvDocumentResult> {
    const session = this.state.current();
    const available =
      session.kind === "cv-viewer" ||
      session.kind === "github-cv-viewer" ||
      session.kind === "owner";

    return Promise.resolve(
      available
        ? { kind: "available", markdown: syntheticCv }
        : { kind: "locked" },
    );
  }
}
