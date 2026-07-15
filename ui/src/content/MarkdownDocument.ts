export type MarkdownDocumentSource = Readonly<{
  path: string;
}>;

export type MarkdownDocument = Readonly<{
  text: string;
  source: MarkdownDocumentSource;
}>;
