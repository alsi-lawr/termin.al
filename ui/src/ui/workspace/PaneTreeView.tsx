import type { ReactElement } from "react";
import type { ShellAction } from "../../domain/terminal/Shell.ts";
import type { PaneCommandHandler } from "../../application/commands/PaneCommand.ts";
import type { ThemeController } from "../../theme/Theme.ts";
import type {
  PaneId,
  PaneOperation,
  PaneOperationResult,
  PaneSplitRatio,
  PaneTree,
  PaneZoom,
} from "../../domain/workspace/PaneTree.ts";
import {
  paneShellRuntime,
  type PaneShellRuntimes,
} from "./PaneShellRuntimes.ts";
import type {
  InputCapturePaneKeyInput,
  InputCapturePaneKeyResult,
} from "../terminal/InputCapture";
import type { MobileCtrlInputResolution } from "./MobileCtrlModifier.ts";
import { Terminal } from "../terminal/Terminal";
import { ViewerPane } from "./ViewerPane";
import { VimEditorPane } from "./VimEditorPane";

type PaneTreeViewProps = Readonly<{
  tree: PaneTree;
  activePaneId: PaneId;
  zoom: PaneZoom;
  shellRuntimes: PaneShellRuntimes;
  focusVersion: number;
  onOperation: (operation: PaneOperation) => PaneOperationResult;
  onShellAction: (paneId: PaneId, action: ShellAction) => void;
  onCloseInlineViewer: (paneId: PaneId) => void;
  hasShellRuntime: (paneId: PaneId) => boolean;
  onPaneKeyInput: (
    input: InputCapturePaneKeyInput,
  ) => InputCapturePaneKeyResult;
  mobileCtrlPressed: boolean;
  onToggleMobileCtrl: () => void;
  onConsumeMobileCtrl: () => void;
  resolveMobileCtrlInput: (
    input: InputCapturePaneKeyInput,
  ) => MobileCtrlInputResolution;
  themeController: ThemeController;
}>;

const firstPaneBasisClass = {
  10: "md:basis-2/20",
  15: "md:basis-3/20",
  20: "md:basis-4/20",
  25: "md:basis-5/20",
  30: "md:basis-6/20",
  35: "md:basis-7/20",
  40: "md:basis-8/20",
  45: "md:basis-9/20",
  50: "md:basis-10/20",
  55: "md:basis-11/20",
  60: "md:basis-12/20",
  65: "md:basis-13/20",
  70: "md:basis-14/20",
  75: "md:basis-15/20",
  80: "md:basis-16/20",
  85: "md:basis-17/20",
  90: "md:basis-18/20",
} as const satisfies Readonly<Record<PaneSplitRatio, string>>;

function treeContainsPane(tree: PaneTree, paneId: PaneId): boolean {
  switch (tree.kind) {
    case "leaf":
      return tree.pane.id === paneId;
    case "split":
      return (
        treeContainsPane(tree.first, paneId) ||
        treeContainsPane(tree.second, paneId)
      );
  }
}

function branchClass(
  containsActivePane: boolean,
  containsZoomedPane: boolean,
  zoom: PaneZoom,
  desktopSize: string,
): string {
  if (zoom.kind === "active") {
    return containsZoomedPane
      ? "flex min-h-0 min-w-0 flex-1"
      : "hidden";
  }

  return containsActivePane
    ? "flex min-h-0 min-w-0 flex-1 " + desktopSize
    : "hidden min-h-0 min-w-0 md:flex " + desktopSize;
}

function PaneLeaf({
  tree,
  activePaneId,
  shellRuntimes,
  focusVersion,
  onOperation,
  onShellAction,
  onCloseInlineViewer,
  hasShellRuntime,
  onPaneKeyInput,
  mobileCtrlPressed,
  onToggleMobileCtrl,
  onConsumeMobileCtrl,
  resolveMobileCtrlInput,
  themeController,
}: Omit<PaneTreeViewProps, "zoom"> & Readonly<{ tree: Extract<PaneTree, { kind: "leaf" }> }>): ReactElement {
  const { pane } = tree;
  const isActive = pane.id === activePaneId;
  const activate = (): void => {
    onOperation({ kind: "focus-pane", paneId: pane.id });
  };
  const commandHandler: PaneCommandHandler = onOperation;
  const paneClass = isActive
    ? "h-full min-h-0 min-w-0 flex-1 rounded-md ring-1 ring-ui-focus"
    : "h-full min-h-0 min-w-0 flex-1 rounded-md";

  switch (pane.content.kind) {
    case "shell": {
      const runtime = paneShellRuntime(shellRuntimes, pane.id);

      return (
        <div className={paneClass}>
          <Terminal
            key={pane.id}
            paneId={pane.id}
            state={runtime.state}
            presentation={runtime.presentation}
            runtimeControl={runtime.control}
            onShellAction={onShellAction}
            onCloseInlineViewer={onCloseInlineViewer}
            hasShellRuntime={hasShellRuntime}
            isActive={isActive}
            focusVersion={focusVersion}
            onActivate={activate}
            onPaneKeyInput={onPaneKeyInput}
            mobileCtrlPressed={mobileCtrlPressed}
            onToggleMobileCtrl={onToggleMobileCtrl}
            onConsumeMobileCtrl={onConsumeMobileCtrl}
            resolveMobileCtrlInput={resolveMobileCtrlInput}
            paneCommandHandler={commandHandler}
            themeController={themeController}
          />
        </div>
      );
    }
    case "viewer":
      return (
        <div className={paneClass}>
          <ViewerPane
            viewer={pane.content.viewer}
            isActive={isActive}
            focusVersion={focusVersion}
            onActivate={activate}
            onPaneKeyInput={onPaneKeyInput}
            mobileCtrlPressed={mobileCtrlPressed}
            onToggleMobileCtrl={onToggleMobileCtrl}
            onConsumeMobileCtrl={onConsumeMobileCtrl}
            resolveMobileCtrlInput={resolveMobileCtrlInput}
            onClose={() => {
              onOperation({ kind: "close" });
            }}
          />
        </div>
      );
    case "editor":
      return (
        <div className={paneClass}>
          <VimEditorPane
            title={pane.content.title}
            buffer={pane.content.buffer}
            isActive={isActive}
            focusVersion={focusVersion}
            onActivate={activate}
            onBufferChange={(buffer) => {
              onOperation({
                kind: "replace-editor-buffer",
                paneId: pane.id,
                buffer,
              });
            }}
            onPaneKeyInput={onPaneKeyInput}
            mobileCtrlPressed={mobileCtrlPressed}
            onToggleMobileCtrl={onToggleMobileCtrl}
            onConsumeMobileCtrl={onConsumeMobileCtrl}
            resolveMobileCtrlInput={resolveMobileCtrlInput}
          />
        </div>
      );
  }
}

export function PaneTreeView({
  tree,
  activePaneId,
  zoom,
  shellRuntimes,
  focusVersion,
  onOperation,
  onShellAction,
  onCloseInlineViewer,
  hasShellRuntime,
  onPaneKeyInput,
  mobileCtrlPressed,
  onToggleMobileCtrl,
  onConsumeMobileCtrl,
  resolveMobileCtrlInput,
  themeController,
}: PaneTreeViewProps): ReactElement {
  if (tree.kind === "leaf") {
    return (
      <PaneLeaf
        tree={tree}
        activePaneId={activePaneId}
        shellRuntimes={shellRuntimes}
        focusVersion={focusVersion}
        onOperation={onOperation}
        onShellAction={onShellAction}
        onCloseInlineViewer={onCloseInlineViewer}
        hasShellRuntime={hasShellRuntime}
        onPaneKeyInput={onPaneKeyInput}
        mobileCtrlPressed={mobileCtrlPressed}
        onToggleMobileCtrl={onToggleMobileCtrl}
        onConsumeMobileCtrl={onConsumeMobileCtrl}
        resolveMobileCtrlInput={resolveMobileCtrlInput}
        themeController={themeController}
      />
    );
  }

  const firstContainsActivePane = treeContainsPane(tree.first, activePaneId);
  const secondContainsActivePane = treeContainsPane(tree.second, activePaneId);
  const zoomedPaneId = zoom.kind === "active" ? zoom.paneId : activePaneId;
  const firstContainsZoomedPane = treeContainsPane(tree.first, zoomedPaneId);
  const secondContainsZoomedPane = treeContainsPane(tree.second, zoomedPaneId);
  const directionClass =
    tree.orientation === "horizontal" ? "flex-col md:flex-row" : "flex-col";
  const dividerClass =
    tree.orientation === "horizontal"
      ? "md:border-r md:border-surface-border"
      : "md:border-b md:border-surface-border";

  return (
    <div className={"flex min-h-0 min-w-0 flex-1 " + directionClass}>
      <div
        className={
          branchClass(
            firstContainsActivePane,
            firstContainsZoomedPane,
            zoom,
            "md:flex-none " + firstPaneBasisClass[tree.ratio],
          ) +
          " " +
          dividerClass
        }
      >
        <PaneTreeView
          tree={tree.first}
          activePaneId={activePaneId}
          zoom={zoom}
          shellRuntimes={shellRuntimes}
          focusVersion={focusVersion}
          onOperation={onOperation}
          onShellAction={onShellAction}
          onCloseInlineViewer={onCloseInlineViewer}
          hasShellRuntime={hasShellRuntime}
          onPaneKeyInput={onPaneKeyInput}
          mobileCtrlPressed={mobileCtrlPressed}
          onToggleMobileCtrl={onToggleMobileCtrl}
          onConsumeMobileCtrl={onConsumeMobileCtrl}
          resolveMobileCtrlInput={resolveMobileCtrlInput}
          themeController={themeController}
        />
      </div>
      <div
        className={branchClass(
          secondContainsActivePane,
          secondContainsZoomedPane,
          zoom,
          "md:flex-1",
        )}
      >
        <PaneTreeView
          tree={tree.second}
          activePaneId={activePaneId}
          zoom={zoom}
          shellRuntimes={shellRuntimes}
          focusVersion={focusVersion}
          onOperation={onOperation}
          onShellAction={onShellAction}
          onCloseInlineViewer={onCloseInlineViewer}
          hasShellRuntime={hasShellRuntime}
          onPaneKeyInput={onPaneKeyInput}
          mobileCtrlPressed={mobileCtrlPressed}
          onToggleMobileCtrl={onToggleMobileCtrl}
          onConsumeMobileCtrl={onConsumeMobileCtrl}
          resolveMobileCtrlInput={resolveMobileCtrlInput}
          themeController={themeController}
        />
      </div>
    </div>
  );
}
