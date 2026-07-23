import { createElement, type ReactElement, type ReactNode } from "react";
import type { MarkdownDocument } from "./MarkdownDocument.ts";
import { MarkdownCodeBlock } from "./MarkdownCodeBlock.tsx";
import { isMarkdownFenceClosing, markdownFenceOpening } from "./MarkdownFence.ts";

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

type TableAlignment = "left" | "center" | "right";

type MarkdownListItem = Readonly<{
  text: string;
  task: "checked" | "unchecked" | undefined;
}>;

type MarkdownBlock =
  | Readonly<{
      kind: "heading";
      level: HeadingLevel;
      text: string;
    }>
  | Readonly<{
      kind: "paragraph";
      text: string;
    }>
  | Readonly<{
      kind: "quote";
      text: string;
    }>
  | Readonly<{
      kind: "list";
      ordered: boolean;
      items: ReadonlyArray<MarkdownListItem>;
    }>
  | Readonly<{
      kind: "table";
      header: ReadonlyArray<string>;
      alignment: ReadonlyArray<TableAlignment>;
      rows: ReadonlyArray<ReadonlyArray<string>>;
    }>
  | Readonly<{
      kind: "code";
      language: string | undefined;
      text: string;
    }>
  | Readonly<{ kind: "rule" }>
  | Readonly<{
      kind: "error";
      message: string;
    }>;

type UrlDecision =
  | Readonly<{
      kind: "safe";
      value: string;
      external: boolean;
    }>
  | Readonly<{ kind: "rejected" }>;

type MarkdownDestinationKind = "image" | "link";

type LinkSyntax = Readonly<{
  label: string;
  destination: string;
  next: number;
}>;

const rawHtmlPattern = /^<\/?[A-Za-z][^>]*>/u;
const autolinkPattern = /^<((?:https?:\/\/|mailto:)[^ >]+)>/u;
const urlPattern = /^(?:https?:\/\/|www\.)[^\s<]+/u;
const headingPattern = /^(#{1,6})\s+(.+?)\s*#*\s*$/u;
const quotePattern = /^ {0,3}>\s?(.*)$/u;
const listPattern = /^(\s*)([-+*]|\d+\.)\s+(.*)$/u;
const thematicBreakPattern = /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/u;
const tableDividerPattern = /^:?-{3,}:?$/u;
const markdownUrlBase = new URL("https://markdown.invalid/");

function lineAt(lines: ReadonlyArray<string>, index: number): string {
  return lines[index] ?? "";
}

function headingLevel(length: number): HeadingLevel | undefined {
  switch (length) {
    case 1:
      return 1;
    case 2:
      return 2;
    case 3:
      return 3;
    case 4:
      return 4;
    case 5:
      return 5;
    case 6:
      return 6;
    default:
      return undefined;
  }
}

function tableCells(line: string): ReadonlyArray<string> {
  const trimmed = line.trim();
  const start = trimmed.startsWith("|") ? 1 : 0;
  const end = trimmed.endsWith("|") ? trimmed.length - 1 : trimmed.length;
  const cells: Array<string> = [];
  let current = "";
  let escaped = false;

  for (let index = start; index < end; index += 1) {
    const character = trimmed[index] ?? "";

    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }

    if (character === "\\") {
      escaped = true;
      continue;
    }

    if (character === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += character;
  }

  if (escaped) {
    current += "\\";
  }

  cells.push(current.trim());
  return cells;
}

function tableAlignment(value: string): TableAlignment | undefined {
  const trimmed = value.trim();

  if (!tableDividerPattern.test(trimmed)) {
    return undefined;
  }

  const startsWithColon = trimmed.startsWith(":");
  const endsWithColon = trimmed.endsWith(":");

  if (startsWithColon && endsWithColon) {
    return "center";
  }

  return endsWithColon ? "right" : "left";
}

function tableDivider(line: string): ReadonlyArray<TableAlignment> | undefined {
  const cells = tableCells(line);
  const alignment: Array<TableAlignment> = [];

  for (const cell of cells) {
    const value = tableAlignment(cell);

    if (value === undefined) {
      return undefined;
    }

    alignment.push(value);
  }

  return alignment;
}

function parseListItem(text: string): MarkdownListItem {
  const task = /^\[([ xX])\]\s+(.*)$/u.exec(text);

  if (task === null) {
    return { text, task: undefined };
  }

  const marker = task[1];
  const content = task[2];

  if (marker === undefined || content === undefined) {
    return { text, task: undefined };
  }

  return {
    text: content,
    task: marker.toLowerCase() === "x" ? "checked" : "unchecked",
  };
}

function isTableStart(lines: ReadonlyArray<string>, index: number): boolean {
  const current = lineAt(lines, index);
  const divider = lineAt(lines, index + 1);
  const alignment = tableDivider(divider);

  return current.includes("|") && alignment !== undefined;
}

function isBlockStart(lines: ReadonlyArray<string>, index: number): boolean {
  const line = lineAt(lines, index);

  return (
    markdownFenceOpening(line) !== undefined ||
    headingPattern.test(line) ||
    quotePattern.test(line) ||
    listPattern.test(line) ||
    thematicBreakPattern.test(line) ||
    isTableStart(lines, index)
  );
}

function normalizedTableRow(
  cells: ReadonlyArray<string>,
  columnCount: number,
): ReadonlyArray<string> {
  const row: Array<string> = [];

  for (let index = 0; index < columnCount; index += 1) {
    row.push(cells[index] ?? "");
  }

  return row;
}

function parseBlocks(markdown: string): ReadonlyArray<MarkdownBlock> {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const blocks: Array<MarkdownBlock> = [];
  let index = 0;

  while (index < lines.length) {
    const line = lineAt(lines, index);

    if (line.trim() === "") {
      index += 1;
      continue;
    }

    const fence = markdownFenceOpening(line);

    if (fence !== undefined) {
      const codeLines: Array<string> = [];
      let closingIndex = index + 1;
      while (closingIndex < lines.length) {
        const candidate = lineAt(lines, closingIndex);
        if (isMarkdownFenceClosing(candidate, fence)) break;
        codeLines.push(candidate);
        closingIndex += 1;
      }
      blocks.push({
        kind: "code",
        language: fence.infoString === "" ? undefined : fence.infoString,
        text: codeLines.join("\n"),
      });
      if (closingIndex === lines.length) blocks.push({
        kind: "error",
        message: "Unclosed fenced code block rendered to the end of the document.",
      });
      index = closingIndex === lines.length ? closingIndex : closingIndex + 1;
      continue;
    }

    const heading = headingPattern.exec(line);

    if (heading !== null) {
      const marker = heading[1];
      const text = heading[2];
      const level = marker === undefined ? undefined : headingLevel(marker.length);

      if (level !== undefined && text !== undefined) {
        blocks.push({ kind: "heading", level, text });
        index += 1;
        continue;
      }
    }

    if (thematicBreakPattern.test(line)) {
      blocks.push({ kind: "rule" });
      index += 1;
      continue;
    }

    const quote = quotePattern.exec(line);

    if (quote !== null) {
      const quoteLines: Array<string> = [];

      while (index < lines.length) {
        const current = quotePattern.exec(lineAt(lines, index));

        if (current === null) {
          break;
        }

        quoteLines.push(current[1] ?? "");
        index += 1;
      }

      blocks.push({ kind: "quote", text: quoteLines.join(" ") });
      continue;
    }

    const list = listPattern.exec(line);

    if (list !== null) {
      const marker = list[2];
      const text = list[3];
      const ordered = marker?.endsWith(".") ?? false;
      const items: Array<MarkdownListItem> = [];

      if (text !== undefined) {
        items.push(parseListItem(text));
      }

      index += 1;

      while (index < lines.length) {
        const current = listPattern.exec(lineAt(lines, index));
        const currentMarker = current?.[2];
        const currentText = current?.[3];

        if (
          current === null ||
          currentMarker === undefined ||
          currentText === undefined ||
          currentMarker.endsWith(".") !== ordered
        ) {
          break;
        }

        items.push(parseListItem(currentText));
        index += 1;
      }

      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    if (isTableStart(lines, index)) {
      const header = tableCells(line);
      const alignment = tableDivider(lineAt(lines, index + 1));

      if (alignment !== undefined) {
        const rows: Array<ReadonlyArray<string>> = [];
        index += 2;

        while (index < lines.length) {
          const row = lineAt(lines, index);

          if (row.trim() === "" || !row.includes("|")) {
            break;
          }

          rows.push(normalizedTableRow(tableCells(row), header.length));
          index += 1;
        }

        blocks.push({
          kind: "table",
          header,
          alignment,
          rows,
        });
        continue;
      }
    }

    const paragraph: Array<string> = [line];
    index += 1;

    while (
      index < lines.length &&
      lineAt(lines, index).trim() !== "" &&
      !isBlockStart(lines, index)
    ) {
      paragraph.push(lineAt(lines, index));
      index += 1;
    }

    blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
  }

  return blocks;
}

function urlDecision(
  value: string,
  destinationKind: MarkdownDestinationKind,
): UrlDecision {
  const trimmed = value.trim();

  if (trimmed === "" || trimmed.startsWith("//")) {
    return { kind: "rejected" };
  }

  try {
    const resolved = new URL(trimmed, markdownUrlBase);

    if (resolved.username !== "" || resolved.password !== "") {
      return { kind: "rejected" };
    }

    try {
      const absolute = new URL(trimmed);

      if (absolute.protocol === "http:" || absolute.protocol === "https:") {
        return { kind: "safe", value: trimmed, external: true };
      }

      if (destinationKind === "link" && absolute.protocol === "mailto:") {
        return { kind: "safe", value: trimmed, external: false };
      }

      return { kind: "rejected" };
    } catch {
      return resolved.origin === markdownUrlBase.origin
        ? { kind: "safe", value: trimmed, external: false }
        : { kind: "rejected" };
    }
  } catch {
    return { kind: "rejected" };
  }
}

function linkSyntax(text: string, index: number, image: boolean): LinkSyntax | undefined {
  const labelStart = index + (image ? 2 : 1);
  const labelEnd = text.indexOf("]", labelStart);

  if (labelEnd < 0 || text[labelEnd + 1] !== "(") {
    return undefined;
  }

  const destinationEnd = text.indexOf(")", labelEnd + 2);

  if (destinationEnd < 0) {
    return undefined;
  }

  const label = text.slice(labelStart, labelEnd);
  const destination = text.slice(labelEnd + 2, destinationEnd).trim();

  return destination === ""
    ? undefined
    : { label, destination, next: destinationEnd + 1 };
}

function inlineNodes(text: string, keyPrefix: string): ReadonlyArray<ReactNode> {
  const nodes: Array<ReactNode> = [];
  let index = 0;
  let elementIndex = 0;

  const nextKey = (): string => {
    const key = `${keyPrefix}-${elementIndex}`;
    elementIndex += 1;
    return key;
  };

  while (index < text.length) {
    const remaining = text.slice(index);
    const image = remaining.startsWith("![")
      ? linkSyntax(text, index, true)
      : undefined;

    if (image !== undefined) {
      const destination = urlDecision(image.destination, "image");

      if (destination.kind === "safe") {
        nodes.push(
          createElement("img", {
            key: nextKey(),
            src: destination.value,
            alt: image.label,
            loading: "lazy",
            referrerPolicy: "no-referrer",
            className: "my-3 max-h-96 max-w-full rounded border border-surface-border",
          }),
        );
      } else {
        nodes.push(
          createElement(
            "span",
            { key: nextKey(), className: "text-diagnostic-error" },
            `[unsafe image blocked: ${image.label}]`,
          ),
        );
      }

      index = image.next;
      continue;
    }

    const link = remaining.startsWith("[")
      ? linkSyntax(text, index, false)
      : undefined;

    if (link !== undefined) {
      const destination = urlDecision(link.destination, "link");

      if (destination.kind === "safe") {
        const properties = destination.external
          ? {
              key: nextKey(),
              href: destination.value,
              target: "_blank",
              rel: "noopener noreferrer",
              referrerPolicy: "no-referrer",
              className: "text-markup-link underline decoration-markup-link-label underline-offset-2",
            }
          : {
              key: nextKey(),
              href: destination.value,
              className: "text-markup-link underline decoration-markup-link-label underline-offset-2",
            };

        nodes.push(
          createElement(
            "a",
            properties,
            ...inlineNodes(link.label, `${keyPrefix}-link`),
          ),
        );
      } else {
        nodes.push(
          createElement(
            "span",
            { key: nextKey(), className: "text-diagnostic-error" },
            ...inlineNodes(link.label, `${keyPrefix}-blocked-link`),
            " [unsafe link blocked]",
          ),
        );
      }

      index = link.next;
      continue;
    }

    const autolink = autolinkPattern.exec(remaining);

    if (autolink !== null) {
      const destination = autolink[1];

      if (destination !== undefined) {
        const decision = urlDecision(destination, "link");

        if (decision.kind === "safe") {
          nodes.push(
            createElement(
              "a",
              {
                key: nextKey(),
                href: decision.value,
                target: decision.external ? "_blank" : undefined,
                rel: decision.external ? "noopener noreferrer" : undefined,
                referrerPolicy: decision.external ? "no-referrer" : undefined,
                className: "text-markup-link underline decoration-markup-link-label underline-offset-2",
              },
              destination,
            ),
          );
        } else {
          nodes.push(destination);
        }

        index += autolink[0].length;
        continue;
      }
    }

    const automaticUrl = urlPattern.exec(remaining);

    if (automaticUrl !== null) {
      const destination = automaticUrl[0];

      if (destination !== undefined) {
        const resolved = destination.startsWith("www.")
          ? `https://${destination}`
          : destination;
        const decision = urlDecision(resolved, "link");

        if (decision.kind === "safe") {
          nodes.push(
            createElement(
              "a",
              {
                key: nextKey(),
                href: decision.value,
                target: "_blank",
                rel: "noopener noreferrer",
                referrerPolicy: "no-referrer",
                className: "text-markup-link underline decoration-markup-link-label underline-offset-2",
              },
              destination,
            ),
          );
        } else {
          nodes.push(destination);
        }

        index += destination.length;
        continue;
      }
    }

    const rawHtml = rawHtmlPattern.exec(remaining);

    if (rawHtml !== null) {
      nodes.push(rawHtml[0]);
      index += rawHtml[0].length;
      continue;
    }

    if (remaining.startsWith("\\") && remaining.length > 1) {
      nodes.push(remaining[1] ?? "");
      index += 2;
      continue;
    }

    const inlineCode = /^`([^`]+)`/u.exec(remaining);

    if (inlineCode !== null && inlineCode[1] !== undefined) {
      nodes.push(
        createElement(
          "code",
          {
            key: nextKey(),
            className: "rounded bg-surface-raised px-1 text-markup-raw",
          },
          inlineCode[1],
        ),
      );
      index += inlineCode[0].length;
      continue;
    }

    const strike = /^~~([^~]+)~~/u.exec(remaining);

    if (strike !== null && strike[1] !== undefined) {
      nodes.push(
        createElement(
          "del",
          { key: nextKey(), className: "text-text-muted" },
          ...inlineNodes(strike[1], `${keyPrefix}-strike`),
        ),
      );
      index += strike[0].length;
      continue;
    }

    const strong = /^(?:\*\*|__)(.+?)(?:\*\*|__)/u.exec(remaining);

    if (strong !== null && strong[1] !== undefined) {
      nodes.push(
        createElement(
          "strong",
          { key: nextKey(), className: "text-text-strong" },
          ...inlineNodes(strong[1], `${keyPrefix}-strong`),
        ),
      );
      index += strong[0].length;
      continue;
    }

    const emphasis = /^(?:\*|_)(.+?)(?:\*|_)/u.exec(remaining);

    if (emphasis !== null && emphasis[1] !== undefined) {
      nodes.push(
        createElement(
          "em",
          { key: nextKey(), className: "text-text-bright" },
          ...inlineNodes(emphasis[1], `${keyPrefix}-emphasis`),
        ),
      );
      index += emphasis[0].length;
      continue;
    }

    const special = "![]*`~<\\hw";
    let end = index + 1;

    while (end < text.length && !special.includes(text[end] ?? "")) {
      end += 1;
    }

    nodes.push(text.slice(index, end));
    index = end;
  }

  return nodes;
}

function blockElement(block: MarkdownBlock, index: number): ReactElement {
  const key = `${block.kind}-${index}`;

  switch (block.kind) {
    case "heading": {
      const headingClass = {
        1: "mt-6 text-3xl font-bold text-markup-heading-1",
        2: "mt-5 text-2xl font-bold text-markup-heading-2",
        3: "mt-4 text-xl font-semibold text-markup-heading-3",
        4: "mt-4 text-lg font-semibold text-markup-heading-4",
        5: "mt-3 font-semibold text-markup-heading-5",
        6: "mt-3 text-sm font-semibold text-markup-heading-6",
      } as const satisfies Readonly<Record<HeadingLevel, string>>;
      const tag = `h${block.level}`;

      return createElement(
        tag,
        { className: headingClass[block.level] },
        ...inlineNodes(block.text, key),
      );
    }
    case "paragraph":
      return createElement(
        "p",
        { className: "mt-3 whitespace-pre-wrap wrap-break-words text-text-primary" },
        ...inlineNodes(block.text, key),
      );
    case "quote":
      return createElement(
        "blockquote",
        { className: "mt-3 border-l-2 border-markup-quote pl-3 text-markup-quote" },
        ...inlineNodes(block.text, key),
      );
    case "list": {
      const tag = block.ordered ? "ol" : "ul";
      const listClass = block.ordered
        ? "mt-3 list-decimal space-y-1 pl-6 marker:text-markup-list"
        : "mt-3 list-disc space-y-1 pl-6 marker:text-markup-list";

      return createElement(
        tag,
        { className: listClass },
        ...block.items.map((item, itemIndex) =>
          createElement(
            "li",
            { key: `${key}-item-${itemIndex}`, className: "pl-1" },
            item.task === undefined
              ? inlineNodes(item.text, `${key}-item-${itemIndex}`)
              : [
                  createElement("input", {
                    key: `${key}-item-${itemIndex}-task`,
                    type: "checkbox",
                    checked: item.task === "checked",
                    disabled: true,
                    readOnly: true,
                    className: "mr-2 accent-markup-checked",
                    "aria-label": item.task === "checked" ? "Completed task" : "Pending task",
                  }),
                  ...inlineNodes(item.text, `${key}-item-${itemIndex}`),
                ],
          ),
        ),
      );
    }
    case "table":
      return createElement(
        "div",
        { className: "mt-3 overflow-x-auto" },
        createElement(
          "table",
          { className: "w-full border-collapse text-left" },
          createElement(
            "thead",
            { className: "border-b border-surface-border text-text-bright" },
            createElement(
              "tr",
              undefined,
              ...block.header.map((cell, cellIndex) =>
                createElement(
                  "th",
                  {
                    key: `${key}-head-${cellIndex}`,
                    scope: "col",
                    className:
                      block.alignment[cellIndex] === "right"
                        ? "px-2 py-1 text-right"
                        : block.alignment[cellIndex] === "center"
                          ? "px-2 py-1 text-center"
                          : "px-2 py-1 text-left",
                  },
                  ...inlineNodes(cell, `${key}-head-${cellIndex}`),
                ),
              ),
            ),
          ),
          createElement(
            "tbody",
            undefined,
            ...block.rows.map((row, rowIndex) =>
              createElement(
                "tr",
                { key: `${key}-row-${rowIndex}`, className: "border-b border-surface-border" },
                ...row.map((cell, cellIndex) =>
                  createElement(
                    "td",
                    {
                      key: `${key}-row-${rowIndex}-${cellIndex}`,
                      className:
                        block.alignment[cellIndex] === "right"
                          ? "px-2 py-1 text-right"
                          : block.alignment[cellIndex] === "center"
                            ? "px-2 py-1 text-center"
                            : "px-2 py-1 text-left",
                    },
                    ...inlineNodes(cell, `${key}-row-${rowIndex}-${cellIndex}`),
                  ),
                ),
              ),
            ),
          ),
        ),
      );
    case "code":
      return createElement(MarkdownCodeBlock, { infoString: block.language, source: block.text });
    case "rule":
      return createElement("hr", { className: "mt-4 border-surface-border" });
    case "error":
      return createElement(
        "p",
        { role: "alert", className: "mt-3 text-diagnostic-error" },
        block.message,
      );
  }
}

function searchableText(block: MarkdownBlock): string {
  switch (block.kind) {
    case "heading":
    case "paragraph":
    case "quote":
    case "code":
      return block.text;
    case "list":
      return block.items.map((item) => item.text).join(" ");
    case "table":
      return [
        ...block.header,
        ...block.rows.flatMap((row) => row),
      ].join(" ");
    case "error":
      return block.message;
    case "rule":
      return "";
  }
}

function matchingOffsets(text: string, query: string): ReadonlyArray<number> {
  const normalizedText = text.toLowerCase();
  const offsets: Array<number> = [];
  let offset = 0;

  while (offset <= normalizedText.length - query.length) {
    const match = normalizedText.indexOf(query, offset);

    if (match < 0) {
      break;
    }

    offsets.push(match);
    offset = match + query.length;
  }

  return offsets;
}

export function markdownSearchMatches(
  document: MarkdownDocument,
  query: string,
): ReadonlyArray<number> {
  const normalizedQuery = query.trim().toLowerCase();

  if (normalizedQuery === "") {
    return [];
  }

  const matches: Array<number> = [];

  for (const [index, block] of parseBlocks(document.text).entries()) {
    for (const _ of matchingOffsets(searchableText(block), normalizedQuery)) {
      matches.push(index);
    }
  }

  return matches;
}

export function markdownBlockCount(document: MarkdownDocument): number {
  return parseBlocks(document.text).length;
}

export type MarkdownRendererProps = Readonly<{
  document: MarkdownDocument;
  activeBlockIndex: number | undefined;
}>;

export function MarkdownRenderer({
  document,
  activeBlockIndex,
}: MarkdownRendererProps): ReactElement {
  if (document.preview.kind === "github-html") {
    return createElement(
      "article",
      {
        className: "min-w-0 pb-4 text-text-bright",
        "aria-label": `GitHub-rendered Markdown from ${document.source.path}`,
      },
      createElement("div", {
        className: "github-markdown",
        "data-github-markdown": "",
        dangerouslySetInnerHTML: { __html: document.preview.html },
      }),
    );
  }

  return createElement(
    "article",
    {
      className: "min-w-0 pb-4",
      "aria-label": `Rendered Markdown from ${document.source.path}`,
    },
    ...parseBlocks(document.text).map((block, index) =>
      createElement(
        "div",
        {
          key: `${block.kind}-${index}`,
          className:
            activeBlockIndex === index ? "rounded ring-1 ring-ui-search" : undefined,
          "data-markdown-block-index": index,
          "data-markdown-current":
            activeBlockIndex === index ? "true" : undefined,
          "aria-current": activeBlockIndex === index ? "true" : undefined,
        },
        blockElement(block, index),
      ),
    ),
  );
}
