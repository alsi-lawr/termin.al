import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { RpcMetadata } from "@protobuf-ts/runtime-rpc";
import { SessionKind, SessionResponse } from "../generated/browser/browser.ts";
import { BrowserGrpcContext } from "./BrowserGrpcContext.ts";
import { cvViewerKeyFrom, DemoCvClient, GrpcCvClient } from "./CvClient.ts";
import { DemoCapabilityState, GrpcSessionClient } from "./SessionClient.ts";

test("unlocks and locks through generated clients after the shared session boundary", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("CV generated-client test attempted fetch.");
  };

  try {
    const context = new BrowserGrpcContext();
    const signal = new AbortController().signal;
    const session = new GrpcSessionClient(context, {
      readSession: () => ({
        response: Promise.resolve(SessionResponse.create({
          kind: SessionKind.ANONYMOUS,
          csrfToken: "cv-generated-antiforgery-token",
        })),
      }),
      logout: () => ({ response: Promise.resolve({}) }),
    });
    const calls: Array<Readonly<{ method: string; metadata: RpcMetadata }>> = [];
    const client = new GrpcCvClient(context, session, {
      unlock: (_request, options) => {
        calls.push({ method: "unlock", metadata: options.meta });
        return { response: Promise.resolve({}) };
      },
      lock: (_request, options) => {
        calls.push({ method: "lock", metadata: options.meta });
        return { response: Promise.resolve({}) };
      },
      read: () => ({ response: Promise.resolve({ markdown: "# CV" }) }),
    });
    const key = cvViewerKeyFrom("x".repeat(32));
    if (key.kind !== "valid") assert.fail("Expected valid key fixture.");

    assert.deepEqual(await client.unlock(key.key, signal), { kind: "unlocked" });
    assert.deepEqual(await client.lock(signal), { kind: "locked" });
    assert.deepEqual(calls, [
      { method: "unlock", metadata: { "X-CSRF-TOKEN": "cv-generated-antiforgery-token" } },
      { method: "lock", metadata: { "X-CSRF-TOKEN": "cv-generated-antiforgery-token" } },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("preserves cancellation when generated CV calls reject with transport errors", async () => {
  const controller = new AbortController();
  controller.abort();
  const context = new BrowserGrpcContext();
  const session = new GrpcSessionClient(context, {
    readSession: () => ({
      response: Promise.resolve(SessionResponse.create({
        kind: SessionKind.ANONYMOUS,
        csrfToken: "cv-generated-antiforgery-token",
      })),
    }),
    logout: () => ({ response: Promise.resolve({}) }),
  });
  const client = new GrpcCvClient(context, session, {
    unlock: () => ({ response: Promise.reject(new Error("transport cancelled")) }),
    lock: () => ({ response: Promise.reject(new Error("transport cancelled")) }),
    read: () => ({ response: Promise.reject(new Error("transport cancelled")) }),
  });
  const key = cvViewerKeyFrom("x".repeat(32));
  if (key.kind !== "valid") assert.fail("Expected valid key fixture.");

  await assert.rejects(() => client.unlock(key.key, controller.signal), { name: "AbortError" });
  await assert.rejects(() => client.lock(controller.signal), { name: "AbortError" });
  await assert.rejects(() => client.read(controller.signal), { name: "AbortError" });
});

describe("DemoCvClient", () => {
  test("keeps synthetic CV access in local memory", async () => {
    const client = new DemoCvClient(new DemoCapabilityState());
    const signal = new AbortController().signal;
    const parsed = cvViewerKeyFrom("x".repeat(32));

    if (parsed.kind !== "valid") {
      assert.fail("The non-secret synthetic key fixture must satisfy the input boundary.");
    }

    assert.deepEqual(await client.read(signal), { kind: "locked" });
    assert.deepEqual(await client.unlock(parsed.key, signal), { kind: "unlocked" });
    const document = await client.read(signal);
    assert.equal(document.kind, "available");

    if (document.kind === "available") {
      assert.match(document.markdown, /^# Demo CV/);
    }

    assert.deepEqual(await client.lock(signal), { kind: "locked" });
    assert.deepEqual(await client.read(signal), { kind: "locked" });
  });
});
