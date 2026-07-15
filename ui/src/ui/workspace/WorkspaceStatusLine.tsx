import type { ReactElement } from "react";
import type { ApplicationMode } from "../../ApplicationComposition.ts";

type WorkspaceStatusLineProps = Readonly<{
  applicationMode: ApplicationMode;
}>;

type WorkspaceModePresentation = Readonly<{
  badge: "DEMO" | "LIVE";
  connectivity: "OFFLINE" | "ONLINE";
}>;

function workspaceModePresentation(
  applicationMode: ApplicationMode,
): WorkspaceModePresentation {
  switch (applicationMode) {
    case "demo":
      return { badge: "DEMO", connectivity: "OFFLINE" };
    case "live":
      return { badge: "LIVE", connectivity: "ONLINE" };
  }
}

export function WorkspaceStatusLine({
  applicationMode,
}: WorkspaceStatusLineProps): ReactElement {
  const presentation = workspaceModePresentation(applicationMode);

  return (
    <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-surface-border bg-surface-raised px-4 py-2 font-mono text-xs text-text-muted">
      <span
        className="rounded-sm border border-ui-accent px-1 text-text-bright"
        aria-label={`${presentation.badge.toLowerCase()} mode`}
      >
        {presentation.badge}
      </span>
      <span aria-label="Connectivity status">{presentation.connectivity}</span>
      <span className="ml-auto" aria-label="Statistics status">
        STATS —
      </span>
      <span aria-label="Capability status">CAPABILITIES —</span>
    </div>
  );
}
