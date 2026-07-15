import { useState, type ReactElement } from "react";

export type MobilePaneControl =
  | "escape"
  | "tab"
  | "left"
  | "right"
  | "up"
  | "down";

type MobilePaneControlsProps = Readonly<{
  onControl: (control: MobilePaneControl, ctrlKey: boolean) => void;
  onPrefix: () => void;
}>;

export function MobilePaneControls({
  onControl,
  onPrefix,
}: MobilePaneControlsProps): ReactElement {
  const [ctrlKey, setCtrlKey] = useState(false);

  const sendControl = (control: MobilePaneControl): void => {
    onControl(control, ctrlKey);
    setCtrlKey(false);
  };

  const sendPrefix = (): void => {
    onPrefix();
    setCtrlKey(false);
  };

  return (
    <div
      className="flex flex-wrap gap-1 border-t border-neutral-800 bg-neutral-950 p-2 md:hidden"
      role="toolbar"
      aria-label="Mobile terminal controls"
    >
      <button
        type="button"
        className="rounded border border-neutral-700 px-2 py-1 text-neutral-100"
        onClick={() => sendControl("escape")}
      >
        Esc
      </button>
      <button
        type="button"
        className="rounded border border-neutral-700 px-2 py-1 text-neutral-100 aria-pressed:bg-neutral-700"
        aria-pressed={ctrlKey}
        onClick={() => setCtrlKey((current) => !current)}
      >
        Ctrl
      </button>
      <button
        type="button"
        className="rounded border border-neutral-700 px-2 py-1 text-neutral-100"
        onClick={() => sendControl("tab")}
      >
        Tab
      </button>
      <button
        type="button"
        className="rounded border border-neutral-700 px-2 py-1 text-neutral-100"
        aria-label="Move left"
        onClick={() => sendControl("left")}
      >
        ←
      </button>
      <button
        type="button"
        className="rounded border border-neutral-700 px-2 py-1 text-neutral-100"
        aria-label="Move down"
        onClick={() => sendControl("down")}
      >
        ↓
      </button>
      <button
        type="button"
        className="rounded border border-neutral-700 px-2 py-1 text-neutral-100"
        aria-label="Move up"
        onClick={() => sendControl("up")}
      >
        ↑
      </button>
      <button
        type="button"
        className="rounded border border-neutral-700 px-2 py-1 text-neutral-100"
        aria-label="Move right"
        onClick={() => sendControl("right")}
      >
        →
      </button>
      <button
        type="button"
        className="rounded border border-green-500 px-2 py-1 text-green-300"
        onClick={sendPrefix}
      >
        Prefix
      </button>
    </div>
  );
}
