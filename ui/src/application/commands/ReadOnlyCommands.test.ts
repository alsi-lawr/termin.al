import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { demoContentCorpus } from "../../content/DemoContentCorpus.ts";
import { createManpageCorpus } from "../../content/ManpageCorpus.ts";
import type { ViewerContent } from "../../content/ViewerContent.ts";
import {
  createVirtualFilesystem,
  virtualHomeDirectory,
  type VirtualCorpusCatalogEntry,
  type VirtualDirectoryPath,
  type VirtualDocumentSupplier,
  type VirtualFilesystem,
} from "../../domain/filesystem/VirtualFilesystem.ts";
import {
  createShellId,
  createShellSessionId,
  createShellState,
  reduceShellState,
  type CommandEffect,
  type CommandLineOutcome,
  type ShellOutput,
  type ShellCommandRequest,
} from "../../domain/terminal/Shell.ts";
import {
  commandHistoryPersistenceForSource,
  executeCommandLine,
} from "./CommandExecution.ts";
import {
  createCommandRegistry,
  resolveCommand,
  type CommandRegistry,
} from "./CommandRegistry.ts";
import {
  createReadOnlyCommandDefinitions,
} from "./ReadOnlyCommands.ts";

const generatedManifestUrl = new URL(
  "../../generated/manpages-manifest.json",
  import.meta.url,
);
const generatedArtifactsUrl = new URL("../../generated/manpages/", import.meta.url);
const generatedManifest: unknown = JSON.parse(
  readFileSync(generatedManifestUrl, "utf8"),
);
const generatedArtifacts = new Map(
  readdirSync(generatedArtifactsUrl, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".txt"))
    .map((entry) => [
      entry.name.slice(0, -".txt".length),
      readFileSync(new URL(entry.name, generatedArtifactsUrl), "utf8"),
    ]),
);
const generatedManpages = createManpageCorpus({
  manifest: generatedManifest,
  artifacts: generatedArtifacts,
});

function createRegistry(
  recursiveEntryLimit = 100,
  documents: VirtualDocumentSupplier = demoContentCorpus.documents,
): CommandRegistry {
  return createCommandRegistry({
    filesystem: demoContentCorpus.filesystem,
    commands: createReadOnlyCommandDefinitions({
      filesystem: demoContentCorpus.filesystem,
      documents,
      manpages: generatedManpages,
      recursiveEntryLimit,
    }),
  });
}

type GrepFixtureFile = Readonly<{
  handle: string;
  path: string;
  text: string;
}>;

type GrepFixture = Readonly<{
  documents: VirtualDocumentSupplier;
  filesystem: VirtualFilesystem;
  registry: CommandRegistry;
}>;

function createGrepFixture(
  entries: ReadonlyArray<VirtualCorpusCatalogEntry>,
  files: ReadonlyArray<GrepFixtureFile>,
  recursiveEntryLimit = 100,
): GrepFixture {
  const filesystem = createVirtualFilesystem({
    entries: [
      {
        kind: "directory",
        id: "root",
        path: "~",
        updatedAt: "2026-01-01T00:00:00.000Z",
        size: 0,
      },
      ...entries,
    ],
  });
  const filesByHandle = new Map(files.map((file) => [file.handle, file]));
  const documents: VirtualDocumentSupplier = {
    read: (handle, signal) => {
      if (signal.aborted) {
        return Promise.resolve({ kind: "cancelled" });
      }

      const file = filesByHandle.get(handle);

      if (file === undefined) {
        return Promise.resolve({ kind: "missing", handle });
      }

      return Promise.resolve({
        kind: "available",
        document: { text: file.text, source: { path: file.path } },
        classification: { kind: "page" },
      });
    },
  };
  const registry = createCommandRegistry({
    filesystem,
    commands: createReadOnlyCommandDefinitions({
      filesystem,
      documents,
      manpages: generatedManpages,
      recursiveEntryLimit,
    }),
  });

  return { documents, filesystem, registry };
}

function grepFileEntry(id: string, path: string, handle: string): VirtualCorpusCatalogEntry {
  return {
    kind: "file",
    id,
    path,
    updatedAt: "2026-01-01T00:00:00.000Z",
    size: 1,
    documentHandle: handle,
  };
}

function grepDirectoryEntry(id: string, path: string): VirtualCorpusCatalogEntry {
  return {
    kind: "directory",
    id,
    path,
    updatedAt: "2026-01-01T00:00:00.000Z",
    size: 0,
  };
}

function grepLockedEntry(id: string, path: string): VirtualCorpusCatalogEntry {
  return {
    kind: "locked-file",
    id,
    path,
    updatedAt: "2026-01-01T00:00:00.000Z",
    size: 1,
  };
}

function commandRequest(
  source: string,
  currentDirectory: VirtualDirectoryPath = virtualHomeDirectory(),
  previousCommands: ReadonlyArray<string> = [],
): ShellCommandRequest {
  let state = createShellState({
    id: createShellId("terminal"),
    sessionId: createShellSessionId("session"),
    currentDirectory,
    scrollbackLimit: 10,
    commandHistory: [],
    commandHistoryLimit: 10,
  });

  for (const command of previousCommands) {
    state = reduceShellState(state, { kind: "input.insert", text: command });
    state = reduceShellState(state, {
      kind: "prompt.submit",
      submission: {
        kind: "command",
        persistence: { kind: "persistent" },
      },
    });

    if (state.lifecycle.kind !== "running") {
      assert.fail("Expected a prior command request.");
    }

    state = reduceShellState(state, {
      kind: "command.settled",
      commandId: state.lifecycle.command.id,
      outcome: { kind: "succeeded", events: [] },
    });
  }

  const typed = reduceShellState(state, { kind: "input.insert", text: source });
  const submitted = reduceShellState(typed, {
    kind: "prompt.submit",
    submission: {
      kind: "command",
      persistence: { kind: "persistent" },
    },
  });

  if (submitted.lifecycle.kind !== "running") {
    assert.fail("Expected a command request.");
  }

  return submitted.lifecycle.command;
}

async function execute(
  source: string,
  registry: CommandRegistry,
  currentDirectory: VirtualDirectoryPath = virtualHomeDirectory(),
  previousCommands: ReadonlyArray<string> = [],
): Promise<CommandLineOutcome> {
  return executeCommandLine({
    registry,
    request: commandRequest(source, currentDirectory, previousCommands),
    signal: new AbortController().signal,
  });
}

async function executeWithSignal(
  source: string,
  registry: CommandRegistry,
  signal: AbortSignal,
): Promise<CommandLineOutcome> {
  return executeCommandLine({
    registry,
    request: commandRequest(source),
    signal,
  });
}

function succeeded(
  outcome: CommandLineOutcome,
): Readonly<{
  kind: "succeeded";
  events: Extract<CommandLineOutcome, { kind: "succeeded" }>["events"];
  outputs: ReadonlyArray<ShellOutput>;
  effects: ReadonlyArray<CommandEffect>;
}> {
  if (outcome.kind !== "succeeded") {
    assert.fail("Expected a successful command outcome.");
  }

  return {
    kind: "succeeded",
    events: outcome.events,
    outputs: outcome.events.flatMap((event) =>
      event.kind === "output" ? [event.output] : []
    ),
    effects: outcome.events.flatMap((event) =>
      event.kind === "effect" ? [event.effect] : []
    ),
  };
}

function outputText(outcome: CommandLineOutcome): string {
  const successful = succeeded(outcome);
  const output = successful.outputs.find((candidate) => candidate.kind === "text");

  if (output === undefined || output.kind !== "text") {
    assert.fail("Expected text output.");
  }

  return output.text;
}

function documentViewer(
  outcome: CommandLineOutcome,
): Extract<ViewerContent, { kind: "document" }> {
  const effect = succeeded(outcome).effects.find(
    (candidate) => candidate.kind === "open-viewer",
  );

  if (effect === undefined || effect.kind !== "open-viewer") {
    assert.fail("Expected a document viewer effect.");
  }

  if (effect.viewer.kind !== "document") {
    assert.fail("Expected document viewer content.");
  }

  return effect.viewer;
}

function failureMessage(outcome: CommandLineOutcome): string {
  if (outcome.kind !== "failed") {
    assert.fail("Expected a failed command outcome.");
  }

  const event = outcome.events.find(
    (candidate) =>
      candidate.kind === "output" && candidate.output.kind === "diagnostic",
  );

  if (event?.kind !== "output" || event.output.kind !== "diagnostic") {
    assert.fail("Expected a failure diagnostic.");
  }

  return event.output.diagnostic.message;
}

function failureMessages(outcome: CommandLineOutcome): ReadonlyArray<string> {
  if (outcome.kind !== "failed") {
    assert.fail("Expected a failed command outcome.");
  }

  return outcome.events.flatMap((event) =>
    event.kind === "output" && event.output.kind === "diagnostic"
      ? [event.output.diagnostic.message]
      : []
  );
}

function runtimeTruncations(outcome: CommandLineOutcome): ReadonlyArray<string> {
  return succeeded(outcome).outputs.flatMap((output) =>
    output.kind === "diagnostic" && output.diagnostic.code === "runtime.truncated"
      ? [output.diagnostic.message]
      : [],
  );
}

test("registers the accepted read-only GNU-like corpus without list", () => {
  const registry = createRegistry();

  assert.deepEqual(
    registry.commands.map((command) => command.metadata.name),
    [
      "ls",
      "cd",
      "cat",
      "pwd",
      "tree",
      "find",
      "grep",
      "sed",
      "head",
      "tail",
      "less",
      "clear",
      "history",
      "man",
      "echo",
      "whoami",
    ],
  );
  assert.equal(resolveCommand(registry, "list").kind, "missing");
});

test("derives explicit credential-argument persistence policy from parsed commands", () => {
  const commands = createReadOnlyCommandDefinitions({
    filesystem: demoContentCorpus.filesystem,
    documents: demoContentCorpus.documents,
    manpages: generatedManpages,
    recursiveEntryLimit: 100,
  }).map((command) =>
    command.metadata.name === "echo"
      ? {
          ...command,
          historyPersistence: {
            kind: "memory-only" as const,
            reason: "credential-arguments" as const,
          },
        }
      : command
  );
  const registry = createCommandRegistry({
    filesystem: demoContentCorpus.filesystem,
    commands,
  });

  assert.deepEqual(
    commandHistoryPersistenceForSource(registry, "pwd ; echo token"),
    { kind: "memory-only", reason: "credential-arguments" },
  );
  assert.deepEqual(commandHistoryPersistenceForSource(registry, "missing token"), {
    kind: "persistent",
  });
});

test("adds exact ls tree parsing, metadata, and tree output parity", async () => {
  const registry = createRegistry();
  const tree = outputText(await execute("tree projects", registry));
  const lsTree = outputText(await execute("ls --tree projects", registry));
  const reordered = outputText(await execute("ls projects --tree", registry));
  const repeated = outputText(
    await execute("ls --tree --tree projects", registry),
  );
  const allTree = outputText(await execute("tree -a", registry));
  const lsAllTree = outputText(await execute("ls -a --tree", registry));
  const ordinary = outputText(await execute("ls", registry));
  const repeatedAll = outputText(await execute("ls -aa", registry));
  const all = outputText(await execute("ls -a", registry));
  const repeatedLong = outputText(await execute("ls -ll about.md", registry));
  const longFile = outputText(await execute("ls -l about.md", registry));
  const ordinaryFile = outputText(await execute("ls about.md", registry));
  const treeFileFailure = failureMessage(
    await execute("tree about.md", registry),
  );
  const lsTreeFileFailure = failureMessage(
    await execute("ls --tree about.md", registry),
  );
  const terminatedLs = failureMessage(await execute("ls -- --tree", registry));
  const terminatedTree = failureMessage(
    await execute("ls --tree -- --tree", registry),
  );
  const terminatedLongTree = failureMessage(
    await execute("ls -l -- --tree", registry),
  );
  const terminatedTreeLong = failureMessage(
    await execute("ls --tree -- -l", registry),
  );
  const manual = documentViewer(await execute("man ls", registry)).document.text;
  const resolution = resolveCommand(registry, "ls");

  if (resolution.kind === "missing") {
    assert.fail("Expected ls command metadata.");
  }

  assert.equal(lsTree, tree);
  assert.equal(reordered, tree);
  assert.equal(repeated, tree);
  assert.equal(lsAllTree, allTree);
  assert.equal(ordinary.length > 0, true);
  assert.equal(repeatedAll, all);
  assert.equal(repeatedLong, longFile);
  assert.equal(ordinaryFile, "about.md");
  assert.equal(lsTreeFileFailure, treeFileFailure);
  assert.equal(terminatedLs, "Path not found: ~/--tree");
  assert.equal(terminatedTree, "Path not found: ~/--tree");
  assert.equal(terminatedLongTree, "Path not found: ~/--tree");
  assert.equal(terminatedTreeLong, "Path not found: ~/-l");
  assert.equal(resolution.command.metadata.usage, "ls [-a] [-l] [--tree] [path]");
  assert.deepEqual(resolution.command.metadata.examples, [
    "ls",
    "ls -l projects",
    "ls --tree projects",
    "ls -a --tree",
  ]);
  assert.match(
    manual,
    /\nSYNOPSIS\n     ls \[-a\] \[-l\] \[--tree\] \[path\]/u,
  );
  assert.match(manual, /\n     \$ ls --tree projects/u);
  assert.match(manual, /\n     \$ ls -a --tree/u);
});

test("rejects every ls long-tree combination independently of ordering", async () => {
  const registry = createRegistry();
  const invocations = [
    "ls -l --tree",
    "ls --tree -l",
    "ls -al --tree",
    "ls --tree -la",
    "ls -a -l --tree",
    "ls --tree -a -l",
    "ls -ll --tree",
    "ls --tree -l -l",
    "ls projects -l --tree",
    "ls --tree projects -l",
  ];

  for (const invocation of invocations) {
    assert.equal(
      failureMessage(await execute(invocation, registry)),
      "Unsupported option combination: -l and --tree.",
    );
  }
});

test("executes virtual readers for quoted, relative, and current-directory paths", async () => {
  const registry = createRegistry();
  const listing = outputText(await execute("ls -al", registry));
  const quoted = outputText(await execute('cat "about.md"', registry));
  const projects = virtualHomeDirectory();
  const cd = succeeded(await execute("cd projects", registry));
  const projectDirectory = cd.effects.find(
    (effect) => effect.kind === "set-current-directory",
  );

  if (projectDirectory === undefined || projectDirectory.kind !== "set-current-directory") {
    assert.fail("Expected the cd working-directory effect.");
  }

  const relative = outputText(
    await execute("cat ../about.md", registry, projectDirectory.directory),
  );
  const pwd = outputText(await execute("pwd", registry, projectDirectory.directory));

  assert.match(listing, /^dr-xr-xr-x\s+0\s+2026-01-01T00:00:00 UTC \.\/$/mu);
  assert.match(listing, /^dr-xr-xr-x\s+0\s+2026-01-01T00:00:00 UTC \.\.\/$/mu);
  assert.match(listing, /projects\/$/mu);
  assert.match(listing, /cv\.md \[locked\]$/mu);
  assert.equal(
    quoted,
    "# About\n\nThis is a deterministic offline demonstration of a terminal workspace. It contains synthetic content only.",
  );
  assert.equal(relative, quoted);
  assert.equal(pwd, "~/projects");
  assert.equal(projects, "~");
});

test("implements line readers, terminal history, manual pages, and pager effects", async () => {
  const registry = createRegistry();
  const head = outputText(await execute("head -n 1 about.md", registry));
  const tail = outputText(await execute("tail -n 1 about.md", registry));
  const echo = outputText(await execute('echo "hello terminal"', registry));
  const whoami = outputText(await execute("whoami", registry));
  const history = outputText(
    await execute("history", registry, virtualHomeDirectory(), [
      "echo first",
      "echo 😀 second",
    ]),
  );
  const historyClear = succeeded(await execute("history clear", registry));
  const invalidHistory = await execute("history nope", registry);
  const manual = documentViewer(await execute("man grep", registry)).document.text;
  const pager = succeeded(await execute("less notes/field-notes/filesystems/sample-note.md", registry));
  const clear = succeeded(await execute("clear", registry));

  assert.equal(head, "# About");
  assert.equal(
    tail,
    "This is a deterministic offline demonstration of a terminal workspace. It contains synthetic content only.",
  );
  assert.equal(echo, "hello terminal");
  assert.equal(whoami, "anonymous");

  assert.equal(history, "1  echo first\n2  echo 😀 second\n3  history");
  assert.deepEqual(historyClear.effects, [{ kind: "clear-command-history" }]);
  assert.equal(failureMessage(invalidHistory), "Usage: history [clear]");
  assert.match(manual, /^GREP\(1\).*GREP\(1\)$/mu);
  assert.match(manual, /\nNAME\n     grep - Search virtual files with ECMAScript regular expressions\./u);
  assert.match(
    manual,
    /\nSYNOPSIS\n     grep \[-i\] \[-n\] \[-r\] \[-F\] \[-H\|-h\] \[--\] pattern \[file \.\.\.\]/u,
  );
  assert.match(manual, /\nOPTIONS\n     -i/u);
  assert.match(manual, /\nREGULAR EXPRESSIONS\n/u);
  assert.match(manual, /\nLINES AND OUTPUT\n/u);
  assert.match(manual, /\nEXAMPLES\n     \$ cat about\.md \| grep -n '\^Typed'/u);
  assert.match(manual, /\nSEE ALSO\n     help\(1\), man\(1\)/u);

  const pagerEffect = pager.effects.find(
    (effect) => effect.kind === "open-viewer",
  );
  if (pagerEffect === undefined || pagerEffect.kind !== "open-viewer") {
    assert.fail("Expected raw pager effect.");
  }
  if (pagerEffect.viewer.kind !== "document") {
    assert.fail("Expected raw document viewer content.");
  }
  assert.equal(pagerEffect.viewer.document.source.path, "~/notes/field-notes/filesystems/sample-note.md");
  assert.equal(pagerEffect.viewer.presentation, "raw-pager");
  assert.equal(pagerEffect.viewer.statsIdentity.kind, "countable");
  if (pagerEffect.viewer.statsIdentity.kind === "countable") {
    assert.equal(pagerEffect.viewer.statsIdentity.contentId.value, "note");
  }
  assert.deepEqual(clear.effects, [{ kind: "clear-scrollback" }]);
});

test("pipes text through grep, head, and tail while preserving empty stdin", async () => {
  const registry = createRegistry();
  const filtered = outputText(
    await execute("cat about.md | grep -n 'deterministic' | head -n 1", registry),
  );
  const finalLine = outputText(
    await execute("cat about.md | tail -n 1", registry),
  );
  const empty = succeeded(await execute("echo '' | head -n 1", registry));

  assert.equal(filtered, "3:This is a deterministic offline demonstration of a terminal workspace. It contains synthetic content only.");
  assert.equal(finalLine, "This is a deterministic offline demonstration of a terminal workspace. It contains synthetic content only.");
  assert.deepEqual(
    empty.outputs.flatMap((output) => output.kind === "text" ? [output.text] : []),
    [""],
  );
});

test("keeps pipeline diagnostics visible but out of downstream text", async () => {
  const outcome = await execute("missing | head -n 1 && echo final", createRegistry());
  const successful = succeeded(outcome);

  assert.deepEqual(
    successful.outputs.map((output) => {
      switch (output.kind) {
        case "text":
          return output.text;
        case "diagnostic":
          return output.diagnostic.message;
        case "prompt":
          return output.message;
      }
    }),
    ["Command not found: missing", "", "final"],
  );
});

test("rejects effect pipelines before an earlier reader executes", async () => {
  let reads = 0;
  const registry = createRegistry(100, {
    read: (handle, signal) => {
      reads += 1;
      return demoContentCorpus.documents.read(handle, signal);
    },
  });
  const outcome = await execute("cat about.md | less about.md", registry);

  assert.equal(failureMessage(outcome), "less cannot be used in a pipeline.");
  assert.equal(reads, 0);
});

test("uses one canonical artifact for default less, explicit less, vi, and aliases", async () => {
  const definitions = createReadOnlyCommandDefinitions({
    filesystem: demoContentCorpus.filesystem,
    documents: demoContentCorpus.documents,
    manpages: generatedManpages,
    recursiveEntryLimit: 100,
  });
  const registry = createCommandRegistry({
    filesystem: demoContentCorpus.filesystem,
    commands: definitions.map((command) =>
      command.metadata.name === "ls"
        ? {
            ...command,
            metadata: { ...command.metadata, aliases: ["dir"] },
          }
        : command
    ),
  });
  const manual = generatedManpages.lookup("ls");

  if (manual.kind === "missing") {
    assert.fail("Expected the generated ls manual.");
  }

  const requests = [
    ["man ls", "raw-pager"],
    ["man dir", "raw-pager"],
    ["man -P less ls", "raw-pager"],
    ["man --pager=less ls", "raw-pager"],
    ["man -P vi ls", "vi-manpager"],
    ["man --pager=vi ls", "vi-manpager"],
  ] as const;

  for (const [source, presentation] of requests) {
    const outcome = succeeded(await execute(source, registry));
    const viewer = documentViewer(outcome);

    assert.deepEqual(outcome.outputs, []);
    assert.equal(viewer.title, "ls(1)");
    assert.equal(viewer.presentation, presentation);
    assert.equal(viewer.document.text, manual.manpage.text);
    assert.equal(viewer.document.source.path, "man/ls.1");
    assert.deepEqual(viewer.statsIdentity, { kind: "uncounted" });
  }
});

test("reports stable diagnostics for malformed and unavailable manual requests", async () => {
  const registry = createRegistry();
  const invalidRequests: ReadonlyArray<readonly [string, string]> = [
    ["man", "Usage: man [-P less|vi] [--pager=less|vi] <command>"],
    ["man ls grep", "Usage: man [-P less|vi] [--pager=less|vi] <command>"],
    ["man -P", "Usage: man [-P less|vi] [--pager=less|vi] <command>"],
    ["man -P vim ls", "Unsupported man pager: vim."],
    ["man --pager=vim ls", "Unsupported man pager: vim."],
    ["man -P more ls", "Unsupported man pager: more."],
    ["man --pager=more ls", "Unsupported man pager: more."],
    ["man --pager= ls", "Man pager must be specified."],
    ["man --pager vim ls", "Unsupported man option: --pager."],
    ["man -Pvim ls", "Unsupported man option: -Pvim."],
    ["man absent", "No manual entry for absent."],
  ];

  for (const [source, message] of invalidRequests) {
    assert.equal(failureMessage(await execute(source, registry)), message);
  }

  const noManuals = createCommandRegistry({
    filesystem: demoContentCorpus.filesystem,
    commands: createReadOnlyCommandDefinitions({
      filesystem: demoContentCorpus.filesystem,
      documents: demoContentCorpus.documents,
      manpages: createManpageCorpus({
        manifest: { entries: [] },
        artifacts: new Map(),
      }),
      recursiveEntryLimit: 100,
    }),
  });

  assert.equal(
    failureMessage(await execute("man ls", noManuals)),
    "No manual entry for ls.",
  );
});

test("renders hidden, locked, directory, and long Unicode listings as text", async () => {
  const filesystem = createVirtualFilesystem({
    entries: [
      {
        kind: "directory",
        id: "home",
        path: "~",
        updatedAt: "2026-02-01T00:00:00.000Z",
        size: 0,
      },
      {
        kind: "directory",
        id: "empty",
        path: "~/empty",
        updatedAt: "2026-02-02T00:00:00.000Z",
        size: 0,
      },
      {
        kind: "directory",
        id: "unicode-directory",
        path: "~/目录",
        updatedAt: "2026-02-03T00:00:00.000Z",
        size: 0,
      },
      {
        kind: "file",
        id: "hidden",
        path: "~/.hidden.md",
        updatedAt: "2026-02-04T00:00:00.000Z",
        size: 8,
        documentHandle: "hidden",
      },
      {
        kind: "locked-file",
        id: "locked",
        path: "~/cv.md",
        updatedAt: "2026-02-05T00:00:00.000Z",
        size: 144,
      },
      {
        kind: "file",
        id: "long-unicode",
        path: "~/a-very-long-unicode-name-長い😀.md",
        updatedAt: "2026-02-06T00:00:00.000Z",
        size: 12,
        documentHandle: "long-unicode",
      },
    ],
  });
  const registry = createCommandRegistry({
    filesystem,
    commands: createReadOnlyCommandDefinitions({
      filesystem,
      documents: demoContentCorpus.documents,
      manpages: generatedManpages,
      recursiveEntryLimit: 100,
    }),
  });
  const longListing = outputText(await execute("ls -al", registry));
  const normalListing = outputText(await execute("ls", registry));
  const emptyListing = outputText(await execute("ls empty", registry));
  const tree = outputText(await execute("tree", registry));
  const lsTree = outputText(await execute("ls --tree", registry));
  const allTree = outputText(await execute("tree -a", registry));
  const lsAllTree = outputText(await execute("ls -a --tree", registry));
  const boundedRegistry = createCommandRegistry({
    filesystem,
    commands: createReadOnlyCommandDefinitions({
      filesystem,
      documents: demoContentCorpus.documents,
      manpages: generatedManpages,
      recursiveEntryLimit: 1,
    }),
  });
  const boundedTree = succeeded(await execute("ls --tree", boundedRegistry));
  const boundedText = boundedTree.outputs.find(
    (output) => output.kind === "text",
  );
  const boundedDiagnostic = boundedTree.outputs.find(
    (output) => output.kind === "diagnostic",
  );

  assert.match(longListing, /^dr-xr-xr-x\s+0\s+2026-02-01T00:00:00 UTC \.\/$/mu);
  assert.match(longListing, /^----------\s+144\s+2026-02-05T00:00:00 UTC cv\.md \[locked\]$/mu);
  assert.match(longListing, /目录\/$/mu);
  assert.match(longListing, /a-very-long-unicode-name-長い😀\.md$/mu);
  assert.equal(normalListing.includes(".hidden.md"), false);
  assert.equal(emptyListing, "");
  assert.equal(lsTree, tree);
  assert.equal(lsAllTree, allTree);
  assert.equal(tree.includes(".hidden.md"), false);
  assert.equal(allTree.includes(".hidden.md"), true);

  if (boundedText === undefined || boundedText.kind !== "text") {
    assert.fail("Expected bounded ls tree text.");
  }

  if (boundedDiagnostic === undefined || boundedDiagnostic.kind !== "diagnostic") {
    assert.fail("Expected bounded ls tree truncation diagnostic.");
  }

  assert.equal(boundedText.text, "~");
  assert.equal(boundedDiagnostic.diagnostic.code, "runtime.truncated");
  assert.equal(boundedDiagnostic.diagnostic.message, "ls stopped after 1 entries.");
});

test("marks bounded find results", async () => {
  const registry = createRegistry(2);
  const find = succeeded(await execute("find -name '*.md'", registry));
  const shallowTree = outputText(await execute("tree -L 0", createRegistry()));

  const findText = find.outputs.find((output) => output.kind === "text");
  const truncation = find.outputs.find((output) => output.kind === "diagnostic");

  if (findText === undefined || findText.kind !== "text") {
    assert.fail("Expected find matches.");
  }

  if (truncation === undefined || truncation.kind !== "diagnostic") {
    assert.fail("Expected find truncation diagnostic.");
  }

  assert.match(findText.text, /about\.md/u);
  assert.equal(truncation.diagnostic.code, "runtime.truncated");
  assert.equal(shallowTree, "~");
});

test("expands virtual globs and combines bounded find predicates", async () => {
  const fixture = createGrepFixture(
    [
      grepFileEntry("alpha", "~/alpha.md", "alpha"),
      grepFileEntry("beta", "~/beta.md", "beta"),
      grepFileEntry("hidden", "~/.hidden.md", "hidden"),
      grepFileEntry("mixed", "~/pre*x.md", "mixed"),
      grepDirectoryEntry("docs", "~/docs"),
      grepFileEntry("a", "~/docs/a.md", "a"),
      grepFileEntry("b", "~/docs/b.md", "b"),
      grepFileEntry("text", "~/docs/c.txt", "text"),
      grepDirectoryEntry("nested", "~/docs/nested"),
      grepFileEntry("deep", "~/docs/nested/deep.md", "deep"),
      grepFileEntry("astral-grin", "~/😀.emoji", "astral-grin"),
      grepFileEntry("astral-pray", "~/🙏.emoji", "astral-pray"),
      grepFileEntry("astral-prefix", "~/🙏😀.emoji", "astral-prefix"),
    ],
    [
      { handle: "a", path: "~/docs/a.md", text: "hit a" },
      { handle: "b", path: "~/docs/b.md", text: "hit b" },
    ],
  );

  assert.equal(
    outputText(await execute("echo *.md", fixture.registry)),
    "~/alpha.md ~/beta.md ~/pre*x.md",
  );
  assert.equal(outputText(await execute("echo .*.md", fixture.registry)), "~/.hidden.md");
  assert.equal(
    outputText(await execute("echo docs/[a-b].md docs/?.md", fixture.registry)),
    "~/docs/a.md ~/docs/b.md ~/docs/a.md ~/docs/b.md",
  );
  assert.equal(outputText(await execute("echo '*.md' \\*.md", fixture.registry)), "*.md *.md");
  assert.equal(outputText(await execute("echo pre'*'?.md", fixture.registry)), "~/pre*x.md");
  assert.equal(
    outputText(await execute("echo absent*.md '[abc'", fixture.registry)),
    "absent*.md [abc",
  );
  assert.equal(outputText(await execute("cat docs/?.md | grep hit", fixture.registry)), "hit a\nhit b");
  assert.equal((await execute("e*", fixture.registry)).kind, "failed");
  assert.equal(
    outputText(await execute("echo ?.emoji [😀].emoji *😀.emoji", fixture.registry)),
    "~/😀.emoji ~/🙏.emoji ~/😀.emoji ~/😀.emoji ~/🙏😀.emoji",
  );

  assert.equal(outputText(await execute("find docs -maxdepth 0", fixture.registry)), "~/docs");
  assert.equal(
    outputText(await execute(
      "find docs -mindepth 1 -type f -path '~/docs/[a-b].md' -name '?.md' -maxdepth 1",
      fixture.registry,
    )),
    "~/docs/a.md\n~/docs/b.md",
  );
  assert.equal(
    outputText(await execute("find docs -mindepth 1 -maxdepth 1 -type d", fixture.registry)),
    "~/docs/nested",
  );
  assert.equal(outputText(await execute("find -name '😀.emoji'", fixture.registry)), "~/😀.emoji");
  assert.equal(
    outputText(await execute("find -name '[😀-🙏].emoji'", fixture.registry)),
    "~/😀.emoji\n~/🙏.emoji",
  );
  assert.deepEqual(
    await Promise.all(["-1", "9", "1.5", "9007199254740992"].map(async (depth) =>
      failureMessage(await execute(`find -maxdepth ${depth}`, fixture.registry))
    )),
    Array.from({ length: 4 }, () => "-maxdepth requires a depth from 0 to 8."),
  );

  const controller = new AbortController();
  controller.abort();
  assert.equal(
    (await executeWithSignal("find docs -mindepth 1", fixture.registry, controller.signal)).kind,
    "cancelled",
  );
});

test("uses native regex syntax, Unicode and ignore-case behavior, and fixed literals", async () => {
  const fixture = createGrepFixture(
    [grepFileEntry("one", "~/one.txt", "one")],
    [{ handle: "one", path: "~/one.txt", text: "aa\nAAbb\n.*[x]\n-literal\nÄ\n😀\n(" }],
  );

  assert.equal(outputText(await execute("grep '^a+$' one.txt", fixture.registry)), "aa");
  assert.equal(outputText(await execute("grep '(?=aa)aa' one.txt", fixture.registry)), "aa");
  assert.equal(outputText(await execute("grep '^.$' one.txt", fixture.registry)), "Ä\n😀\n(");
  assert.equal(outputText(await execute("grep -i '^ä$' one.txt", fixture.registry)), "Ä");
  assert.equal(outputText(await execute("grep -F '.*[x]' one.txt", fixture.registry)), ".*[x]");
  assert.equal(
    outputText(await execute("grep -inH 'aa+' one.txt", fixture.registry)),
    "~/one.txt:1:aa\n~/one.txt:2:AAbb",
  );
  assert.equal(outputText(await execute("grep -iF ä one.txt", fixture.registry)), "Ä");
  assert.equal(outputText(await execute("grep -F '(' one.txt", fixture.registry)), "(");
  assert.equal(outputText(await execute("grep -- -literal one.txt", fixture.registry)), "-literal");
  assert.deepEqual(succeeded(await execute("grep absent one.txt", fixture.registry)).outputs, []);

  const failures: ReadonlyArray<readonly [string, string]> = [
    ["grep", "Usage: grep [-i] [-n] [-r] [-F] [-H|-h] [--] pattern [file ...]"],
    ["grep pattern", "Usage: grep [-i] [-n] [-r] [-F] [-H|-h] [--] pattern [file ...]"],
    ["grep -z pattern one.txt", "Unsupported option: -z."],
    ["grep -E pattern one.txt", "Unsupported option: -E."],
    ["grep -Hh pattern one.txt", "Options -H and -h are mutually exclusive."],
  ];

  for (const [source, expected] of failures) {
    assert.equal(failureMessage(await execute(source, fixture.registry)), expected, source);
  }

  assert.match(
    failureMessage(await execute("grep '(' one.txt", fixture.registry)),
    /^Invalid regular expression:/u,
  );
});

test("preserves grep operand order and applies exact filename and line prefixes", async () => {
  const fixture = createGrepFixture(
    [
      grepFileEntry("a", "~/a.txt", "a"),
      grepFileEntry("b", "~/b.txt", "b"),
      grepDirectoryEntry("dir", "~/dir"),
      grepFileEntry("c", "~/dir/c.txt", "c"),
    ],
    [
      { handle: "a", path: "~/a.txt", text: "hit a" },
      { handle: "b", path: "~/b.txt", text: "miss\nhit b" },
      { handle: "c", path: "~/dir/c.txt", text: "miss\nhit c" },
    ],
  );

  assert.equal(outputText(await execute("grep hit a.txt", fixture.registry)), "hit a");
  assert.equal(outputText(await execute("grep -H hit a.txt", fixture.registry)), "~/a.txt:hit a");
  assert.equal(
    outputText(await execute("grep -n hit a.txt b.txt", fixture.registry)),
    "~/a.txt:1:hit a\n~/b.txt:2:hit b",
  );
  assert.equal(
    outputText(await execute("grep -hn hit b.txt a.txt b.txt", fixture.registry)),
    "2:hit b\n1:hit a\n2:hit b",
  );
  assert.equal(
    outputText(await execute("grep -rn hit dir", fixture.registry)),
    "~/dir/c.txt:2:hit c",
  );
  assert.equal(
    failureMessage(await execute("grep hit dir", fixture.registry)),
    "Is a directory: ~/dir; use -r to search recursively.",
  );
});

test("uses logical lines without a trailing phantom and preserves carriage returns", async () => {
  const fixture = createGrepFixture(
    [
      grepFileEntry("lines", "~/lines.txt", "lines"),
      grepFileEntry("empty", "~/empty.txt", "empty"),
    ],
    [
      { handle: "lines", path: "~/lines.txt", text: "hit\r\n\nhit\n" },
      { handle: "empty", path: "~/empty.txt", text: "" },
    ],
  );

  assert.equal(
    outputText(await execute("grep -n '' lines.txt", fixture.registry)),
    "1:hit\r\n2:\n3:hit",
  );
  assert.equal(outputText(await execute("grep -n '^$' lines.txt", fixture.registry)), "2:");
  assert.equal(
    outputText(await execute("grep -n '^hit\\r$' lines.txt", fixture.registry)),
    "1:hit\r",
  );
  assert.deepEqual(succeeded(await execute("grep '' empty.txt", fixture.registry)).outputs, []);
});

test("applies ordered sed scripts to typed stdin and one virtual line stream", async () => {
  const fixture = createGrepFixture(
    [
      grepFileEntry("one", "~/one.txt", "one"),
      grepFileEntry("two", "~/two.txt", "two"),
    ],
    [
      { handle: "one", path: "~/one.txt", text: "Alpha alpha\nbeta\nlast" },
      { handle: "two", path: "~/two.txt", text: "second\nlast two" },
    ],
  );

  for (const [source, expected] of [
    ["cat one.txt | sed 's/alpha/X/i'", "X alpha\nbeta\nlast"],
    ["echo ignored | sed -n -e '1p' -e '$p' one.txt two.txt", "Alpha alpha\nlast two"],
    ["sed -n -e '$p' -- *.txt", "last two"],
    ["sed -e '1p' -e '2d' one.txt", "Alpha alpha\nAlpha alpha\nlast"],
    ["sed -n -e '1,2p' -e '3,1p' -e '99p' one.txt", "Alpha alpha\nbeta\nlast"],
    ["sed -n -e 's/a/A/g' -e p one.txt two.txt", "AlphA AlphA\nbetA\nlAst\nsecond\nlAst two"],
    ["sed -n -e 's#(Alpha) (alpha)#&|\\1|\\&#' -e p one.txt", "Alpha alpha|Alpha|&\nbeta\nlast"],
    ["sed -n -e 's#last#last\\#tag#i' -e 's##done#' -e p one.txt", "Alpha alpha\nbeta\ndone#tag"],
  ]) {
    assert.equal(outputText(await execute(source, fixture.registry)), expected);
  }
  assert.equal(outputText(await execute("cat one.txt", fixture.registry)), "Alpha alpha\nbeta\nlast");
});

test("rejects every invalid sed option and script before reading or emitting", async () => {
  let reads = 0;
  const documents: VirtualDocumentSupplier = {
    read: (handle) => {
      reads += 1;
      return Promise.resolve({ kind: "missing", handle });
    },
  };
  const guarded = createGrepFixture(
    [grepFileEntry("one", "~/one.txt", "one")],
    [],
  );
  const registry = createCommandRegistry({
    filesystem: guarded.filesystem,
    commands: createReadOnlyCommandDefinitions({
      filesystem: guarded.filesystem,
      documents,
      manpages: generatedManpages,
      recursiveEntryLimit: 100,
    }),
  });

  for (const [source, message] of [
    ["sed -i 's/a/b/' one.txt", "Unsupported option: -i."],
    ["sed -e 'p' -e 's/[//g' one.txt", "Invalid regular expression"],
    ["sed -e 'p' -e '2q' one.txt", "Unsupported sed script: 2q"],
    ["sed -e 's/a/b/x' one.txt", "Unsupported substitution flags: x"],
    ["sed -e 's//b/' one.txt", "No previous substitution pattern."],
    ["sed 's/a/b' one.txt", "Substitution replacement is not terminated."],
    ["sed -n '0p' one.txt", "positive safe integers"],
    ["sed -n '9007199254740992p' one.txt", "positive safe integers"],
  ]) {
    assert.match(failureMessage(await execute(source, registry)), new RegExp(message, "u"));
  }

  assert.equal(failureMessage(await execute("sed p", registry)), "Usage: sed [-n] [-e script]... [script] [path ...]");
  assert.equal(reads, 0);
});

test("aggregates grep path, locked, and read failures without partial matches", async () => {
  const fixture = createGrepFixture(
    [
      grepFileEntry("good", "~/good.txt", "good"),
      grepFileEntry("unavailable", "~/unavailable.txt", "unavailable"),
      grepLockedEntry("locked", "~/locked.txt"),
      grepDirectoryEntry("dir", "~/dir"),
      grepFileEntry("nested", "~/dir/a.txt", "nested"),
      grepLockedEntry("nested-locked", "~/dir/b.txt"),
    ],
    [
      { handle: "good", path: "~/good.txt", text: "hit" },
      { handle: "nested", path: "~/dir/a.txt", text: "hit nested" },
    ],
  );
  const failed = await execute(
    "grep -r hit good.txt missing.txt unavailable.txt locked.txt dir",
    fixture.registry,
  );

  assert.deepEqual(failureMessages(failed), [
    "Path not found: ~/missing.txt",
    "Content is unavailable.",
    "Access is locked: ~/locked.txt",
    "Access is locked: ~/dir/b.txt",
  ]);
  assert.equal(failed.kind, "failed");
});

test("caps grep and sed output by lines and UTF-8 bytes", async () => {
  const lineLimited = createGrepFixture(
    [grepFileEntry("many", "~/many.txt", "many")],
    [{ handle: "many", path: "~/many.txt", text: Array.from({ length: 1001 }, () => "x").join("\n") }],
  );
  const byteLine = "x".repeat(600_000);
  const byteLimited = createGrepFixture(
    [grepFileEntry("large", "~/large.txt", "large")],
    [{ handle: "large", path: "~/large.txt", text: `${byteLine}\n${byteLine}` }],
  );
  const traversalLimited = createGrepFixture(
    [
      grepDirectoryEntry("dir", "~/dir"),
      grepFileEntry("a", "~/dir/a.txt", "a"),
      grepFileEntry("b", "~/dir/b.txt", "b"),
    ],
    [
      { handle: "a", path: "~/dir/a.txt", text: "x" },
      { handle: "b", path: "~/dir/b.txt", text: "x" },
    ],
    1,
  );
  const lineOutcome = await execute("grep x many.txt", lineLimited.registry);
  const pipedLineOutcome = await execute(
    "grep x many.txt | tail -n 1",
    lineLimited.registry,
  );
  const byteOutcome = await execute("grep x large.txt", byteLimited.registry);
  const traversalOutcome = await execute("grep -r x dir", traversalLimited.registry);
  const sedLines = await execute("sed p many.txt", lineLimited.registry);
  const sedBytes = await execute("sed p large.txt", byteLimited.registry);

  assert.equal(outputText(lineOutcome).split("\n").length, 1000);
  assert.deepEqual(runtimeTruncations(lineOutcome), [
    "grep output stopped before exceeding 1,000 matching lines or 1 MiB.",
  ]);
  assert.equal(outputText(pipedLineOutcome), "x");
  assert.deepEqual(runtimeTruncations(pipedLineOutcome), [
    "grep output stopped before exceeding 1,000 matching lines or 1 MiB.",
  ]);
  assert.equal(outputText(byteOutcome), byteLine);
  assert.deepEqual(runtimeTruncations(byteOutcome), [
    "grep output stopped before exceeding 1,000 matching lines or 1 MiB.",
  ]);
  assert.deepEqual(runtimeTruncations(traversalOutcome), ["grep stopped after 1 entries."]);
  assert.equal(outputText(sedLines).split("\n").length, 1000);
  assert.equal(outputText(sedBytes), byteLine);
  assert.deepEqual(runtimeTruncations(sedLines), ["sed output stopped before exceeding 1,000 lines or 1 MiB."]);
  assert.deepEqual(runtimeTruncations(sedBytes), ["sed output stopped before exceeding 1,000 lines or 1 MiB."]);
});

test("cancellation discards accumulated grep and sed output", async () => {
  let controller = new AbortController();
  const filesystem = createVirtualFilesystem({
    entries: [
      grepDirectoryEntry("root", "~"),
      grepFileEntry("a", "~/a.txt", "a"),
      grepFileEntry("b", "~/b.txt", "b"),
    ],
  });
  const documents: VirtualDocumentSupplier = {
    read: (handle) => {
      if (handle === "b") {
        controller.abort();
        return Promise.resolve({ kind: "cancelled" });
      }

      return Promise.resolve({
        kind: "available",
        document: { text: "hit", source: { path: "~/a.txt" } },
        classification: { kind: "page" },
      });
    },
  };
  const registry = createCommandRegistry({
    filesystem,
    commands: createReadOnlyCommandDefinitions({
      filesystem,
      documents,
      manpages: generatedManpages,
      recursiveEntryLimit: 100,
    }),
  });
  const outcome = await executeWithSignal(
    "grep hit a.txt b.txt | head -n 1 ; echo later",
    registry,
    controller.signal,
  );
  controller = new AbortController();
  const sedOutcome = await executeWithSignal(
    "sed p a.txt b.txt ; echo later",
    registry,
    controller.signal,
  );

  assert.equal(outcome.kind, "cancelled");
  assert.equal(sedOutcome.kind, "cancelled");
  assert.equal(
    outcome.events.some(
      (event) => event.kind === "output" && event.output.kind === "text",
    ),
    false,
  );
  assert.equal(
    sedOutcome.events.some(
      (event) => event.kind === "output" && event.output.kind === "text",
    ),
    false,
  );
});

test("reports empty, missing, unsupported-option, and cancelled command outcomes", async () => {
  const registry = createRegistry();
  const emptyRequest = { ...commandRequest("echo"), source: "" };
  const empty = await executeCommandLine({
    registry,
    request: emptyRequest,
    signal: new AbortController().signal,
  });
  const missing = await execute("cat missing.md", registry);
  const option = await execute("ls -z", registry);
  const cancelled = await execute(
    "grep demo about.md",
    createRegistry(100, {
      read: () => Promise.resolve({ kind: "cancelled" }),
    }),
  );
  const abortController = new AbortController();
  abortController.abort();
  const treeCancelled = await executeWithSignal(
    "ls --tree",
    registry,
    abortController.signal,
  );

  assert.equal(empty.kind, "failed");
  assert.equal(missing.kind, "failed");
  assert.equal(option.kind, "failed");
  assert.equal(cancelled.kind, "cancelled");
  assert.equal(treeCancelled.kind, "cancelled");
});

test("routes unexpected supplier failures through the execution boundary", async () => {
  const cause = new Error("Unexpected supplier failure.");
  const outcome = await execute(
    "cat about.md",
    createRegistry(100, {
      read: async () => {
        throw cause;
      },
    }),
  );

  assert.equal(outcome.kind, "failed");
  if (outcome.kind !== "failed") {
    return;
  }

  assert.equal(outcome.failure.kind, "execution-error");
  if (outcome.failure.kind !== "execution-error") {
    return;
  }

  assert.strictEqual(outcome.failure.cause, cause);
  const diagnostics = outcome.events.flatMap((event) =>
    event.kind === "output" && event.output.kind === "diagnostic"
      ? [event.output.diagnostic]
      : []
  );

  assert.equal(diagnostics[0]?.code, "runtime.execution-failed");
  assert.equal(diagnostics[0]?.message, "The command could not complete.");
  assert.equal(
    diagnostics.some((diagnostic) => diagnostic.message.includes(cause.message)),
    false,
  );
});

test("normalizes non-Error supplier failures at the execution boundary", async () => {
  const thrown = { kind: "unexpected-supplier-failure" };
  const outcome = await execute(
    "cat about.md",
    createRegistry(100, {
      read: async () => {
        throw thrown;
      },
    }),
  );

  assert.equal(outcome.kind, "failed");
  if (outcome.kind !== "failed") {
    return;
  }

  assert.equal(outcome.failure.kind, "execution-error");
  if (outcome.failure.kind !== "execution-error") {
    return;
  }

  assert.equal(outcome.failure.cause.message, "Command execution failed.");
  assert.strictEqual(outcome.failure.cause.cause, thrown);
  const diagnosticEvent = outcome.events.find(
    (event) => event.kind === "output" && event.output.kind === "diagnostic",
  );

  if (
    diagnosticEvent?.kind !== "output" ||
    diagnosticEvent.output.kind !== "diagnostic"
  ) {
    assert.fail("Expected the execution failure diagnostic.");
  }

  assert.equal(diagnosticEvent.output.diagnostic.code, "runtime.execution-failed");
});
