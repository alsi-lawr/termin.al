export type MarkdownDocumentSource = Readonly<{
  path: string;
}>;

export type MarkdownPreview =
  | Readonly<{ kind: "markdown" }>
  | Readonly<{ kind: "github-html"; html: string }>;

export type MarkdownDocument = Readonly<{
  text: string;
  source: MarkdownDocumentSource;
  preview: MarkdownPreview;
}>;
