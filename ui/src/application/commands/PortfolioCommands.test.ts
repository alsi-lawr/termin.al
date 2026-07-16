import assert from "node:assert/strict";
import test from "node:test";
import { demoContentCorpus } from "../../content/DemoContentCorpus.ts";
import {
  createVirtualTimestamp,
  createVirtualFilesystem,
  resolveVirtualPath,
  virtualHomeDirectory,
  type VirtualDocumentSupplier,
  type VirtualFilesystem,
  type VirtualCorpusCatalogEntry,
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
import type {
  ViewerCollectionLeaf,
  ViewerCollectionNode,
} from "../../content/ViewerContent.ts";

function collectionLeaves(
  nodes: ReadonlyArray<ViewerCollectionNode>,
): ReadonlyArray<ViewerCollectionLeaf> {
  return nodes.flatMap((node) =>
    node.kind === "leaf" ? [node] : collectionLeaves(node.children)
  );
}

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
  assert.equal(splitEffect.viewer.kind, "collection");
  if (splitEffect.viewer.kind === "collection") {
    const project = collectionLeaves(splitEffect.viewer.roots)[0];

    assert.equal(project?.title, "Sample Project");
    assert.equal(
      project?.metadata,
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
    assert.equal(project?.path, "demonstrations/typed-applications/Sample Project");
  }
});

test("builds blog and note listings with document-open data", async () => {
  const registry = createRegistry();
  const blog = succeeded(await execute("blog", registry));
  const repeatedBlog = succeeded(await execute("blog", registry));
  const notes = succeeded(await execute("notes", registry));
  const blogEffect = blog.effects[0];
  const repeatedBlogEffect = repeatedBlog.effects[0];
  const notesEffect = notes.effects[0];

  if (
    blogEffect === undefined ||
    blogEffect.kind !== "open-viewer" ||
    repeatedBlogEffect === undefined ||
    repeatedBlogEffect.kind !== "open-viewer" ||
    notesEffect === undefined ||
    notesEffect.kind !== "open-viewer"
  ) {
    assert.fail("Expected publication viewer effects.");
  }

  assert.equal(blogEffect.viewer.kind, "collection");
  assert.equal(repeatedBlogEffect.viewer.kind, "collection");
  assert.equal(notesEffect.viewer.kind, "collection");

  if (
    blogEffect.viewer.kind === "collection" &&
    repeatedBlogEffect.viewer.kind === "collection" &&
    notesEffect.viewer.kind === "collection"
  ) {
    const blogEntries = collectionLeaves(blogEffect.viewer.roots);
    const repeatedBlogEntries = collectionLeaves(repeatedBlogEffect.viewer.roots);
    const noteEntries = collectionLeaves(notesEffect.viewer.roots);
    assert.deepEqual(
      blogEntries.map((entry) => ({
        title: entry.title,
        publishedAt: entry.metadata,
        tags: entry.tags,
      })),
      [
        {
          title: "Deterministic Demos",
          publishedAt: "2026-01-12",
          tags: ["demo", "offline"],
        },
        {
          title: "Stable Interfaces",
          publishedAt: "2026-01-05",
          tags: ["typescript", "interfaces"],
        },
      ],
    );
    assert.equal(
      blogEntries[1]?.summary,
      "Validated metadata about typed outcomes and explicit dependencies.",
    );
    assert.doesNotMatch(
      blogEntries[1]?.document.text ?? "",
      /Validated metadata about typed outcomes/u,
    );
    assert.deepEqual(
      repeatedBlogEntries,
      blogEntries,
      "Demo publication data must remain deterministic across reads.",
    );
    assert.equal(noteEntries[0]?.title, "Local Paths");
    assert.deepEqual(noteEntries[0]?.tags, [
      "filesystem",
      "determinism",
    ]);
    assert.equal(noteEntries[0]?.document.source.path, "~/notes/field-notes/filesystems/sample-note.md");
  }

  const samplePost = resolveVirtualPath(
    demoContentCorpus.filesystem,
    virtualHomeDirectory(),
    "blog/engineering/interfaces/sample-post.md",
  );
  const deterministicDemo = resolveVirtualPath(
    demoContentCorpus.filesystem,
    virtualHomeDirectory(),
    "blog/engineering/demos/deterministic-demo.md",
  );

  if (
    samplePost.kind !== "found" ||
    samplePost.node.kind !== "file" ||
    deterministicDemo.kind !== "found" ||
    deterministicDemo.node.kind !== "file"
  ) {
    assert.fail("Expected deterministic demo publication files.");
  }

  assert.equal(
    samplePost.node.updatedAt > deterministicDemo.node.updatedAt,
    true,
    "Catalog update order must differ from publication order in this fixture.",
  );
});

test("bounds recursive publication loading at the existing traversal limit", async () => {
  const timestamp = "2026-01-01T00:00:00.000Z";
  const files: ReadonlyArray<VirtualCorpusCatalogEntry> = Array.from(
    { length: 101 },
    (_, index) => {
    const suffix = index.toString().padStart(3, "0");
    return {
      kind: "file",
      id: `post-${suffix}`,
      path: `~/blog/post-${suffix}.md`,
      updatedAt: timestamp,
      size: 1,
      documentHandle: `post-${suffix}`,
    };
    },
  );
  const filesystem = createVirtualFilesystem({
    entries: [
      { kind: "directory", id: "home", path: "~", updatedAt: timestamp, size: 0 },
      { kind: "directory", id: "blog", path: "~/blog", updatedAt: timestamp, size: 0 },
      ...files,
    ],
  });
  let reads = 0;
  const documents: VirtualDocumentSupplier = {
    read: (handle, signal) => {
      if (signal.aborted) {
        return Promise.resolve({ kind: "cancelled" });
      }

      reads += 1;
      return Promise.resolve({
        kind: "available",
        document: { text: `# ${handle}`, source: { path: `~/blog/${handle}.md` } },
        classification: {
          kind: "publication",
          publicationKind: "blog",
          slug: handle,
          title: handle,
          summary: `Summary for ${handle}`,
          publishedAt: createVirtualTimestamp(timestamp),
          tags: [],
        },
      });
    },
  };
  const outcome = succeeded(await execute("blog", createRegistry(
    documents,
    createThemeController(),
    filesystem,
    [],
  )));
  const effect = outcome.effects[0];

  if (
    effect === undefined ||
    effect.kind !== "open-viewer" ||
    effect.viewer.kind !== "collection"
  ) {
    assert.fail("Expected a bounded blog collection.");
  }

  assert.equal(reads, 100);
  assert.equal(collectionLeaves(effect.viewer.roots).length, 100);
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

  assert.equal(effect.viewer.kind, "collection");
  if (effect.viewer.kind === "collection") {
    assert.deepEqual(effect.viewer.roots, []);
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
  assert.equal(projectsEffect.viewer.kind, "collection");
  assert.equal(cv.kind, "failed");
  assert.equal(invalidOpen.kind, "failed");
  assert.deepEqual(
    unavailable.map((outcome) => outcome.kind),
    ["failed", "failed", "failed", "failed"],
  );
});
