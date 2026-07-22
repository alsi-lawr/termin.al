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
  });

  assert.deepEqual(await client.read(signal), {
    kind: "available",
    session: { kind: "owner", login: "owner" },
  });
  assert.deepEqual(metadata, [{}]);
  assert.deepEqual(context.metadata(), {
    "X-CSRF-TOKEN": "generated-antiforgery-token",
  });
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
