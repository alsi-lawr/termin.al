import type { ReactElement } from "react";
import { viewerTitle } from "../../content/ViewerContent.ts";
import type { Pane, PaneId } from "../../domain/workspace/PaneTree.ts";

type MobilePaneSwitcherProps = Readonly<{
  panes: ReadonlyArray<Pane>;
  activePaneId: PaneId;
  onSelect: (paneId: PaneId) => void;
}>;

function paneLabel(pane: Pane, number: number): string {
  switch (pane.content.kind) {
    case "shell":
      return "Pane " + number + ": shell";
    case "viewer":
      return "Pane " + number + ": " + viewerTitle(pane.content.viewer) + " viewer";
    case "editor":
      return "Pane " + number + ": " + pane.content.title + " editor";
  }
}

export function MobilePaneSwitcher({
  panes,
  activePaneId,
  onSelect,
}: MobilePaneSwitcherProps): ReactElement {
  return (
    <nav
      className="border-t border-surface-border bg-surface-deepest p-2 md:hidden"
      aria-label="Pane switcher"
    >
      <div className="flex gap-2 overflow-x-auto">
        {panes.map((pane, index) => {
          const selected = pane.id === activePaneId;

          return (
            <button
              key={pane.id}
              type="button"
              className={
                selected
                  ? "shrink-0 rounded border border-ui-accent px-3 py-2 text-ui-accent"
                  : "shrink-0 rounded border border-surface-border px-3 py-2 text-text-primary"
              }
              aria-pressed={selected}
              onClick={() => onSelect(pane.id)}
            >
              {paneLabel(pane, index + 1)}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
