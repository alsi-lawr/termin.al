import type { ReactElement } from "react";

export type MobilePaneControl =
  | "escape"
  | "tab"
  | "left"
  | "right"
  | "up"
  | "down";

type MobilePaneControlsProps = Readonly<{
  ctrlPressed: boolean;
  onCtrlToggle: () => void;
  onCtrlConsumed: () => void;
  onControl: (control: MobilePaneControl, ctrlKey: boolean) => void;
  onPrefix: () => void;
}>;

export function MobilePaneControls({
  ctrlPressed,
  onCtrlToggle,
  onCtrlConsumed,
  onControl,
  onPrefix,
}: MobilePaneControlsProps): ReactElement {
  const sendControl = (control: MobilePaneControl): void => {
    onControl(control, ctrlPressed);
    onCtrlConsumed();
  };

  const sendPrefix = (): void => {
    onPrefix();
    onCtrlConsumed();
  };

  return (
    <div
      className="flex shrink-0 flex-wrap gap-1 border-t border-surface-border bg-surface-deepest p-2 md:hidden"
      role="toolbar"
      aria-label="Mobile terminal controls"
    >
      <button
        type="button"
        className="rounded border border-surface-border px-2 py-1 text-text-primary"
        onClick={() => sendControl("escape")}
      >
        Esc
      </button>
      <button
        type="button"
        className="rounded border border-surface-border px-2 py-1 text-text-primary aria-pressed:bg-surface-selected"
        aria-pressed={ctrlPressed}
        onClick={onCtrlToggle}
      >
        Ctrl
      </button>
      <button
        type="button"
        className="rounded border border-surface-border px-2 py-1 text-text-primary"
        onClick={() => sendControl("tab")}
      >
        Tab
      </button>
      <button
        type="button"
        className="rounded border border-surface-border px-2 py-1 text-text-primary"
        aria-label="Move left"
        onClick={() => sendControl("left")}
      >
        ←
      </button>
      <button
        type="button"
        className="rounded border border-surface-border px-2 py-1 text-text-primary"
        aria-label="Move down"
        onClick={() => sendControl("down")}
      >
        ↓
      </button>
      <button
        type="button"
        className="rounded border border-surface-border px-2 py-1 text-text-primary"
        aria-label="Move up"
        onClick={() => sendControl("up")}
      >
        ↑
      </button>
      <button
        type="button"
        className="rounded border border-surface-border px-2 py-1 text-text-primary"
        aria-label="Move right"
        onClick={() => sendControl("right")}
      >
        →
      </button>
      <button
        type="button"
        className="rounded border border-ui-accent px-2 py-1 text-ui-accent"
        onClick={sendPrefix}
      >
        Prefix
      </button>
    </div>
  );
}
