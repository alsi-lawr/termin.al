import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { cvViewerKeyFrom, DemoCvClient } from "./CvClient.ts";
import { DemoCapabilityState } from "./SessionClient.ts";

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
