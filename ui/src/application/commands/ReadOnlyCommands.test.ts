import assert from "node:assert/strict";
import test from "node:test";
import { developmentFixtureCorpus } from "../../content/DevelopmentFixtureCorpus.ts";
import {
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
import { createReadOnlyCommandDefinitions } from "./ReadOnlyCommands.ts";

function createRegistry(
  recursiveEntryLimit = 100,
  documents: VirtualDocumentSupplier = developmentFixtureCorpus.documents,
): CommandRegistry {
  return createCommandRegistry({
    commands: createReadOnlyCommandDefinitions({
      filesystem: developmentFixtureCorpus.filesystem,
      documents,
      recursiveEntryLimit,
    }),
  });
}

function commandRequest(
  source: string,
  currentDirectory: VirtualDirectoryPath = virtualHomeDirectory(),
): ShellCommandRequest {
  const initial = createShellState({
    id: createShellId("terminal"),
    sessionId: createShellSessionId("session"),
    currentDirectory,
    scrollbackLimit: 10,
    commandHistoryLimit: 10,
  });
  const typed = reduceShellState(initial, { kind: "input.insert", text: source });
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
): Promise<CommandOutcome> {
  return executeCommandLine({
    registry,
    request: commandRequest(source, currentDirectory),
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
  const listing = succeeded(await execute("ls -al", registry));
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

  const table = listing.outputs[0];

  if (table === undefined || table.kind !== "table") {
    assert.fail("Expected a long ls table.");
  }

  assert.deepEqual(
    table.rows.slice(0, 2).map((row) => row.cells[0]?.value),
    [".", ".."],
  );
  assert.equal(quoted, "# About\n\nDeterministic development fixture content.");
  assert.equal(relative, quoted);
  assert.equal(pwd, "~/projects");
  assert.equal(projects, "~");
});

test("implements line readers, utility commands, history, manual metadata, and pager effects", async () => {
  const registry = createRegistry();
  const head = outputText(await execute("head -n 1 about.md", registry));
  const tail = outputText(await execute("tail -n 1 about.md", registry));
  const echo = outputText(await execute('echo "hello terminal"', registry));
  const whoami = outputText(await execute("whoami", registry));
  const history = succeeded(await execute("history", registry));
  const manual = succeeded(await execute("man grep", registry));
  const pager = succeeded(await execute("less notes/sample-note.md", registry));
  const clear = succeeded(await execute("clear", registry));

  assert.equal(head, "# About");
  assert.equal(tail, "Deterministic development fixture content.");
  assert.equal(echo, "hello terminal");
  assert.equal(whoami, "anonymous");

  const historyOutput = history.outputs[0];
  if (historyOutput === undefined || historyOutput.kind !== "table") {
    assert.fail("Expected history table output.");
  }
  assert.equal(historyOutput.rows[0]?.cells[1]?.value, "history");

  const manualOutput = manual.outputs[0];
  if (manualOutput === undefined || manualOutput.kind !== "rich") {
    assert.fail("Expected manual metadata output.");
  }
  assert.equal(manualOutput.title, "grep manual");
  assert.equal(manualOutput.fields[0]?.value, "grep [-i] [-n] <pattern> [path]");

  const pagerEffect = pager.effects.find(
    (effect) => effect.kind === "open-raw-pager",
  );
  if (pagerEffect === undefined || pagerEffect.kind !== "open-raw-pager") {
    assert.fail("Expected raw pager effect.");
  }
  assert.equal(pagerEffect.document.source.path, "~/notes/sample-note.md");
  assert.deepEqual(clear.effects, [{ kind: "clear-scrollback" }]);
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
  assert.match(outputText(grep), /:3:Typed modelling/u);
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
    "grep fixture about.md",
    createRegistry(100, {
      read: () => Promise.resolve({ kind: "cancelled" }),
    }),
  );

  assert.equal(empty.kind, "failed");
  assert.equal(missing.kind, "failed");
  assert.equal(option.kind, "failed");
  assert.equal(cancelled.kind, "cancelled");
});
