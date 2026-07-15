import type { ReactElement } from "react";
import { paneLeaves } from "../../domain/workspace/PaneTree.ts";
import { DirtyCloseConfirmation } from "./DirtyCloseConfirmation";
import { MobilePaneSwitcher } from "./MobilePaneSwitcher";
import { PaneTreeView } from "./PaneTreeView";
import { usePaneWorkspace } from "./usePaneWorkspace";

export function Workspace(): ReactElement {
  const controller = usePaneWorkspace();
  const panes = paneLeaves(controller.workspace.tree);

  return (
    <main className="flex min-h-dvh w-full flex-col bg-neutral-950">
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <PaneTreeView
          tree={controller.workspace.tree}
          activePaneId={controller.workspace.activePaneId}
          zoom={controller.workspace.zoom}
          shellStates={controller.shellStates}
          focusVersion={controller.focusVersion}
          onOperation={controller.applyOperation}
          onShellAction={controller.onShellAction}
          hasShellState={controller.hasShellState}
          onPaneKeyInput={controller.onPaneKeyInput}
        />
      </div>
      <MobilePaneSwitcher
        panes={panes}
        activePaneId={controller.workspace.activePaneId}
        onSelect={(paneId) => {
          controller.applyOperation({ kind: "focus-pane", paneId });
        }}
      />
      {controller.closeConfirmation.kind === "requested" ? (
        <DirtyCloseConfirmation
          pane={controller.closeConfirmation.pane}
          onConfirm={controller.confirmClose}
          onCancel={controller.dismissClose}
        />
      ) : null}
    </main>
  );
}
