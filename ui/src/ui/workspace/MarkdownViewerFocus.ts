type ViewerFocusTarget = Readonly<{
  focus: (options: FocusOptions) => void;
}>;

export function restoreMarkdownViewerFocus(
  viewer: ViewerFocusTarget | null,
): void {
  viewer?.focus({ preventScroll: true });
}
