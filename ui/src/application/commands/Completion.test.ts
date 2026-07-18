import assert from "node:assert/strict";
import test from "node:test";
import { demoContentCorpus } from "../../content/DemoContentCorpus.ts";
import {
  createCompletionEdit,
  createCompletionRequest,
} from "../../domain/terminal/Completion.ts";
import {
  createShellId,
  createShellSessionId,
} from "../../domain/terminal/Shell.ts";
import {
  createVirtualFilesystem,
  resolveVirtualDirectory,
  virtualHomeDirectory,
} from "../../domain/filesystem/VirtualFilesystem.ts";
import {
  createCompletionService,
  createRegistryCommandCompletionProvider,
  createVirtualFilesystemPathCompletionProvider,
} from "./Completion.ts";
import { createCommandRegistry } from "./CommandRegistry.ts";

test("completes registry command names and aliases", async () => {
  const registry = createCommandRegistry({
    filesystem: demoContentCorpus.filesystem,
    commands: [
      {
        metadata: {
          group: "navigation",
          name: "open",
          aliases: ["o"],
          summary: "Open content",
          usage: "open <target>",
          examples: ["open about"],
        },
        pipeline: "text",
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

test("normalizes completion cursors at Unicode code-point boundaries", () => {
  const request = createCompletionRequest(
    createShellId("terminal"),
    createShellSessionId("session"),
    "😀",
    1,
  );
  const edit = createCompletionEdit(request, {
    kind: "command",
    value: "😀",
    label: "Emoji command",
  });

  assert.equal(request.cursor, 0);
  assert.deepEqual(request.target, {
    kind: "command",
    prefix: "",
    start: 0,
    end: 2,
  });
  assert.deepEqual(edit, { value: "😀", cursor: 2 });
});

test("completes direct virtual paths from the active directory without hidden entries", async () => {
  const filesystem = createVirtualFilesystem({
    entries: [
      {
        kind: "directory",
        id: "home",
        path: "~",
        updatedAt: "2026-01-01T00:00:00.000Z",
        size: 0,
      },
      {
        kind: "directory",
        id: "projects",
        path: "~/projects",
        updatedAt: "2026-01-01T00:00:00.000Z",
        size: 0,
      },
      {
        kind: "file",
        id: "readme",
        path: "~/projects/readme.md",
        updatedAt: "2026-01-01T00:00:00.000Z",
        size: 1,
        documentHandle: "readme",
      },
      {
        kind: "file",
        id: "hidden",
        path: "~/.hidden.md",
        updatedAt: "2026-01-01T00:00:00.000Z",
        size: 1,
        documentHandle: "hidden",
      },
    ],
  });
  const provider = createVirtualFilesystemPathCompletionProvider({
    filesystem,
    currentDirectory: virtualHomeDirectory(),
  });
  const pathRequest = createCompletionRequest(
    createShellId("terminal"),
    createShellSessionId("session"),
    "open pr",
    7,
  );
  const hiddenRequest = createCompletionRequest(
    createShellId("terminal"),
    createShellSessionId("session"),
    "open .",
    6,
  );
  const controller = new AbortController();

  const paths = await provider.complete(pathRequest, controller.signal);
  const hidden = await provider.complete(hiddenRequest, controller.signal);

  assert.deepEqual(paths, [
    { kind: "path", value: "projects/", label: "Directory" },
  ]);
  assert.deepEqual(hidden, [
    { kind: "path", value: ".hidden.md", label: "File" },
  ]);

  const projects = resolveVirtualDirectory(
    filesystem,
    virtualHomeDirectory(),
    "projects",
  );

  if (projects.kind !== "found") {
    assert.fail("Expected the virtual projects directory.");
  }

  const nestedProvider = createVirtualFilesystemPathCompletionProvider({
    filesystem,
    currentDirectory: projects.directory.path,
  });
  const nestedRequest = createCompletionRequest(
    createShellId("terminal"),
    createShellSessionId("session"),
    "open re",
    7,
  );

  assert.deepEqual(
    await nestedProvider.complete(nestedRequest, controller.signal),
    [{ kind: "path", value: "readme.md", label: "File" }],
  );
});

test("completes the demo projects directory from a cat argument", async () => {
  const provider = createVirtualFilesystemPathCompletionProvider({
    filesystem: demoContentCorpus.filesystem,
    currentDirectory: virtualHomeDirectory(),
  });
  const request = createCompletionRequest(
    createShellId("terminal"),
    createShellSessionId("session"),
    "cat pro",
    "cat pro".length,
  );

  assert.deepEqual(
    await provider.complete(request, new AbortController().signal),
    [{ kind: "path", value: "projects/", label: "Directory" }],
  );
});

test("keeps quoted paths and option boundaries intact during completion", async () => {
  const quoted = createCompletionRequest(
    createShellId("terminal"),
    createShellSessionId("session"),
    'open "pro',
    9,
  );
  const option = createCompletionRequest(
    createShellId("terminal"),
    createShellSessionId("session"),
    "ls -a",
    5,
  );
  const afterOptionTerminator = createCompletionRequest(
    createShellId("terminal"),
    createShellSessionId("session"),
    "ls -- pro",
    9,
  );
  const service = createCompletionService({
    commands: { complete: async () => [] },
    paths: { complete: async () => [] },
  });

  assert.deepEqual(quoted.target, {
    kind: "path",
    prefix: "pro",
    start: 6,
    end: 9,
  });
  assert.deepEqual(
    createCompletionEdit(quoted, {
      kind: "path",
      value: "projects/",
      label: "Directory",
    }),
    { value: 'open "projects/', cursor: 15 },
  );
  assert.equal(option.target.kind, "none");
  assert.equal(afterOptionTerminator.target.kind, "path");
  assert.deepEqual(
    await service.complete(option, new AbortController().signal),
    { kind: "none" },
  );
});
