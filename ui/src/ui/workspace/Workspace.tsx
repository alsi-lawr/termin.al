import { useEffect, type ReactElement } from "react";
import type { ApplicationMode } from "../../ApplicationComposition.ts";
import type { ContentCorpus } from "../../api/ContentClient.ts";
import type { StatsClient } from "../../api/StatsClient.ts";
import { paneLeaves } from "../../domain/workspace/PaneTree.ts";
import { useTheme } from "../../theme/useTheme.ts";
import { DirtyCloseConfirmation } from "./DirtyCloseConfirmation";
import { MobilePaneSwitcher } from "./MobilePaneSwitcher";
import { PaneTreeView } from "./PaneTreeView";
import { usePaneWorkspace } from "./usePaneWorkspace";
import { WorkspaceStatusLine } from "./WorkspaceStatusLine";
import { useWorkspaceStats } from "./useWorkspaceStats.ts";
import type { AuthenticationBinding } from "../../auth/useAuthentication.ts";
import type { PublicationClient } from "../../api/PublicationClient.ts";
import {
  authenticationCapabilityLabel,
  authenticationPromptIdentity,
} from "../../auth/Authentication.ts";

type WorkspaceProps = Readonly<{
  applicationMode: ApplicationMode;
  corpus: ContentCorpus;
  statsClient: StatsClient;
  authentication: AuthenticationBinding;
  publicationClient: PublicationClient | undefined;
}>;

export function Workspace({
  applicationMode,
  corpus,
  statsClient,
  authentication,
  publicationClient,
}: WorkspaceProps): ReactElement {
  const stats = useWorkspaceStats(statsClient, applicationMode);
  const controller = usePaneWorkspace(
    corpus,
    stats.recordAcceptedOpen,
    applicationMode,
    authentication.controller,
    publicationClient,
  );
  const dropCvContent = controller.dropCvContent;
  const theme = useTheme();
  const panes = paneLeaves(controller.workspace.tree);
  const closeConfirmationOpen =
    controller.closeConfirmation.kind === "requested";

  useEffect(() => {
    if (authentication.state.sensitiveRevision > 0) {
      dropCvContent();
    }
  }, [
    authentication.state.sensitiveRevision,
    dropCvContent,
  ]);

  return (
    <main
      className="flex h-dvh min-w-0 flex-col overflow-hidden bg-surface-deepest"
      data-theme={theme.status.theme}
    >
      <WorkspaceStatusLine
        applicationMode={applicationMode}
        capability={authenticationCapabilityLabel(authentication.state)}
        stats={stats.status}
      />
      <div className="flex min-h-0 flex-1 flex-col" inert={closeConfirmationOpen}>
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <PaneTreeView
            tree={controller.workspace.tree}
            activePaneId={controller.workspace.activePaneId}
            zoom={controller.workspace.zoom}
            shellRuntimes={controller.shellRuntimes}
            focusVersion={controller.focusVersion}
            onOperation={controller.applyOperation}
            onShellAction={controller.onShellAction}
            onCloseShellPresentation={controller.onCloseShellPresentation}
            hasShellRuntime={controller.hasShellRuntime}
            onPaneKeyInput={controller.onPaneKeyInput}
            mobileCtrlPressed={controller.mobileCtrlPressed}
            vimSession={controller.vimSession}
            onToggleMobileCtrl={controller.onToggleMobileCtrl}
            onConsumeMobileCtrl={controller.onConsumeMobileCtrl}
            resolveMobileCtrlInput={controller.resolveMobileCtrlInput}
            themeController={theme.controller}
            filesystem={controller.filesystem}
            onFilesystemChange={controller.onFilesystemChange}
            documents={corpus.documents}
            projectReadmes={corpus.projectReadmes}
            readStats={stats.readStats}
            authoring={controller.authoring}
            onAcceptedContentOpen={stats.recordAcceptedOpen}
            authentication={authentication.controller}
            promptIdentity={authenticationPromptIdentity(authentication.state)}
            openProtectedViewer={controller.openProtectedViewer}
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
