import { apiPathPrefix } from "./ApiPath.ts";

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

type CsrfToken = string & { readonly __brand: "CsrfToken" };

type SessionEnvelope = Readonly<{
  session: Session;
  csrfToken: CsrfToken;
}>;

type ParsedSessionResult =
  | Readonly<{ kind: "valid"; envelope: SessionEnvelope }>
  | Readonly<{ kind: "invalid" }>;

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

function csrfToken(value: unknown): CsrfToken | undefined {
  if (typeof value !== "string" || value.length < 16 || value.length > 4096) {
    return undefined;
  }

  return value as CsrfToken;
}

function parseSession(value: unknown): ParsedSessionResult {
  if (typeof value !== "object" || value === null || !("kind" in value) || !("csrfToken" in value)) {
    return { kind: "invalid" };
  }

  const token = csrfToken(value.csrfToken);

  if (token === undefined) {
    return { kind: "invalid" };
  }

  switch (value.kind) {
    case "anonymous":
      return { kind: "valid", envelope: { session: { kind: "anonymous" }, csrfToken: token } };
    case "cv-viewer":
      return { kind: "valid", envelope: { session: { kind: "cv-viewer" }, csrfToken: token } };
    case "github-viewer":
    case "github-cv-viewer":
    case "owner": {
      if (!("login" in value)) {
        return { kind: "invalid" };
      }

      const login = authenticatedLogin(value.login);

      if (login === undefined) {
        return { kind: "invalid" };
      }

      return {
        kind: "valid",
        envelope: { session: { kind: value.kind, login }, csrfToken: token },
      };
    }
    default:
      return { kind: "invalid" };
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

async function readEnvelope(signal: AbortSignal): Promise<ParsedSessionResult> {
  try {
    const response = await fetch(`${apiPathPrefix}/session`, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal,
    });

    if (!response.ok) {
      return { kind: "invalid" };
    }

    return parseSession(await response.json());
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }

    return { kind: "invalid" };
  }
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

export class HttpSessionClient implements SessionClient {
  async read(signal: AbortSignal): Promise<SessionResult> {
    const parsed = await readEnvelope(signal);

    if (parsed.kind === "invalid") {
      return authenticationFailed;
    }

    return { kind: "available", session: parsed.envelope.session };
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
    const current = await readEnvelope(signal);

    if (current.kind === "invalid") {
      return authenticationFailed;
    }

    try {
      const response = await fetch(`${apiPathPrefix}/auth/logout`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "X-CSRF-TOKEN": current.envelope.csrfToken },
        signal,
      });

      if (!response.ok) {
        return authenticationFailed;
      }

      return { kind: "available", session: { kind: "anonymous" } };
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
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
