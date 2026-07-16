import assert from "node:assert/strict";
import test from "node:test";
import { demoContentCorpus } from "../../content/DemoContentCorpus.ts";
import {
  createVirtualFilesystem,
  virtualHomeDirectory,
  type VirtualDirectoryPath,
  type VirtualDocumentSupplier,
} from "../../domain/filesystem/VirtualFilesystem.ts";
import {
  createShellId,
  createShellSessionId,
  createShellState,
  reduceShellState,
  type CommandOutcome,
  type ShellCommandRequest,
} from "../../domain/terminal/Shell.ts";
import { executeCommandLine } from "./CommandExecution.ts";
import {
  createCommandRegistry,
  resolveCommand,
  type CommandRegistry,
} from "./CommandRegistry.ts";
import {
  createReadOnlyCommandDefinitions,
} from "./ReadOnlyCommands.ts";

function createRegistry(
  recursiveEntryLimit = 100,
  documents: VirtualDocumentSupplier = demoContentCorpus.documents,
): CommandRegistry {
  return createCommandRegistry({
    commands: createReadOnlyCommandDefinitions({
      filesystem: demoContentCorpus.filesystem,
      documents,
      recursiveEntryLimit,
    }),
  });
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
    commandHistoryLimit: 10,
  });

  for (const command of previousCommands) {
    state = reduceShellState(state, { kind: "input.insert", text: command });
    state = reduceShellState(state, { kind: "prompt.submit" });

    if (state.lifecycle.kind !== "running") {
      assert.fail("Expected a prior command request.");
    }

    state = reduceShellState(state, {
      kind: "command.settled",
      commandId: state.lifecycle.command.id,
      outcome: { kind: "succeeded", outputs: [], effects: [] },
    });
  }

  const typed = reduceShellState(state, { kind: "input.insert", text: source });
  const submitted = reduceShellState(typed, { kind: "prompt.submit" });

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
): Promise<CommandOutcome> {
  return executeCommandLine({
    registry,
    request: commandRequest(source, currentDirectory, previousCommands),
    signal: new AbortController().signal,
  });
}

function succeeded(outcome: CommandOutcome): Extract<CommandOutcome, { kind: "succeeded" }> {
  if (outcome.kind !== "succeeded") {
    assert.fail("Expected a successful command outcome.");
  }

  return outcome;
}

function outputText(outcome: CommandOutcome): string {
  const successful = succeeded(outcome);
  const output = successful.outputs.find((candidate) => candidate.kind === "text");

  if (output === undefined || output.kind !== "text") {
    assert.fail("Expected text output.");
  }

  return output.text;
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
  const manual = outputText(await execute("man grep", registry));
  const pager = succeeded(await execute("less notes/sample-note.md", registry));
  const clear = succeeded(await execute("clear", registry));

  assert.equal(head, "# About");
  assert.equal(
    tail,
    "This is a deterministic offline demonstration of a terminal workspace. It contains synthetic content only.",
  );
  assert.equal(echo, "hello terminal");
  assert.equal(whoami, "anonymous");

  assert.equal(history, "1  echo first\n2  echo 😀 second\n3  history");
  assert.match(manual, /^GREP\(1\).*GREP\(1\)$/mu);
  assert.match(manual, /\nNAME\n       grep - Search raw virtual document text\./u);
  assert.match(manual, /\nSYNOPSIS\n       grep \[-i\] \[-n\] <pattern> \[path\]/u);
  assert.match(manual, /\nOPTIONS\n       Supported options are shown in SYNOPSIS\./u);
  assert.match(manual, /\nEXAMPLES\n       \$ grep -n fixture about\.md/u);
  assert.match(manual, /\nSEE ALSO\n       help\(1\), man\(1\)/u);

  const pagerEffect = pager.effects.find(
    (effect) => effect.kind === "open-viewer",
  );
  if (pagerEffect === undefined || pagerEffect.kind !== "open-viewer") {
    assert.fail("Expected raw pager effect.");
  }
  if (pagerEffect.viewer.kind !== "document") {
    assert.fail("Expected raw document viewer content.");
  }
  assert.equal(pagerEffect.viewer.document.source.path, "~/notes/sample-note.md");
  assert.equal(pagerEffect.viewer.presentation, "raw-pager");
  assert.deepEqual(clear.effects, [{ kind: "clear-scrollback" }]);
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
    commands: createReadOnlyCommandDefinitions({
      filesystem,
      documents: demoContentCorpus.documents,
      recursiveEntryLimit: 100,
    }),
  });
  const longListing = outputText(await execute("ls -al", registry));
  const normalListing = outputText(await execute("ls", registry));
  const emptyListing = outputText(await execute("ls empty", registry));

  assert.match(longListing, /^dr-xr-xr-x\s+0\s+2026-02-01T00:00:00 UTC \.\/$/mu);
  assert.match(longListing, /^----------\s+144\s+2026-02-05T00:00:00 UTC cv\.md \[locked\]$/mu);
  assert.match(longListing, /目录\/$/mu);
  assert.match(longListing, /a-very-long-unicode-name-長い😀\.md$/mu);
  assert.equal(normalListing.includes(".hidden.md"), false);
  assert.equal(emptyListing, "");
});

test("searches with documented flags and marks bounded recursive results", async () => {
  const registry = createRegistry(2);
  const find = succeeded(await execute("find -name '*.md'", registry));
  const grep = succeeded(await execute("grep -in typed", createRegistry()));
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
  assert.match(outputText(grep), /:3:Typed domain modelling/u);
  assert.equal(shallowTree, "~");
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

  assert.equal(empty.kind, "failed");
  assert.equal(missing.kind, "failed");
  assert.equal(option.kind, "failed");
  assert.equal(cancelled.kind, "cancelled");
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
  assert.equal(outcome.diagnostics[0]?.code, "runtime.execution-failed");
  assert.equal(outcome.diagnostics[0]?.message, "The command could not complete.");
  assert.equal(
    outcome.diagnostics.some((diagnostic) => diagnostic.message.includes(cause.message)),
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
  assert.equal(outcome.diagnostics[0]?.code, "runtime.execution-failed");
});
