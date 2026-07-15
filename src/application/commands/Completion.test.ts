import assert from "node:assert/strict";
import test from "node:test";
import {
  createCompletionEdit,
  createCompletionRequest,
} from "../../domain/terminal/Completion.ts";
import {
  createShellId,
  createShellSessionId,
} from "../../domain/terminal/Shell.ts";
import {
  createCompletionService,
  createRegistryCommandCompletionProvider,
} from "./Completion.ts";
import { createCommandRegistry } from "./CommandRegistry.ts";

test("completes registry command names and aliases", async () => {
  const registry = createCommandRegistry({
    commands: [
      {
        metadata: {
          name: "open",
          aliases: ["o"],
          summary: "Open content",
          usage: "open <target>",
        },
        execute: async () => ({ kind: "succeeded", outputs: [], effects: [] }),
      },
    ],
  });
  const service = createCompletionService({
    commands: createRegistryCommandCompletionProvider(registry),
    paths: { complete: async () => [] },
  });
  const request = createCompletionRequest(
    createShellId("terminal"),
    createShellSessionId("session"),
    "op",
    2,
  );
  const result = await service.complete(request, new AbortController().signal);

  if (result.kind !== "single") {
    assert.fail("Expected one command completion.");
  }

  assert.equal(result.candidate.value, "open");
  assert.deepEqual(createCompletionEdit(request, result.candidate), {
    value: "open",
    cursor: 4,
  });
});

test("routes argument completion to the path provider", async () => {
  const service = createCompletionService({
    commands: { complete: async () => [] },
    paths: {
      complete: async () => [
        { kind: "path", value: "projects", label: "Projects" },
        { kind: "path", value: "profile", label: "Profile" },
      ],
    },
  });
  const request = createCompletionRequest(
    createShellId("terminal"),
    createShellSessionId("session"),
    "open pro",
    8,
  );
  const result = await service.complete(request, new AbortController().signal);

  assert.equal(request.target.kind, "path");
  assert.equal(result.kind, "multiple");
});
