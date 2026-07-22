import type {
  CvAccessResult,
  CvClient,
  CvDocumentResult,
  CvViewerKey,
} from "../api/CvClient.ts";
import type {
  Session,
  SessionClient,
  SessionResult,
} from "../api/SessionClient.ts";

export type AuthenticationState =
  | Readonly<{
      kind: "loading";
      sensitiveRevision: number;
    }>
  | Readonly<{
      kind: "available";
      session: Session;
      sensitiveRevision: number;
    }>
  | Readonly<{
      kind: "unavailable";
      sensitiveRevision: number;
    }>;

export type AuthenticationListener = () => void;

function hasCvCapability(state: AuthenticationState): boolean {
  if (state.kind !== "available") {
    return false;
  }

  return (
    state.session.kind === "cv-viewer" ||
    state.session.kind === "github-cv-viewer" ||
    state.session.kind === "owner"
  );
}

function nextSensitiveRevision(
  current: AuthenticationState,
  nextHasCvCapability: boolean,
): number {
  return hasCvCapability(current) && !nextHasCvCapability
    ? current.sensitiveRevision + 1
    : current.sensitiveRevision;
}

export class AuthenticationController {
  private readonly sessionClient: SessionClient;
  private readonly cvClient: CvClient;

  private state: AuthenticationState = {
    kind: "loading",
    sensitiveRevision: 0,
  };

  private readonly listeners = new Set<AuthenticationListener>();

  constructor(
    sessionClient: SessionClient,
    cvClient: CvClient,
  ) {
    this.sessionClient = sessionClient;
    this.cvClient = cvClient;
  }

  snapshot = (): AuthenticationState => this.state;

  subscribe = (listener: AuthenticationListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private publish(state: AuthenticationState): void {
    this.state = state;

    for (const listener of this.listeners) {
      listener();
    }
  }

  private applySessionResult(result: SessionResult): AuthenticationState {
    if (result.kind === "failed") {
      const state = {
        kind: "unavailable",
        sensitiveRevision: nextSensitiveRevision(this.state, false),
      } as const satisfies AuthenticationState;
      this.publish(state);
      return state;
    }

    const sessionHasCvCapability =
      result.session.kind === "cv-viewer" ||
      result.session.kind === "github-cv-viewer" ||
      result.session.kind === "owner";
    const state = {
      kind: "available",
      session: result.session,
      sensitiveRevision: nextSensitiveRevision(
        this.state,
        sessionHasCvCapability,
      ),
    } as const satisfies AuthenticationState;
    this.publish(state);
    return state;
  }

  async refresh(signal: AbortSignal): Promise<AuthenticationState> {
    return this.applySessionResult(await this.sessionClient.read(signal));
  }

  async login(signal: AbortSignal): Promise<AuthenticationState> {
    return this.applySessionResult(await this.sessionClient.login(signal));
  }

  async logout(signal: AbortSignal): Promise<AuthenticationState> {
    const result = await this.sessionClient.logout(signal);

    if (result.kind === "failed") {
      return this.state;
    }

    await this.cvClient.lock(signal);

    return this.applySessionResult(result);
  }

  async unlockCv(
    key: CvViewerKey,
    signal: AbortSignal,
  ): Promise<CvAccessResult> {
    const result = await this.cvClient.unlock(key, signal);

    if (result.kind === "unlocked") {
      await this.refresh(signal);
    }

    return result;
  }

  async lockCv(signal: AbortSignal): Promise<CvAccessResult> {
    const result = await this.cvClient.lock(signal);

    if (result.kind === "locked") {
      await this.refresh(signal);
    }

    return result;
  }

  readCv(signal: AbortSignal): Promise<CvDocumentResult> {
    return this.cvClient.read(signal);
  }
}

export function authenticationCapabilityLabel(
  state: AuthenticationState,
): string {
  switch (state.kind) {
    case "loading":
      return "CHECKING";
    case "unavailable":
      return "UNAVAILABLE";
    case "available":
      switch (state.session.kind) {
        case "anonymous":
          return "ANONYMOUS";
        case "github-viewer":
          return "GITHUB";
        case "cv-viewer":
          return "CV";
        case "github-cv-viewer":
          return "GITHUB · CV";
        case "owner":
          return "OWNER · CV";
      }
  }
}

export function authenticationPromptIdentity(
  state: AuthenticationState,
): string {
  if (state.kind !== "available") {
    return "anonymous@termin.al";
  }

  switch (state.session.kind) {
    case "anonymous":
    case "cv-viewer":
      return "anonymous@termin.al";
    case "github-viewer":
    case "github-cv-viewer":
      return `${state.session.login}@github`;
    case "owner":
      return `${state.session.login}@termin.al`;
  }
}
