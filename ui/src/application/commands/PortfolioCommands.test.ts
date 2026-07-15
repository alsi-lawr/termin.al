import assert from "node:assert/strict";
import test from "node:test";
import { demoContentCorpus } from "../../content/DemoContentCorpus.ts";
import {
  createVirtualFilesystem,
  virtualHomeDirectory,
  type VirtualDocumentSupplier,
  type VirtualFilesystem,
} from "../../domain/filesystem/VirtualFilesystem.ts";
import { createPaneId } from "../../domain/workspace/PaneTree.ts";
import {
  createShellId,
  createShellSessionId,
  createShellState,
  reduceShellState,
  type CommandOutcome,
  type ShellCommandRequest,
} from "../../domain/terminal/Shell.ts";
import {
  createThemeState,
  systemThemePreference,
  themeNames,
  themeStatus,
  withThemePreference,
  type ThemeController,
  type ThemeName,
  type ThemeState,
  type ThemeStatus,
} from "../../theme/Theme.ts";
import { executeCommandLine } from "./CommandExecution.ts";
import { createPaneCommandDefinition } from "./PaneCommand.ts";
import { createPortfolioCommandDefinitions } from "./PortfolioCommands.ts";
import { createReadOnlyCommandDefinitions } from "./ReadOnlyCommands.ts";
import { createCommandRegistry, type CommandRegistry } from "./CommandRegistry.ts";

function createThemeController(): ThemeController {
  let state: ThemeState = createThemeState(systemThemePreference, "dark");
  const status = (): ThemeStatus => themeStatus(state);

  return {
    list: () => themeNames,
    current: status,
    set: (theme: ThemeName) => {
      state = withThemePreference(state, { kind: "explicit", theme });
      return status();
    },
    followSystem: () => {
      state = withThemePreference(state, systemThemePreference);
      return status();
    },
  };
}

function createRegistry(
  documents: VirtualDocumentSupplier = demoContentCorpus.documents,
  themes: ThemeController = createThemeController(),
  filesystem: VirtualFilesystem = demoContentCorpus.filesystem,
  projectReadmes = demoContentCorpus.projectReadmes,
): CommandRegistry {
  return createCommandRegistry({
    commands: [
      ...createReadOnlyCommandDefinitions({
        filesystem,
        documents,
        recursiveEntryLimit: 100,
      }),
      ...createPortfolioCommandDefinitions({
        filesystem,
        documents,
        projectReadmes,
        themes,
      }),
      createPaneCommandDefinition(createPaneId("pane-1"), () => ({
        kind: "rejected",
        reason: "close-last-pane",
      })),
    ],
  });
}

function commandRequest(source: string): ShellCommandRequest {
  const initial = createShellState({
    id: createShellId("terminal"),
    sessionId: createShellSessionId("session"),
    currentDirectory: virtualHomeDirectory(),
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
): Promise<CommandOutcome> {
  return executeCommandLine({
    registry,
    request: commandRequest(source),
    signal: new AbortController().signal,
  });
}

function succeeded(outcome: CommandOutcome): Extract<CommandOutcome, { kind: "succeeded" }> {
  if (outcome.kind !== "succeeded") {
    assert.fail("Expected a successful command outcome.");
  }

  return outcome;
}

test("renders help and manual metadata as terminal-native text", async () => {
  const registry = createRegistry();
  const help = succeeded(await execute("help", registry));
  const manual = succeeded(await execute("man open", registry));
  const output = help.outputs[0];
  const manualOutput = manual.outputs[0];

  if (output === undefined || output.kind !== "text") {
    assert.fail("Expected terminal help output.");
  }

  if (manualOutput === undefined || manualOutput.kind !== "text") {
    assert.fail("Expected terminal manual output.");
  }

  assert.match(output.text, /^HELP\(1\).*HELP\(1\)$/mu);
  assert.match(output.text, /\nCOMMANDS\n       GNU-like commands/u);
  assert.match(output.text, /\n       Application commands\n         help/u);
  assert.match(output.text, /open +Open virtual content/u);
  assert.match(output.text, /pane +Manage terminal panes/u);
  assert.match(output.text, /about +Open about content/u);
  assert.match(output.text, /\nEXAMPLES\n       \$ help\n       \$ man ls/u);
  assert.match(manualOutput.text, /^OPEN\(1\).*OPEN\(1\)$/mu);
  assert.match(
    manualOutput.text,
    /\nSYNOPSIS\n       open \[--split horizontal\|vertical\] <target>/u,
  );
  assert.match(
    manualOutput.text,
    /\nEXAMPLES\n       \$ open about\.md\n       \$ open --split vertical projects/u,
  );
});

test("opens fixture documents inline and directory targets in requested split effects", async () => {
  const registry = createRegistry();
  const inline = succeeded(await execute("open about.md", registry));
  const split = succeeded(await execute("open --split vertical projects", registry));
  const inlineEffect = inline.effects[0];
  const splitEffect = split.effects[0];

  if (inlineEffect === undefined || inlineEffect.kind !== "open-viewer") {
    assert.fail("Expected an inline viewer effect.");
  }

  if (splitEffect === undefined || splitEffect.kind !== "open-viewer") {
    assert.fail("Expected a split viewer effect.");
  }

  assert.deepEqual(inlineEffect.disposition, { kind: "inline" });
  assert.equal(inlineEffect.viewer.kind, "document");
  if (inlineEffect.viewer.kind === "document") {
    assert.equal(inlineEffect.viewer.document.source.path, "~/about.md");
  }

  assert.deepEqual(splitEffect.disposition, {
    kind: "split",
    orientation: "vertical",
  });
  assert.equal(splitEffect.viewer.kind, "project-gallery");
  if (splitEffect.viewer.kind === "project-gallery") {
    const project = splitEffect.viewer.projects[0];

    assert.equal(project?.name, "Sample Project");
    assert.equal(
      project?.repository,
      "demo/sample-project",
    );
    assert.deepEqual(project?.tags, [
      "typescript",
      "fsharp",
    ]);
    assert.equal(
      project?.document.text,
      "# Sample Project README\n\nThis independently supplied README documents the deterministic demo project.",
    );
    assert.notEqual(project?.document.text, project?.summary);
  }
});

test("builds blog and note listings with document-open data", async () => {
  const registry = createRegistry();
  const blog = succeeded(await execute("blog", registry));
  const notes = succeeded(await execute("notes", registry));
  const blogEffect = blog.effects[0];
  const notesEffect = notes.effects[0];

  if (
    blogEffect === undefined ||
    blogEffect.kind !== "open-viewer" ||
    notesEffect === undefined ||
    notesEffect.kind !== "open-viewer"
  ) {
    assert.fail("Expected publication viewer effects.");
  }

  assert.equal(blogEffect.viewer.kind, "publication-list");
  assert.equal(notesEffect.viewer.kind, "publication-list");

  if (
    blogEffect.viewer.kind === "publication-list" &&
    notesEffect.viewer.kind === "publication-list"
  ) {
    assert.equal(blogEffect.viewer.publicationKind, "blog");
    assert.equal(blogEffect.viewer.entries[0]?.title, "Stable Interfaces");
    assert.match(blogEffect.viewer.entries[0]?.summary ?? "", /synthetic post/u);
    assert.equal(notesEffect.viewer.publicationKind, "notes");
    assert.equal(notesEffect.viewer.entries[0]?.document.source.path, "~/notes/sample-note.md");
  }
});

test("represents an empty public collection as an empty listing", async () => {
  const emptyFilesystem = createVirtualFilesystem({
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
        id: "blog",
        path: "~/blog",
        updatedAt: "2026-01-02T00:00:00.000Z",
        size: 0,
      },
    ],
  });
  const registry = createRegistry(
    demoContentCorpus.documents,
    createThemeController(),
    emptyFilesystem,
  );
  const outcome = succeeded(await execute("blog", registry));
  const effect = outcome.effects[0];

  if (effect === undefined || effect.kind !== "open-viewer") {
    assert.fail("Expected an empty publication viewer effect.");
  }

  assert.equal(effect.viewer.kind, "publication-list");
  if (effect.viewer.kind === "publication-list") {
    assert.deepEqual(effect.viewer.entries, []);
  }
});

test("routes portfolio supplier failures through the execution boundary", async () => {
  const cause = new Error("Unexpected supplier failure.");
  const outcome = await execute(
    "open about.md",
    createRegistry({
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
  assert.equal(
    outcome.diagnostics.some(
      (diagnostic) => diagnostic.code === "runtime.content-unavailable",
    ),
    false,
  );
});

test("lists, selects, and clears terminal theme selections", async () => {
  const themes = createThemeController();
  const registry = createRegistry(demoContentCorpus.documents, themes);
  const current = succeeded(await execute("theme", registry));
  const list = succeeded(await execute("theme list", registry));
  const set = succeeded(await execute("theme set gruber-lighter", registry));
  const explicit = succeeded(await execute("theme", registry));
  const system = succeeded(await execute("theme system", registry));
  const invalid = await execute("theme set not-a-theme", registry);

  const currentOutput = current.outputs[0];
  const listOutput = list.outputs[0];
  const setOutput = set.outputs[0];
  const explicitOutput = explicit.outputs[0];
  const systemOutput = system.outputs[0];

  if (
    currentOutput === undefined ||
    listOutput === undefined ||
    setOutput === undefined ||
    explicitOutput === undefined ||
    systemOutput === undefined ||
    currentOutput.kind !== "text" ||
    listOutput.kind !== "text" ||
    setOutput.kind !== "text" ||
    explicitOutput.kind !== "text" ||
    systemOutput.kind !== "text"
  ) {
    assert.fail("Expected terminal theme text output.");
  }

  assert.equal(currentOutput.text, "Current theme: gruber-dark-muted (system)");
  assert.match(listOutput.text, /gruber-lighter/u);
  assert.match(listOutput.text, /gruber-dark-muted \(current\)/u);
  assert.equal(setOutput.text, "Theme set: Current theme: gruber-lighter (explicit)");
  assert.equal(explicitOutput.text, "Current theme: gruber-lighter (explicit)");
  assert.equal(
    systemOutput.text,
    "Theme follows system: Current theme: gruber-dark-muted (system)",
  );
  assert.equal(invalid.kind, "failed");
});

test("provides discoverable navigation commands and useful unavailable-feature diagnostics", async () => {
  const registry = createRegistry();
  const about = succeeded(await execute("about", registry));
  const projects = succeeded(await execute("projects", registry));
  const cv = await execute("cv", registry);
  const invalidOpen = await execute("open --split diagonal about.md", registry);
  const unavailable = await Promise.all(
    ["stats", "login", "logout", "edit about.md"].map(
      async (source) => execute(source, registry),
    ),
  );

  const aboutEffect = about.effects[0];
  const projectsEffect = projects.effects[0];

  if (aboutEffect === undefined || aboutEffect.kind !== "open-viewer") {
    assert.fail("Expected the about navigation viewer effect.");
  }

  if (projectsEffect === undefined || projectsEffect.kind !== "open-viewer") {
    assert.fail("Expected the projects navigation viewer effect.");
  }

  assert.equal(aboutEffect.viewer.kind, "document");
  assert.equal(projectsEffect.viewer.kind, "project-gallery");
  assert.equal(cv.kind, "failed");
  assert.equal(invalidOpen.kind, "failed");
  assert.deepEqual(
    unavailable.map((outcome) => outcome.kind),
    ["failed", "failed", "failed", "failed"],
  );
});
