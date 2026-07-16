import type {
  FormEvent,
  KeyboardEvent,
  ReactElement,
  RefObject,
} from "react";
import { markdownViewerSearchInputOperationFromKey } from "./MarkdownViewerSearch.ts";

type MarkdownViewerSearchFormProps = Readonly<{
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  onQueryChange: (query: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}>;

export function MarkdownViewerSearchForm({
  inputRef,
  query,
  onQueryChange,
  onSubmit,
  onCancel,
}: MarkdownViewerSearchFormProps): ReactElement {
  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onSubmit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    event.stopPropagation();
    const result = markdownViewerSearchInputOperationFromKey(event.key);

    if (result.kind === "unhandled") {
      return;
    }

    event.preventDefault();
    onCancel();
  };

  return (
    <form className="mt-3 flex items-center gap-2" onSubmit={handleSubmit}>
      <label className="text-text-muted" htmlFor="markdown-search">
        /
      </label>
      <input
        ref={inputRef}
        id="markdown-search"
        type="search"
        value={query}
        className="min-w-0 flex-1 rounded border border-surface-border bg-surface-deepest px-2 py-1 text-text-primary outline-none focus:border-ui-focus"
        aria-label="Search Markdown"
        onChange={(event) => {
          onQueryChange(event.target.value);
        }}
        onKeyDown={handleKeyDown}
      />
      <button
        type="submit"
        className="rounded border border-surface-border px-2 py-1 text-text-bright hover:border-ui-accent hover:text-ui-accent md:hidden"
      >
        Find
      </button>
    </form>
  );
}
