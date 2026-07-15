import {
  createEmptyVimBuffer,
  isVimBufferDirty,
  type VimBuffer,
} from "../vim/VimBuffer.ts";
import {
  createPlaceholderViewerContent,
  type ViewerContent,
} from "../../content/ViewerContent.ts";

declare const paneIdBrand: unique symbol;

export type PaneId = string & {
  readonly [paneIdBrand]: "PaneId";
};

export type PaneOrientation = "horizontal" | "vertical";

export type PaneDirection = "left" | "right" | "up" | "down";

export type PaneLayout =
  | "manual"
  | "even-horizontal"
  | "even-vertical"
  | "main-horizontal"
  | "main-vertical"
  | "tiled";

export type PaneContent =
  | Readonly<{ kind: "shell" }>
  | Readonly<{
      kind: "viewer";
      viewer: ViewerContent;
    }>
  | Readonly<{
      kind: "editor";
      title: string;
      buffer: VimBuffer;
    }>;

export type Pane = Readonly<{
  id: PaneId;
  content: PaneContent;
}>;

export type PaneSplitRatio =
  | 10
  | 15
  | 20
  | 25
  | 30
  | 35
  | 40
  | 45
  | 50
  | 55
  | 60
  | 65
  | 70
  | 75
  | 80
  | 85
  | 90;

export type PaneTree =
  | Readonly<{
      kind: "leaf";
      pane: Pane;
    }>
  | Readonly<{
      kind: "split";
      orientation: PaneOrientation;
      ratio: PaneSplitRatio;
      first: PaneTree;
      second: PaneTree;
    }>;

export type PaneZoom =
  | Readonly<{ kind: "none" }>
  | Readonly<{
      kind: "active";
      paneId: PaneId;
    }>;

export type PaneWorkspace = Readonly<{
  tree: PaneTree;
  activePaneId: PaneId;
  zoom: PaneZoom;
  layout: PaneLayout;
  nextPaneSequence: number;
}>;

export type PaneGeometry = Readonly<{
  paneId: PaneId;
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type PaneOperation =
  | Readonly<{
      kind: "split";
      orientation: PaneOrientation;
      content: PaneContent;
    }>
  | Readonly<{
      kind: "focus-direction";
      direction: PaneDirection;
    }>
  | Readonly<{ kind: "focus-next" }>
  | Readonly<{
      kind: "focus-number";
      number: number;
    }>
  | Readonly<{
      kind: "focus-pane";
      paneId: PaneId;
    }>
  | Readonly<{
      kind: "resize";
      direction: PaneDirection;
    }>
  | Readonly<{ kind: "close" }>
  | Readonly<{ kind: "confirm-close" }>
  | Readonly<{
      kind: "swap";
      direction: "previous" | "next";
    }>
  | Readonly<{
      kind: "rotate";
      direction: "previous" | "next";
    }>
  | Readonly<{ kind: "toggle-zoom" }>
  | Readonly<{
      kind: "set-layout";
      layout: Exclude<PaneLayout, "manual">;
    }>
  | Readonly<{ kind: "cycle-layout" }>
  | Readonly<{
      kind: "replace-editor-buffer";
      paneId: PaneId;
      buffer: VimBuffer;
    }>;

export type PaneOperationRejection =
  | "close-last-pane"
  | "minimum-pane-size"
  | "no-pane-in-direction"
  | "pane-number-unavailable"
  | "target-pane-unavailable"
  | "pane-is-not-editor";

export type PaneOperationResult =
  | Readonly<{
      kind: "applied";
      workspace: PaneWorkspace;
    }>
  | Readonly<{
      kind: "rejected";
      reason: PaneOperationRejection;
    }>
  | Readonly<{
      kind: "confirmation-required";
      pane: Pane;
    }>;

export type CreatePaneWorkspaceOptions = Readonly<{
  initialContent: PaneContent;
}>;

type Rectangle = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

type TreeRemovalResult =
  | Readonly<{
      kind: "removed";
      tree: PaneTree | undefined;
    }>
  | Readonly<{
      kind: "unchanged";
      tree: PaneTree;
    }>;

type TreeRebuildResult = Readonly<{
  tree: PaneTree;
  remainingPanes: ReadonlyArray<Pane>;
}>;

type ResizeTreeResult =
  | Readonly<{
      kind: "updated";
      tree: PaneTree;
    }>
  | Readonly<{ kind: "minimum-size" }>
  | Readonly<{ kind: "not-found" }>;

const stableIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;
const paneSplitRatios = [
  10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90,
] as const;
const paneLayouts = [
  "even-horizontal",
  "even-vertical",
  "main-horizontal",
  "main-vertical",
  "tiled",
] as const satisfies ReadonlyArray<Exclude<PaneLayout, "manual">>;

function assertStableIdentifier(value: string): void {
  if (!stableIdentifierPattern.test(value)) {
    throw new Error("Pane IDs must be stable identifier strings.");
  }
}

function assertPaneTitle(title: string): void {
  if (title.length === 0 || title.trim() !== title) {
    throw new Error("Pane titles must be non-empty trimmed strings.");
  }
}

function paneSplitRatio(value: number): PaneSplitRatio | undefined {
  return paneSplitRatios.find((ratio) => ratio === value);
}

function paneTreeContains(tree: PaneTree, paneId: PaneId): boolean {
  switch (tree.kind) {
    case "leaf":
      return tree.pane.id === paneId;
    case "split":
      return (
        paneTreeContains(tree.first, paneId) ||
        paneTreeContains(tree.second, paneId)
      );
  }
}

function replacePane(
  tree: PaneTree,
  paneId: PaneId,
  pane: Pane,
): PaneTree {
  switch (tree.kind) {
    case "leaf":
      return tree.pane.id === paneId ? { kind: "leaf", pane } : tree;
    case "split":
      return {
        ...tree,
        first: replacePane(tree.first, paneId, pane),
        second: replacePane(tree.second, paneId, pane),
      };
  }
}

function splitPane(
  tree: PaneTree,
  paneId: PaneId,
  orientation: PaneOrientation,
  newPane: Pane,
): PaneTree {
  switch (tree.kind) {
    case "leaf":
      return tree.pane.id === paneId
        ? {
            kind: "split",
            orientation,
            ratio: 50,
            first: tree,
            second: { kind: "leaf", pane: newPane },
          }
        : tree;
    case "split":
      if (paneTreeContains(tree.first, paneId)) {
        return {
          ...tree,
          first: splitPane(tree.first, paneId, orientation, newPane),
        };
      }

      return {
        ...tree,
        second: splitPane(tree.second, paneId, orientation, newPane),
      };
  }
}

function removePane(tree: PaneTree, paneId: PaneId): TreeRemovalResult {
  if (tree.kind === "leaf") {
    return tree.pane.id === paneId
      ? { kind: "removed", tree: undefined }
      : { kind: "unchanged", tree };
  }

  const first = removePane(tree.first, paneId);

  if (first.kind === "removed") {
    if (first.tree === undefined) {
      return { kind: "removed", tree: tree.second };
    }

    return {
      kind: "removed",
      tree: { ...tree, first: first.tree },
    };
  }

  const second = removePane(tree.second, paneId);

  if (second.kind === "removed") {
    if (second.tree === undefined) {
      return { kind: "removed", tree: tree.first };
    }

    return {
      kind: "removed",
      tree: { ...tree, second: second.tree },
    };
  }

  return { kind: "unchanged", tree };
}

function collectPaneGeometries(
  tree: PaneTree,
  rectangle: Rectangle,
  geometries: PaneGeometry[],
): void {
  if (tree.kind === "leaf") {
    geometries.push({
      paneId: tree.pane.id,
      ...rectangle,
    });
    return;
  }

  const ratio = tree.ratio / 100;

  if (tree.orientation === "horizontal") {
    collectPaneGeometries(
      tree.first,
      {
        ...rectangle,
        width: rectangle.width * ratio,
      },
      geometries,
    );
    collectPaneGeometries(
      tree.second,
      {
        ...rectangle,
        x: rectangle.x + rectangle.width * ratio,
        width: rectangle.width * (1 - ratio),
      },
      geometries,
    );
    return;
  }

  collectPaneGeometries(
    tree.first,
    {
      ...rectangle,
      height: rectangle.height * ratio,
    },
    geometries,
  );
  collectPaneGeometries(
    tree.second,
    {
      ...rectangle,
      y: rectangle.y + rectangle.height * ratio,
      height: rectangle.height * (1 - ratio),
    },
    geometries,
  );
}

function activePane(workspace: PaneWorkspace): Pane {
  const pane = paneLeaves(workspace.tree).find(
    (candidate) => candidate.id === workspace.activePaneId,
  );

  if (pane === undefined) {
    throw new Error("Pane workspaces must retain an active pane.");
  }

  return pane;
}

function setActivePane(
  workspace: PaneWorkspace,
  paneId: PaneId,
): PaneWorkspace {
  if (workspace.activePaneId === paneId) {
    return workspace;
  }

  return {
    ...workspace,
    activePaneId: paneId,
    zoom: { kind: "none" },
  };
}

function geometryForActivePane(workspace: PaneWorkspace): PaneGeometry {
  const geometry = paneGeometries(workspace).find(
    (candidate) => candidate.paneId === workspace.activePaneId,
  );

  if (geometry === undefined) {
    throw new Error("Pane workspaces must retain active-pane geometry.");
  }

  return geometry;
}

function spansOverlap(
  firstStart: number,
  firstLength: number,
  secondStart: number,
  secondLength: number,
): boolean {
  return (
    Math.min(firstStart + firstLength, secondStart + secondLength) >
    Math.max(firstStart, secondStart)
  );
}

function center(start: number, length: number): number {
  return start + length / 2;
}

function nearestPaneInDirection(
  workspace: PaneWorkspace,
  direction: PaneDirection,
): PaneId | undefined {
  const active = geometryForActivePane(workspace);
  const candidates = paneGeometries(workspace).filter(
    (geometry) => geometry.paneId !== active.paneId,
  );
  const directional = candidates.filter((candidate) => {
    switch (direction) {
      case "left":
        return (
          candidate.x + candidate.width <= active.x &&
          spansOverlap(candidate.y, candidate.height, active.y, active.height)
        );
      case "right":
        return (
          candidate.x >= active.x + active.width &&
          spansOverlap(candidate.y, candidate.height, active.y, active.height)
        );
      case "up":
        return (
          candidate.y + candidate.height <= active.y &&
          spansOverlap(candidate.x, candidate.width, active.x, active.width)
        );
      case "down":
        return (
          candidate.y >= active.y + active.height &&
          spansOverlap(candidate.x, candidate.width, active.x, active.width)
        );
    }
  });

  if (directional.length === 0) {
    return undefined;
  }

  const ranked = [...directional].sort((left, right) => {
    const leftDistance =
      direction === "left" || direction === "right"
        ? Math.abs(center(left.x, left.width) - center(active.x, active.width))
        : Math.abs(center(left.y, left.height) - center(active.y, active.height));
    const rightDistance =
      direction === "left" || direction === "right"
        ? Math.abs(center(right.x, right.width) - center(active.x, active.width))
        : Math.abs(center(right.y, right.height) - center(active.y, active.height));

    return leftDistance - rightDistance;
  });
  const nearest = ranked[0];

  return nearest?.paneId;
}

function resizeTree(
  tree: PaneTree,
  paneId: PaneId,
  orientation: PaneOrientation,
  adjustment: -5 | 5,
): ResizeTreeResult {
  if (tree.kind === "leaf") {
    return { kind: "not-found" };
  }

  const child =
    paneTreeContains(tree.first, paneId) ? "first" : "second";
  const childResult = resizeTree(
    tree[child],
    paneId,
    orientation,
    adjustment,
  );

  if (childResult.kind === "updated") {
    return {
      kind: "updated",
      tree: {
        ...tree,
        [child]: childResult.tree,
      },
    };
  }

  if (childResult.kind === "minimum-size") {
    return childResult;
  }

  if (tree.orientation !== orientation) {
    return { kind: "not-found" };
  }

  const ratio = paneSplitRatio(tree.ratio + adjustment);

  if (ratio === undefined) {
    return { kind: "minimum-size" };
  }

  return {
    kind: "updated",
    tree: { ...tree, ratio },
  };
}

function rebuildTreeWithPanes(
  tree: PaneTree,
  panes: ReadonlyArray<Pane>,
): TreeRebuildResult {
  if (tree.kind === "leaf") {
    const pane = panes[0];

    if (pane === undefined) {
      throw new Error("Pane tree rebuilding requires a replacement pane.");
    }

    return {
      tree: { kind: "leaf", pane },
      remainingPanes: panes.slice(1),
    };
  }

  const first = rebuildTreeWithPanes(tree.first, panes);
  const second = rebuildTreeWithPanes(tree.second, first.remainingPanes);

  return {
    tree: {
      ...tree,
      first: first.tree,
      second: second.tree,
    },
    remainingPanes: second.remainingPanes,
  };
}

function ratioForFirstNode(
  nodeCount: number,
): PaneSplitRatio | undefined {
  return paneSplitRatio(Math.round((100 / nodeCount) / 5) * 5);
}

function buildEvenTree(
  nodes: ReadonlyArray<PaneTree>,
  orientation: PaneOrientation,
): PaneTree | undefined {
  const first = nodes[0];

  if (first === undefined) {
    return undefined;
  }

  if (nodes.length === 1) {
    return first;
  }

  const second = buildEvenTree(nodes.slice(1), orientation);
  const ratio = ratioForFirstNode(nodes.length);

  if (second === undefined || ratio === undefined) {
    return undefined;
  }

  return {
    kind: "split",
    orientation,
    ratio,
    first,
    second,
  };
}

function paneLeavesAsTrees(panes: ReadonlyArray<Pane>): ReadonlyArray<PaneTree> {
  return panes.map((pane) => ({ kind: "leaf", pane }));
}

function buildMainTree(
  panes: ReadonlyArray<Pane>,
  orientation: PaneOrientation,
): PaneTree | undefined {
  const main = panes[0];

  if (main === undefined) {
    return undefined;
  }

  if (panes.length === 1) {
    return { kind: "leaf", pane: main };
  }

  const remainingOrientation =
    orientation === "horizontal" ? "vertical" : "horizontal";
  const remaining = buildEvenTree(
    paneLeavesAsTrees(panes.slice(1)),
    remainingOrientation,
  );

  if (remaining === undefined) {
    return undefined;
  }

  return {
    kind: "split",
    orientation,
    ratio: 60,
    first: { kind: "leaf", pane: main },
    second: remaining,
  };
}

function buildTiledTree(panes: ReadonlyArray<Pane>): PaneTree | undefined {
  const columnCount = Math.ceil(Math.sqrt(panes.length));
  const columns: PaneTree[] = [];

  for (let start = 0; start < panes.length; start += columnCount) {
    const column = buildEvenTree(
      paneLeavesAsTrees(panes.slice(start, start + columnCount)),
      "vertical",
    );

    if (column === undefined) {
      return undefined;
    }

    columns.push(column);
  }

  return buildEvenTree(columns, "horizontal");
}

function treeForLayout(
  panes: ReadonlyArray<Pane>,
  layout: Exclude<PaneLayout, "manual">,
): PaneTree | undefined {
  switch (layout) {
    case "even-horizontal":
      return buildEvenTree(paneLeavesAsTrees(panes), "horizontal");
    case "even-vertical":
      return buildEvenTree(paneLeavesAsTrees(panes), "vertical");
    case "main-horizontal":
      return buildMainTree(panes, "vertical");
    case "main-vertical":
      return buildMainTree(panes, "horizontal");
    case "tiled":
      return buildTiledTree(panes);
  }
}

function nextLayout(layout: PaneLayout): Exclude<PaneLayout, "manual"> {
  const finalLayout = paneLayouts[paneLayouts.length - 1];

  if (finalLayout === undefined) {
    throw new Error("Pane layouts must include a final layout.");
  }

  const current = layout === "manual" ? finalLayout : layout;
  const index = paneLayouts.indexOf(current);
  const next = paneLayouts[(index + 1) % paneLayouts.length];

  if (next === undefined) {
    throw new Error("Pane layouts must include a next layout.");
  }

  return next;
}

function closeActivePane(
  workspace: PaneWorkspace,
  confirmed: boolean,
): PaneOperationResult {
  const panes = paneLeaves(workspace.tree);

  if (panes.length === 1) {
    return { kind: "rejected", reason: "close-last-pane" };
  }

  const active = activePane(workspace);

  if (
    !confirmed &&
    active.content.kind === "editor" &&
    isVimBufferDirty(active.content.buffer)
  ) {
    return { kind: "confirmation-required", pane: active };
  }

  const activeIndex = panes.findIndex((pane) => pane.id === active.id);
  const replacement =
    panes[activeIndex + 1] ?? panes[activeIndex - 1];

  if (replacement === undefined) {
    throw new Error("Closing a non-final pane must leave an active replacement.");
  }

  const removed = removePane(workspace.tree, active.id);

  if (removed.kind !== "removed" || removed.tree === undefined) {
    throw new Error("Closing an active pane must remove it from the pane tree.");
  }

  return {
    kind: "applied",
    workspace: {
      ...workspace,
      tree: removed.tree,
      activePaneId: replacement.id,
      zoom: { kind: "none" },
      layout: "manual",
    },
  };
}

function applyLayout(
  workspace: PaneWorkspace,
  layout: Exclude<PaneLayout, "manual">,
): PaneOperationResult {
  const tree = treeForLayout(paneLeaves(workspace.tree), layout);

  if (tree === undefined) {
    return { kind: "rejected", reason: "minimum-pane-size" };
  }

  return {
    kind: "applied",
    workspace: {
      ...workspace,
      tree,
      zoom: { kind: "none" },
      layout,
    },
  };
}

export function createPaneId(value: string): PaneId {
  assertStableIdentifier(value);
  return value as PaneId;
}

export function createShellPaneContent(): PaneContent {
  return { kind: "shell" };
}

export function createViewerPaneContent(viewer: ViewerContent): PaneContent {
  return { kind: "viewer", viewer };
}

export function createPlaceholderViewerPaneContent(title: string): PaneContent {
  return createViewerPaneContent(createPlaceholderViewerContent(title));
}

export function createEditorPaneContent(title: string): PaneContent {
  assertPaneTitle(title);
  return {
    kind: "editor",
    title,
    buffer: createEmptyVimBuffer(),
  };
}

export function createPaneWorkspace({
  initialContent,
}: CreatePaneWorkspaceOptions): PaneWorkspace {
  const paneId = createPaneId("pane-1");

  return {
    tree: {
      kind: "leaf",
      pane: {
        id: paneId,
        content: initialContent,
      },
    },
    activePaneId: paneId,
    zoom: { kind: "none" },
    layout: "manual",
    nextPaneSequence: 2,
  };
}

export function paneLeaves(tree: PaneTree): ReadonlyArray<Pane> {
  if (tree.kind === "leaf") {
    return [tree.pane];
  }

  return [...paneLeaves(tree.first), ...paneLeaves(tree.second)];
}

export function paneGeometries(
  workspace: PaneWorkspace,
): ReadonlyArray<PaneGeometry> {
  const geometries: PaneGeometry[] = [];
  collectPaneGeometries(
    workspace.tree,
    { x: 0, y: 0, width: 1, height: 1 },
    geometries,
  );

  return geometries;
}

export function applyPaneOperation(
  workspace: PaneWorkspace,
  operation: PaneOperation,
): PaneOperationResult {
  switch (operation.kind) {
    case "split": {
      const pane = {
        id: createPaneId("pane-" + workspace.nextPaneSequence),
        content: operation.content,
      };

      return {
        kind: "applied",
        workspace: {
          ...workspace,
          tree: splitPane(
            workspace.tree,
            workspace.activePaneId,
            operation.orientation,
            pane,
          ),
          activePaneId: pane.id,
          zoom: { kind: "none" },
          layout: "manual",
          nextPaneSequence: workspace.nextPaneSequence + 1,
        },
      };
    }
    case "focus-direction": {
      const paneId = nearestPaneInDirection(workspace, operation.direction);

      if (paneId === undefined) {
        return { kind: "rejected", reason: "no-pane-in-direction" };
      }

      return {
        kind: "applied",
        workspace: setActivePane(workspace, paneId),
      };
    }
    case "focus-next": {
      const panes = paneLeaves(workspace.tree);
      const activeIndex = panes.findIndex(
        (pane) => pane.id === workspace.activePaneId,
      );
      const next = panes[(activeIndex + 1) % panes.length];

      if (next === undefined) {
        throw new Error("Pane workspaces must retain at least one pane.");
      }

      return {
        kind: "applied",
        workspace: setActivePane(workspace, next.id),
      };
    }
    case "focus-number": {
      const pane =
        Number.isSafeInteger(operation.number) && operation.number > 0
          ? paneLeaves(workspace.tree)[operation.number - 1]
          : undefined;

      if (pane === undefined) {
        return { kind: "rejected", reason: "pane-number-unavailable" };
      }

      return {
        kind: "applied",
        workspace: setActivePane(workspace, pane.id),
      };
    }
    case "focus-pane":
      if (!paneTreeContains(workspace.tree, operation.paneId)) {
        return { kind: "rejected", reason: "target-pane-unavailable" };
      }

      return {
        kind: "applied",
        workspace: setActivePane(workspace, operation.paneId),
      };
    case "resize": {
      const orientation =
        operation.direction === "left" || operation.direction === "right"
          ? "horizontal"
          : "vertical";
      const adjustment =
        operation.direction === "left" || operation.direction === "up"
          ? -5
          : 5;
      const resized = resizeTree(
        workspace.tree,
        workspace.activePaneId,
        orientation,
        adjustment,
      );

      if (resized.kind === "not-found") {
        return { kind: "rejected", reason: "no-pane-in-direction" };
      }

      if (resized.kind === "minimum-size") {
        return { kind: "rejected", reason: "minimum-pane-size" };
      }

      return {
        kind: "applied",
        workspace: {
          ...workspace,
          tree: resized.tree,
          layout: "manual",
        },
      };
    }
    case "close":
      return closeActivePane(workspace, false);
    case "confirm-close":
      return closeActivePane(workspace, true);
    case "swap": {
      const panes = paneLeaves(workspace.tree);
      const activeIndex = panes.findIndex(
        (pane) => pane.id === workspace.activePaneId,
      );
      const targetIndex =
        operation.direction === "previous" ? activeIndex - 1 : activeIndex + 1;
      const active = panes[activeIndex];
      const target = panes[targetIndex];

      if (active === undefined || target === undefined) {
        return { kind: "rejected", reason: "target-pane-unavailable" };
      }

      const replacement = panes.map((pane, index) => {
        if (index === activeIndex) {
          return target;
        }

        return index === targetIndex ? active : pane;
      });
      const rebuilt = rebuildTreeWithPanes(workspace.tree, replacement);

      return {
        kind: "applied",
        workspace: {
          ...workspace,
          tree: rebuilt.tree,
          layout: "manual",
        },
      };
    }
    case "rotate": {
      const panes = paneLeaves(workspace.tree);

      if (panes.length < 2) {
        return { kind: "rejected", reason: "target-pane-unavailable" };
      }

      const first = panes[0];
      const last = panes.at(-1);

      if (first === undefined || last === undefined) {
        throw new Error("Pane workspaces must retain their pane order.");
      }

      const replacement =
        operation.direction === "previous"
          ? [last, ...panes.slice(0, -1)]
          : [...panes.slice(1), first];
      const rebuilt = rebuildTreeWithPanes(workspace.tree, replacement);

      return {
        kind: "applied",
        workspace: {
          ...workspace,
          tree: rebuilt.tree,
          layout: "manual",
        },
      };
    }
    case "toggle-zoom":
      return {
        kind: "applied",
        workspace: {
          ...workspace,
          zoom:
            workspace.zoom.kind === "active"
              ? { kind: "none" }
              : { kind: "active", paneId: workspace.activePaneId },
        },
      };
    case "set-layout":
      return applyLayout(workspace, operation.layout);
    case "cycle-layout":
      return applyLayout(workspace, nextLayout(workspace.layout));
    case "replace-editor-buffer": {
      const pane = paneLeaves(workspace.tree).find(
        (candidate) => candidate.id === operation.paneId,
      );

      if (pane === undefined) {
        return { kind: "rejected", reason: "target-pane-unavailable" };
      }

      if (pane.content.kind !== "editor") {
        return { kind: "rejected", reason: "pane-is-not-editor" };
      }

      return {
        kind: "applied",
        workspace: {
          ...workspace,
          tree: replacePane(workspace.tree, pane.id, {
            ...pane,
            content: {
              ...pane.content,
              buffer: operation.buffer,
            },
          }),
        },
      };
    }
  }
}
