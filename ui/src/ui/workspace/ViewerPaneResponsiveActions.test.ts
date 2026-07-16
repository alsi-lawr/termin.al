import assert from "node:assert/strict";
import test from "node:test";
import {
  createElement,
  isValidElement,
  type ReactElement,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { ContentId } from "../../api/ContentContracts.ts";

function contentId(value: string): ContentId {
  const validation = ContentId.tryCreate(value, "responsive viewer test content");

  if (validation.kind === "invalid") {
    assert.fail(validation.message);
  }

  return validation.value;
}

type ViewerPaneTestProps = Readonly<{
  viewer: unknown;
  isActive: boolean;
  focusVersion: number;
  onActivate: () => void;
  onPaneKeyInput: () => Readonly<{ kind: "unhandled" }>;
  mobileCtrlPressed: boolean;
  onToggleMobileCtrl: () => void;
  onConsumeMobileCtrl: () => void;
  resolveMobileCtrlInput: (input: unknown) => Readonly<{
    input: unknown;
    mobileCtrlApplied: boolean;
  }>;
  onAcceptedContentOpen: (contentId: ContentId) => void;
  onClose: () => void;
}>;

function isViewerPaneModule(
  value: unknown,
): value is Readonly<{
  ViewerPane: (props: ViewerPaneTestProps) => ReactElement;
}> {
  return (
    typeof value === "object" &&
    value !== null &&
    "ViewerPane" in value &&
    typeof value.ViewerPane === "function"
  );
}

async function renderViewerPane(viewer: unknown): Promise<string> {
  const vite = await createServer({
    appType: "custom",
    server: { middlewareMode: true, hmr: false, ws: false },
  });

  try {
    const loadedModule: unknown = await vite.ssrLoadModule(
      "/src/ui/workspace/ViewerPane.tsx",
    );

    if (!isViewerPaneModule(loadedModule)) {
      assert.fail("Expected ViewerPane to be available.");
    }

    const rendered = createElement(loadedModule.ViewerPane, {
      viewer,
      isActive: true,
      focusVersion: 0,
      onActivate: () => undefined,
      onPaneKeyInput: (): Readonly<{ kind: "unhandled" }> => ({
        kind: "unhandled",
      }),
      mobileCtrlPressed: false,
      onToggleMobileCtrl: () => undefined,
      onConsumeMobileCtrl: () => undefined,
      resolveMobileCtrlInput: (input: unknown) => ({
        input,
        mobileCtrlApplied: false,
      }),
      onAcceptedContentOpen: () => undefined,
      onClose: () => undefined,
    });

    if (!isValidElement(rendered)) {
      assert.fail("Expected ViewerPane to render.");
    }

    return renderToStaticMarkup(rendered);
  } finally {
    await vite.close();
  }
}

test("keeps viewer return touch-accessible but hidden at desktop width", async () => {
  const markup = await renderViewerPane({
    kind: "placeholder",
    title: "Preview",
  });

  assert.equal(markup.includes('tabindex="0"'), true);
  assert.match(
    markup,
    /<button[^>]*class="[^"]*md:hidden[^"]*"[^>]*>Return<\/button>/u,
  );
});

test("renders less as raw text with an inverse prompt above mobile controls", async () => {
  const text = Array.from(
    { length: 25 },
    (_, index) => `line ${index + 1}\n`,
  ).join("");
  const markup = await renderViewerPane({
    kind: "document",
    title: "sample-note.md",
    presentation: "raw-pager",
    document: {
      text,
      source: { path: "~/notes/sample-note.md" },
    },
    statsIdentity: {
      kind: "countable",
      contentId: contentId("sample-note"),
    },
  });

  assert.equal(markup.includes('aria-label="Current less page"'), true);
  assert.equal(markup.includes("line 1\n"), true);
  assert.equal(markup.includes("line 20\n"), true);
  assert.equal(markup.includes("line 21\n"), false);
  assert.equal(markup.includes("<h2"), false);
  assert.equal(markup.includes(">Return</button>"), false);
  assert.equal(markup.includes('aria-label="Viewer navigation status"'), false);
  assert.equal(markup.includes("aria-current"), false);
  assert.equal(markup.includes("bg-surface-highlight"), false);
  assert.equal(markup.includes("PageUp/b"), false);
  assert.equal(
    markup.includes(
      'class="shrink-0 bg-text-primary px-1 text-surface-deepest"',
    ),
    true,
  );

  const promptPosition = markup.indexOf(
    'aria-label="Less prompt">sample-note.md 80%</div>',
  );
  const mobileControlsPosition = markup.indexOf(
    'aria-label="Mobile terminal controls"',
  );

  assert.notEqual(promptPosition, -1);
  assert.equal(mobileControlsPosition > promptPosition, true);
});

test("renders complete vi manpages in the native read-only Vim editor", async () => {
  const text = Array.from(
    { length: 25 },
    (_, index) => `manual line ${index + 1}\n`,
  ).join("");
  const markup = await renderViewerPane({
    kind: "document",
    title: "ls(1)",
    presentation: "vi-manpager",
    document: {
      text,
      source: { path: "man/ls.1" },
    },
    statsIdentity: { kind: "uncounted" },
  });

  assert.equal(markup.includes('aria-label="ls(1) editor"'), true);
  assert.equal(markup.includes('aria-label="ls(1) editor text"'), true);
  assert.equal(markup.includes('aria-readonly="true"'), true);
  assert.equal(markup.includes("<textarea"), true);
  assert.equal(markup.includes("manual line 1\n"), true);
  assert.equal(markup.includes("manual line 20\n"), true);
  assert.equal(markup.includes("manual line 21\n"), true);
  assert.equal(markup.includes("manual line 25\n"), true);
  assert.equal(markup.includes("&gt; manual line"), false);
  assert.equal(markup.includes('aria-current="true"'), false);
  assert.equal(markup.includes("bg-surface-highlight"), false);
  assert.equal(markup.includes('aria-label="Less prompt"'), false);
  assert.equal(markup.includes(">NORMAL</span>"), true);
  assert.equal(markup.includes(">ls(1)</h2>"), true);
  assert.equal(markup.includes("Line 1/25"), false);
  assert.equal(markup.includes(">Return</button>"), false);

  const editorPosition = markup.indexOf('aria-label="ls(1) editor text"');
  const mobileControlsPosition = markup.indexOf(
    'aria-label="Mobile terminal controls"',
  );

  assert.equal(markup.includes('aria-label="Viewer navigation status"'), false);
  assert.notEqual(editorPosition, -1);
  assert.equal(mobileControlsPosition > editorPosition, true);
});

test("renders hierarchical collections as terminal rows with explicit touch controls and no viewer page chrome", async () => {
  const markup = await renderViewerPane({
    kind: "collection",
    title: "Projects",
    emptyMessage: "No projects. Press Esc to return.",
    roots: [
      {
        kind: "branch",
        id: "branch:engineering",
        title: "engineering",
        path: "engineering",
        children: [
          {
            kind: "leaf",
            id: "project:terminal",
            title: "termin.al",
            path: "engineering/termin.al",
            summary: "A keyboard-first terminal.",
            tags: ["typescript"],
            metadata: "alsi-lawr/termin.al",
            documentTitle: "termin.al README",
            document: { text: "# termin.al", source: { path: "~/projects/termin.al" } },
            repositoryUrl: "https://github.com/alsi-lawr/termin.al",
            statsIdentity: {
              kind: "countable",
              contentId: contentId("terminal"),
            },
          },
        ],
      },
    ],
  });

  assert.equal(markup.includes('role="listbox"'), true);
  assert.equal(markup.includes('role="option"'), true);
  assert.equal(markup.includes('aria-selected="true"'), true);
  assert.equal(markup.includes('aria-label="Collection touch controls"'), true);
  assert.equal(markup.includes(">Left</button>"), true);
  assert.equal(markup.includes(">Right</button>"), true);
  assert.equal(markup.includes(">Toggle</button>"), true);
  assert.equal(markup.includes(">Open</button>"), true);
  assert.equal(markup.includes(">Shell</button>"), true);
  assert.equal(markup.includes("<h2"), false);
  assert.equal(markup.includes("Selected item details"), false);
  assert.equal(markup.includes(">Return</button>"), false);
});
