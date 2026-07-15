import type { ReactElement } from "react";
import type { ContentCorpus } from "../../api/ContentClient.ts";
import { paneLeaves } from "../../domain/workspace/PaneTree.ts";
import { useTheme } from "../../theme/useTheme.ts";
import { DirtyCloseConfirmation } from "./DirtyCloseConfirmation";
import { MobilePaneSwitcher } from "./MobilePaneSwitcher";
import { PaneTreeView } from "./PaneTreeView";
import { usePaneWorkspace } from "./usePaneWorkspace";

type WorkspaceProps = Readonly<{
  corpus: ContentCorpus;
}>;

export function Workspace({ corpus }: WorkspaceProps): ReactElement {
  const controller = usePaneWorkspace(corpus);
  const theme = useTheme();
  const panes = paneLeaves(controller.workspace.tree);
  const closeConfirmationOpen =
    controller.closeConfirmation.kind === "requested";

  return (
    <main
      className="flex min-h-dvh w-full flex-col bg-surface-deepest"
      data-theme={theme.status.theme}
    >
      <div className="flex min-h-0 flex-1 flex-col" inert={closeConfirmationOpen}>
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <PaneTreeView
            tree={controller.workspace.tree}
            activePaneId={controller.workspace.activePaneId}
            zoom={controller.workspace.zoom}
            shellRuntimes={controller.shellRuntimes}
            focusVersion={controller.focusVersion}
            onOperation={controller.applyOperation}
            onShellAction={controller.onShellAction}
            onCloseInlineViewer={controller.onCloseInlineViewer}
            hasShellRuntime={controller.hasShellRuntime}
            onPaneKeyInput={controller.onPaneKeyInput}
            mobileCtrlPressed={controller.mobileCtrlPressed}
            onToggleMobileCtrl={controller.onToggleMobileCtrl}
            onConsumeMobileCtrl={controller.onConsumeMobileCtrl}
            resolveMobileCtrlInput={controller.resolveMobileCtrlInput}
            themeController={theme.controller}
            filesystem={corpus.filesystem}
            documents={corpus.documents}
          />
        </div>
        <MobilePaneSwitcher
          panes={panes}
          activePaneId={controller.workspace.activePaneId}
          onSelect={(paneId) => {
            controller.applyOperation({ kind: "focus-pane", paneId });
          }}
        />
      </div>
      {closeConfirmationOpen ? (
        <DirtyCloseConfirmation
          pane={controller.closeConfirmation.pane}
          onConfirm={controller.confirmClose}
          onCancel={controller.dismissClose}
        />
      ) : null}
    </main>
  );
}
