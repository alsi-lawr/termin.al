import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { RpcMetadata } from "@protobuf-ts/runtime-rpc";
import {
  SessionKind,
  SessionResponse,
} from "../generated/browser/browser.ts";
import { BrowserGrpcContext } from "./BrowserGrpcContext.ts";
import { DemoSessionClient, HttpSessionClient } from "./SessionClient.ts";

test("reads a generated protobuf session and retains its antiforgery metadata", async () => {
  const context = new BrowserGrpcContext();
  const response = SessionResponse.create({
    kind: SessionKind.OWNER,
    login: "owner",
    csrfToken: "generated-antiforgery-token",
  });
  const metadata: RpcMetadata[] = [];
  const signal = new AbortController().signal;
  const client = new HttpSessionClient(context, {
    readSession: (_request, options) => {
      metadata.push(options.meta);
      assert.equal(options.abort, signal);
      const binary = SessionResponse.toBinary(response);
      return { response: Promise.resolve(SessionResponse.fromBinary(binary)) };
    },
    logout: (_request, options) => {
      metadata.push(options.meta);
      assert.equal(options.abort, signal);
      return { response: Promise.resolve({}) };
    },
  });

  assert.deepEqual(await client.read(signal), {
    kind: "available",
    session: { kind: "owner", login: "owner" },
  });
  assert.deepEqual(metadata, [{}]);
  assert.deepEqual(context.metadata(), {
    "X-CSRF-TOKEN": "generated-antiforgery-token",
  });
  assert.deepEqual(await client.logout(signal), {
    kind: "available",
    session: { kind: "anonymous" },
  });
  assert.deepEqual(metadata.at(-1), {
    "X-CSRF-TOKEN": "generated-antiforgery-token",
  });
});

test("preserves cancellation when generated session calls reject with transport errors", async () => {
  const response = SessionResponse.create({
    kind: SessionKind.ANONYMOUS,
    csrfToken: "generated-antiforgery-token",
  });
  const readController = new AbortController();
  readController.abort();
  const readClient = new HttpSessionClient(new BrowserGrpcContext(), {
    readSession: () => ({ response: Promise.reject(new Error("transport cancelled")) }),
    logout: () => ({ response: Promise.resolve({}) }),
  });

  await assert.rejects(() => readClient.read(readController.signal), { name: "AbortError" });

  const logoutController = new AbortController();
  logoutController.abort();
  const logoutClient = new HttpSessionClient(new BrowserGrpcContext(), {
    readSession: () => ({ response: Promise.resolve(response) }),
    logout: () => ({ response: Promise.reject(new Error("transport cancelled")) }),
  });

  await assert.rejects(() => logoutClient.logout(logoutController.signal), { name: "AbortError" });
});

describe("DemoSessionClient", () => {
  test("changes only its local synthetic capability session", async () => {
    const client = new DemoSessionClient();
    const signal = new AbortController().signal;

    assert.deepEqual(await client.read(signal), {
      kind: "available",
      session: { kind: "anonymous" },
    });
    assert.deepEqual(await client.login(signal), {
      kind: "available",
      session: { kind: "github-viewer", login: "demo-viewer" },
    });
    assert.deepEqual(await client.logout(signal), {
      kind: "available",
      session: { kind: "anonymous" },
    });
  });
});
