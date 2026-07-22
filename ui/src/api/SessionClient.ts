import { apiPathPrefix } from "./ApiPath.ts";
import {
  type EmptyRequest,
  SessionKind,
  type SessionResponse,
} from "../generated/browser/browser.ts";
import { SessionApiClient } from "../generated/browser/browser.client.ts";
import type { RpcMetadata } from "@protobuf-ts/runtime-rpc";
import {
  BrowserGrpcContext,
  createBrowserGrpcTransport,
  type CsrfToken,
} from "./BrowserGrpcContext.ts";

export type AuthenticatedLogin = string & { readonly __brand: "AuthenticatedLogin" };

export type Session =
  | Readonly<{ kind: "anonymous" }>
  | Readonly<{ kind: "github-viewer"; login: AuthenticatedLogin }>
  | Readonly<{ kind: "cv-viewer" }>
  | Readonly<{ kind: "github-cv-viewer"; login: AuthenticatedLogin }>
  | Readonly<{ kind: "owner"; login: AuthenticatedLogin }>;

export type SessionResult =
  | Readonly<{ kind: "available"; session: Session }>
  | Readonly<{ kind: "failed"; message: "Authentication failed." }>;

export interface SessionClient {
  read(signal: AbortSignal): Promise<SessionResult>;
  login(signal: AbortSignal): Promise<SessionResult>;
  logout(signal: AbortSignal): Promise<SessionResult>;
}

type SessionEnvelope = Readonly<{
  session: Session;
  csrfToken: CsrfToken;
}>;

const authenticationFailed = {
  kind: "failed",
  message: "Authentication failed.",
} as const satisfies SessionResult;

function authenticatedLogin(value: unknown): AuthenticatedLogin | undefined {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 39 ||
    value.trim() !== value
  ) {
    return undefined;
  }

  return value as AuthenticatedLogin;
}

function demoLogin(): AuthenticatedLogin {
  const login = authenticatedLogin("demo-viewer");

  if (login === undefined) {
    throw new Error("The synthetic demo login is invalid.");
  }

  return login;
}

function generatedSession(value: SessionResponse): SessionEnvelope {
  const csrfToken = value.csrfToken as CsrfToken;

  switch (value.kind) {
    case SessionKind.ANONYMOUS:
      return { session: { kind: "anonymous" }, csrfToken };
    case SessionKind.CV_VIEWER:
      return { session: { kind: "cv-viewer" }, csrfToken };
    case SessionKind.GITHUB_VIEWER:
      return {
        session: { kind: "github-viewer", login: value.login as AuthenticatedLogin },
        csrfToken,
      };
    case SessionKind.GITHUB_CV_VIEWER:
      return {
        session: { kind: "github-cv-viewer", login: value.login as AuthenticatedLogin },
        csrfToken,
      };
    case SessionKind.OWNER:
      return {
        session: { kind: "owner", login: value.login as AuthenticatedLogin },
        csrfToken,
      };
    case SessionKind.UNSPECIFIED:
    default:
      throw new Error("The generated session kind is unsupported.");
  }
}

function isPopupCompletion(value: unknown): value is Readonly<{
  type: "termin.al.auth.complete";
  ok: boolean;
}> {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "termin.al.auth.complete" &&
    "ok" in value &&
    typeof value.ok === "boolean"
  );
}

type SessionRpcClient = Readonly<{
  readSession: (
    request: Readonly<Record<string, never>>,
    options: Readonly<{ meta: RpcMetadata; abort: AbortSignal }>,
  ) => Readonly<{ response: Promise<SessionResponse> }>;
  logout: (
    request: Readonly<Record<string, never>>,
    options: Readonly<{ meta: RpcMetadata; abort: AbortSignal }>,
  ) => Readonly<{ response: Promise<EmptyRequest> }>;
}>;

async function readEnvelope(
  client: SessionRpcClient,
  context: BrowserGrpcContext,
  signal: AbortSignal,
): Promise<SessionEnvelope | undefined> {
  let response: SessionResponse;

  try {
    response = await client.readSession({}, { meta: context.metadata(), abort: signal }).response;
  } catch (error: unknown) {
    if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }

    return undefined;
  }

  const envelope = generatedSession(response);
  context.recordCsrfToken(envelope.csrfToken);
  return envelope;
}

function waitForPopup(
  popup: Window,
  signal: AbortSignal,
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const finish = (result: boolean): void => {
      window.removeEventListener("message", onMessage);
      signal.removeEventListener("abort", onAbort);
      window.clearTimeout(timeout);
      resolve(result);
    };
    const onMessage = (event: MessageEvent<unknown>): void => {
      if (
        event.origin !== window.location.origin ||
        event.source !== popup ||
        !isPopupCompletion(event.data)
      ) {
        return;
      }

      finish(event.data.ok);
    };
    const onAbort = (): void => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timeout);
      popup.close();
      reject(new DOMException("Authentication was cancelled.", "AbortError"));
    };
    const timeout = window.setTimeout(() => {
      popup.close();
      finish(false);
    }, 5_000);

    window.addEventListener("message", onMessage);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export class GrpcSessionClient implements SessionClient {
  private readonly context: BrowserGrpcContext;
  private readonly client: SessionRpcClient;

  constructor(
    context: BrowserGrpcContext = new BrowserGrpcContext(),
    client: SessionRpcClient = new SessionApiClient(createBrowserGrpcTransport()),
  ) {
    this.context = context;
    this.client = client;
  }

  async read(signal: AbortSignal): Promise<SessionResult> {
    const envelope = await readEnvelope(this.client, this.context, signal);

    if (envelope === undefined) {
      return authenticationFailed;
    }

    return { kind: "available", session: envelope.session };
  }

  async login(signal: AbortSignal): Promise<SessionResult> {
    const popup = window.open(
      `${apiPathPrefix}/auth/github/start`,
      "termin-al-github-auth",
      "popup,width=720,height=760",
    );

    if (popup === null) {
      return authenticationFailed;
    }

    const completed = await waitForPopup(popup, signal);

    if (!completed) {
      return authenticationFailed;
    }

    return this.read(signal);
  }

  async logout(signal: AbortSignal): Promise<SessionResult> {
    const current = await readEnvelope(this.client, this.context, signal);

    if (current === undefined) {
      return authenticationFailed;
    }

    try {
      await this.client.logout(
        {},
        { meta: this.context.metadata(), abort: signal },
      ).response;

      return { kind: "available", session: { kind: "anonymous" } };
    } catch (error: unknown) {
      if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }

      return authenticationFailed;
    }
  }
}

export class DemoSessionClient implements SessionClient {
  private readonly state: DemoCapabilityState;

  constructor(state: DemoCapabilityState = new DemoCapabilityState()) {
    this.state = state;
  }

  read(_signal: AbortSignal): Promise<SessionResult> {
    return Promise.resolve({ kind: "available", session: this.state.current() });
  }

  login(_signal: AbortSignal): Promise<SessionResult> {
    const current = this.state.current();
    const session: Session = current.kind === "cv-viewer"
      ? {
          kind: "github-cv-viewer",
          login: demoLogin(),
        }
      : {
          kind: "github-viewer",
          login: demoLogin(),
        };
    this.state.replace(session);
    return Promise.resolve({ kind: "available", session });
  }

  logout(_signal: AbortSignal): Promise<SessionResult> {
    const session = { kind: "anonymous" } as const satisfies Session;
    this.state.replace(session);
    return Promise.resolve({ kind: "available", session });
  }
}

export class DemoCapabilityState {
  private session: Session = { kind: "anonymous" };

  current(): Session {
    return this.session;
  }

  replace(session: Session): void {
    this.session = session;
  }
}
