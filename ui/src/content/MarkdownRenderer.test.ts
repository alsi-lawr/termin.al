import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createVirtualDocumentHandle } from "../domain/filesystem/VirtualFilesystem.ts";
import { demoContentCorpus } from "./DemoContentCorpus.ts";
import type { MarkdownDocument } from "./MarkdownDocument.ts";
import {
  MarkdownRenderer,
  markdownSearchMatches,
} from "./MarkdownRenderer.ts";

const renderedMarkdown: MarkdownDocument = {
  source: { path: "~/rendered.md" },
  text: `# Heading

Paragraph with **strong**, *emphasis*, ~~strike~~, \`code\`, https://example.com, and www.example.org.

> Quote

- [x] completed task
- [ ] pending task

1. first item
2. second item

| Name | Value |
| :--- | ---: |
| escaped \\| pipe | 42 |

![Safe image](https://images.example.com/diagram.png)

[External link](https://example.com/document)

[Blocked link](javascript:alert("blocked"))

![Blocked image](data:text/plain,blocked)

---

\`\`\`ts
const answer = 42;
\`\`\`

<script>alert("not rendered")</script>
`,
};

function render(document: MarkdownDocument, activeBlockIndex: number | undefined): string {
  return renderToStaticMarkup(
    createElement(MarkdownRenderer, { document, activeBlockIndex }),
  );
}

test("renders themed safe GFM blocks and inline content", () => {
  const markup = render(renderedMarkdown, undefined);

  for (const expected of [
    "Heading",
    "strong",
    "emphasis",
    "strike",
    "completed task",
    "first item",
    "escaped | pipe",
    "Safe image",
    "External link",
    "const answer = 42;",
  ]) {
    assert.match(markup, new RegExp(expected, "u"));
  }

  assert.match(markup, /<blockquote/u);
  assert.match(markup, /<table/u);
  assert.match(markup, /type="checkbox"/u);
  assert.match(markup, /loading="lazy"/u);
  assert.match(markup, /referrer[Pp]olicy="no-referrer"/u);
  assert.match(markup, /target="_blank"/u);
  assert.match(markup, /rel="noopener noreferrer"/u);
  assert.match(markup, /unsafe link blocked/u);
  assert.match(markup, /unsafe image blocked/u);
  assert.match(markup, /text-markup-heading-1/u);
  assert.match(markup, /text-markup-link/u);
  assert.doesNotMatch(markup, /<script/u);
  assert.doesNotMatch(markup, /javascript:/u);
  assert.doesNotMatch(markup, /data:text/u);
});

test("preserves allowed Markdown URL destinations", () => {
  const markup = render(
    {
      source: { path: "~/safe-destinations.md" },
      text: `[Relative](/guide)

[Fragment](#details)

[Query](?tab=source)

[HTTP](http://example.com/guide)

[HTTPS](https://example.com/guide)

[Email](mailto:reader@example.com)

![Relative image](/images/guide.png)

![Fragment image](#diagram)

![Query image](?size=large)

![HTTP image](http://images.example.com/guide.png)

![HTTPS image](https://images.example.com/guide.png)

![Email image](mailto:reader@example.com)`,
    },
    undefined,
  );

  for (const destination of [
    "/guide",
    "#details",
    "?tab=source",
    "http://example.com/guide",
    "https://example.com/guide",
    "mailto:reader@example.com",
  ]) {
    assert.ok(markup.includes(`href="${destination}"`));
  }

  for (const destination of [
    "/images/guide.png",
    "#diagram",
    "?size=large",
    "http://images.example.com/guide.png",
    "https://images.example.com/guide.png",
  ]) {
    assert.ok(markup.includes(`src="${destination}"`));
  }

  assert.match(markup, /href="http:\/\/example\.com\/guide" target="_blank"/u);
  assert.match(markup, /href="https:\/\/example\.com\/guide" target="_blank"/u);
  assert.match(markup, /href="mailto:reader@example\.com" class=/u);
  assert.match(markup, /loading="lazy"/u);
  assert.match(markup, /referrer[Pp]olicy="no-referrer"/u);
  assert.match(markup, /unsafe image blocked: Email image/u);
  assert.doesNotMatch(markup, /src="mailto:/u);
  assert.doesNotMatch(markup, /markdown\.invalid/u);
});

test("blocks control-obfuscated javascript Markdown links and images", () => {
  for (const destination of [
    "java\tscript:alert(1)",
    "java\rscript:alert(1)",
  ]) {
    const markup = render(
      {
        source: { path: "~/obfuscated-destination.md" },
        text: `[Unsafe link](${destination})

![Unsafe image](${destination})`,
      },
      undefined,
    );

    assert.match(markup, /unsafe link blocked/u);
    assert.match(markup, /unsafe image blocked: Unsafe image/u);
    assert.doesNotMatch(markup, /<a\b/u);
    assert.doesNotMatch(markup, /<img\b/u);
  }
});

test("blocks protocol-relative, credentialed, malformed, and unsupported Markdown URLs", () => {
  for (const destination of [
    "//example.com/guide",
    "https://reader:secret@example.com/guide",
    "ftp://example.com/guide",
    "http://[::1",
  ]) {
    const markup = render(
      {
        source: { path: "~/blocked-destination.md" },
        text: `[Unsafe link](${destination})

![Unsafe image](${destination})`,
      },
      undefined,
    );

    assert.match(markup, /unsafe link blocked/u);
    assert.match(markup, /unsafe image blocked: Unsafe image/u);
    assert.doesNotMatch(markup, /<a\b/u);
    assert.doesNotMatch(markup, /<img\b/u);
  }
});

test("renders direct and supplier Markdown strings identically", async () => {
  const supplied = await demoContentCorpus.documents.read(
    createVirtualDocumentHandle("about"),
    new AbortController().signal,
  );

  if (supplied.kind !== "available") {
    assert.fail("Expected the demo corpus document to be available.");
  }

  const direct: MarkdownDocument = {
    source: { path: supplied.document.source.path },
    text: supplied.document.text,
  };

  assert.equal(render(direct, undefined), render(supplied.document, undefined));
});

test("finds parsed Markdown blocks for viewer search", () => {
  const matches = markdownSearchMatches(renderedMarkdown, "pipe");

  assert.deepEqual(matches, [5]);
  const markup = render(renderedMarkdown, matches[0]);

  assert.match(markup, /data-markdown-current="true"/u);
  assert.match(markup, /aria-current="true"/u);
  assert.match(markup, /ring-ui-search/u);
});

test("reports an unclosed fenced block without dropping its text", () => {
  const markup = render(
    {
      source: { path: "~/broken.md" },
      text: "```\nconst incomplete = true;",
    },
    undefined,
  );

  assert.match(markup, /const incomplete = true;/u);
  assert.match(markup, /Unclosed fenced code block/u);
  assert.match(markup, /role="alert"/u);
});
