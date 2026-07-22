import { apiPathPrefix } from "./ApiPath.ts";

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

const cvAccessFailed = {
  kind: "failed",
  message: "CV access failed.",
} as const satisfies CvAccessResult;

const cvDocumentFailed = {
  kind: "failed",
  message: "CV access failed.",
} as const satisfies CvDocumentResult;

export function cvViewerKeyFrom(value: string): CvKeyResult {
  if (value.length < 32 || value.length > 256) {
    return { kind: "invalid" };
  }

  return { kind: "valid", key: value as CvViewerKey };
}

async function csrfToken(signal: AbortSignal): Promise<string | undefined> {
  try {
    const response = await fetch(`${apiPathPrefix}/session`, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal,
    });

    if (!response.ok) {
      return undefined;
    }

    const value: unknown = await response.json();

    if (
      typeof value !== "object" ||
      value === null ||
      !("csrfToken" in value) ||
      typeof value.csrfToken !== "string" ||
      value.csrfToken.length < 16 ||
      value.csrfToken.length > 4096
    ) {
      return undefined;
    }

    return value.csrfToken;
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }

    return undefined;
  }
}

async function mutateCv(
  method: "POST" | "DELETE",
  key: CvViewerKey | undefined,
  signal: AbortSignal,
): Promise<CvAccessResult> {
  const token = await csrfToken(signal);

  if (token === undefined) {
    return cvAccessFailed;
  }

  try {
    const response = await fetch(`${apiPathPrefix}/auth/cv`, {
      method,
      credentials: "same-origin",
      headers: {
        "X-CSRF-TOKEN": token,
        ...(key === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: key === undefined ? undefined : JSON.stringify({ key }),
      signal,
    });

    if (response.ok) {
      return method === "POST" ? { kind: "unlocked" } : { kind: "locked" };
    }

    return cvAccessFailed;
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }

    return cvAccessFailed;
  }
}

export class HttpCvClient implements CvClient {
  unlock(key: CvViewerKey, signal: AbortSignal): Promise<CvAccessResult> {
    return mutateCv("POST", key, signal);
  }

  lock(signal: AbortSignal): Promise<CvAccessResult> {
    return mutateCv("DELETE", undefined, signal);
  }

  async read(signal: AbortSignal): Promise<CvDocumentResult> {
    try {
      const response = await fetch(`${apiPathPrefix}/cv`, {
        credentials: "same-origin",
        headers: { Accept: "text/markdown" },
        signal,
      });

      if (response.status === 403) {
        return { kind: "locked" };
      }

      if (!response.ok) {
        return cvDocumentFailed;
      }

      const markdown = await response.text();

      if (new TextEncoder().encode(markdown).byteLength > 1024 * 1024) {
        return cvDocumentFailed;
      }

      return { kind: "available", markdown };
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
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
  private unlocked = false;

  unlock(_key: CvViewerKey, _signal: AbortSignal): Promise<CvAccessResult> {
    this.unlocked = true;
    return Promise.resolve({ kind: "unlocked" });
  }

  lock(_signal: AbortSignal): Promise<CvAccessResult> {
    this.unlocked = false;
    return Promise.resolve({ kind: "locked" });
  }

  read(_signal: AbortSignal): Promise<CvDocumentResult> {
    return Promise.resolve(
      this.unlocked
        ? { kind: "available", markdown: syntheticCv }
        : { kind: "locked" },
    );
  }
}
