import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DemoSessionClient } from "./SessionClient.ts";

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
