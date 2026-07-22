import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type JsonObject = Readonly<Record<string, unknown>>;

type BrowserRequest = Readonly<{
  url: string;
  resourceType: string;
}>;

function object(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null ? value : undefined;
}

function property(value: unknown, name: string): unknown {
  return object(value)?.[name];
}

function stringProperty(value: unknown, name: string): string | undefined {
  const candidate = property(value, name);
  return typeof candidate === "string" ? candidate : undefined;
}

class DevToolsSession {
  readonly #socket: WebSocket;
  readonly #pending = new Map<number, (message: JsonObject) => void>();
  readonly #listeners = new Set<(method: string, parameters: JsonObject) => void>();
  #commandId = 0;

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      const message = object(JSON.parse(event.data));
      if (message === undefined) return;
      const id = property(message, "id");
      if (typeof id === "number") {
        this.#pending.get(id)?.(message);
        this.#pending.delete(id);
        return;
      }
      const method = stringProperty(message, "method");
      const parameters = object(property(message, "params"));
      if (method !== undefined && parameters !== undefined) {
        for (const listener of this.#listeners) listener(method, parameters);
      }
    });
  }

  static async connect(url: string): Promise<DevToolsSession> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("Chrome DevTools connection failed.")), { once: true });
    });
    return new DevToolsSession(socket);
  }

  listen(listener: (method: string, parameters: JsonObject) => void): void {
    this.#listeners.add(listener);
  }

  command(method: string, params: JsonObject = {}): Promise<unknown> {
    const id = ++this.#commandId;
    this.#socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.#pending.set(id, (message) => {
        const error = object(property(message, "error"));
        if (error !== undefined) {
          reject(new Error(stringProperty(error, "message") ?? `DevTools command ${method} failed.`));
        } else {
          resolve(property(message, "result"));
        }
      });
    });
  }

  close(): void {
    this.#socket.close();
  }
}

async function waitForChrome(debugPort: number): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" });
      if (response.ok) {
        const endpoint = stringProperty(await response.json(), "webSocketDebuggerUrl");
        if (endpoint !== undefined) return endpoint;
      }
    } catch {
      // Chrome has not opened its local debugging endpoint yet.
    }
    await Bun.sleep(50);
  }
  throw new Error("Chrome did not open its DevTools endpoint.");
}

async function visibleDemoBadge(session: DevToolsSession): Promise<boolean> {
  const result = await session.command("Runtime.evaluate", {
    expression: "(() => { const element = document.querySelector('[aria-label=\"demo mode\"]'); return element !== null && getComputedStyle(element).visibility !== 'hidden' && getComputedStyle(element).display !== 'none'; })()",
    returnByValue: true,
  });
  return property(property(result, "result"), "value") === true;
}

async function waitForDemoBadge(session: DevToolsSession): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await visibleDemoBadge(session)) return;
    await Bun.sleep(25);
  }
  throw new Error("The visible DEMO badge did not appear.");
}

async function waitForApplication(session: DevToolsSession): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const result = await session.command("Runtime.evaluate", {
      expression: "document.readyState === 'complete' && document.querySelector('#root')?.childElementCount > 0",
      returnByValue: true,
    });
    if (property(property(result, "result"), "value") === true) return;
    await Bun.sleep(25);
  }
  throw new Error("The live application root did not render.");
}

const baseUrl = new URL(process.env.TERMINAL_SMOKE_BASE_URL ?? "http://127.0.0.1:5089");
const debugPort = Number.parseInt(process.env.TERMINAL_SMOKE_DEBUG_PORT ?? "9339", 10);
const chrome = process.env.CHROME_BIN ?? "google-chrome";
const profile = await mkdtemp(join(tmpdir(), "termin-al-chrome-"));
const processHandle = Bun.spawn([
  chrome,
  "--headless=new",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-default-apps",
  "--disable-sync",
  "--metrics-recording-only",
  "--no-first-run",
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profile}`,
  "about:blank",
], { stderr: "ignore", stdout: "ignore" });

let session: DevToolsSession | undefined;

try {
  session = await DevToolsSession.connect(await waitForChrome(debugPort));
  const requests: Array<BrowserRequest> = [];
  session.listen((method, parameters) => {
    if (method === "Network.requestWillBeSent") {
      const url = stringProperty(property(parameters, "request"), "url");
      const resourceType = stringProperty(parameters, "type");
      if (url !== undefined && resourceType !== undefined) requests.push({ url, resourceType });
    }
    if (method === "Network.webSocketCreated") {
      const url = stringProperty(parameters, "url");
      if (url !== undefined) requests.push({ url, resourceType: "WebSocket" });
    }
    if (method === "Fetch.requestPaused") {
      const requestId = stringProperty(parameters, "requestId");
      const url = stringProperty(property(parameters, "request"), "url");
      if (requestId === undefined || url === undefined) return;
      const sameOrigin = new URL(url).origin === baseUrl.origin;
      void session?.command(sameOrigin ? "Fetch.continueRequest" : "Fetch.failRequest", sameOrigin
        ? { requestId }
        : { requestId, errorReason: "BlockedByClient" });
    }
  });
  await session.command("Network.enable");
  await session.command("Page.enable");
  await session.command("Runtime.enable");
  await session.command("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });

  const demoStart = requests.length;
  await session.command("Page.navigate", { url: new URL("/demo", baseUrl).href });
  await waitForDemoBadge(session);
  await session.command("Page.reload", { ignoreCache: true });
  await waitForDemoBadge(session);

  const demoRequests = requests.slice(demoStart);
  const forbiddenDemoRequest = demoRequests.find(({ url, resourceType }) => {
    const requestUrl = new URL(url);
    return resourceType === "EventSource"
      || resourceType === "WebSocket"
      || requestUrl.origin !== baseUrl.origin
      || requestUrl.pathname.startsWith("/terminal.v1.")
      || requestUrl.pathname.startsWith("/api/auth/");
  });
  if (forbiddenDemoRequest !== undefined) {
    throw new Error(`/demo attempted a forbidden ${forbiddenDemoRequest.resourceType} request: ${forbiddenDemoRequest.url}`);
  }

  await session.command("Page.navigate", { url: new URL("/", baseUrl).href });
  await waitForApplication(session);
  if (await visibleDemoBadge(session)) throw new Error("The live root displayed the DEMO badge.");

  console.log(`Browser smoke passed: ${demoRequests.length} same-origin static /demo requests, direct entry and refresh, live root unbadged.`);
} finally {
  session?.close();
  processHandle.kill();
  await processHandle.exited;
  await rm(profile, { force: true, recursive: true });
}
