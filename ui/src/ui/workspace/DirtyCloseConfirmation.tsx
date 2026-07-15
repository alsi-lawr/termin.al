import { useEffect, useRef, type ReactElement } from "react";
import type { Pane } from "../../domain/workspace/PaneTree.ts";

type DirtyCloseConfirmationProps = Readonly<{
  pane: Pane;
  onConfirm: () => void;
  onCancel: () => void;
}>;

function paneLabel(pane: Pane): string {
  switch (pane.content.kind) {
    case "shell":
      return "shell";
    case "viewer":
      return pane.content.title;
    case "editor":
      return pane.content.title;
  }
}

export function DirtyCloseConfirmation({
  pane,
  onConfirm,
  onCancel,
}: DirtyCloseConfirmationProps): ReactElement {
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-10 grid place-items-center bg-neutral-950/80 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="dirty-pane-close-title"
      aria-describedby="dirty-pane-close-description"
    >
      <section className="w-full max-w-md rounded-md border border-neutral-700 bg-neutral-900 p-4 text-neutral-100">
        <h2 id="dirty-pane-close-title" className="text-lg font-semibold">
          Discard editor changes?
        </h2>
        <p id="dirty-pane-close-description" className="mt-2 text-neutral-300">
          {paneLabel(pane)} has unsaved changes.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            className="rounded border border-neutral-600 px-3 py-2"
            onClick={onCancel}
          >
            Keep editing
          </button>
          <button
            type="button"
            className="rounded border border-red-500 px-3 py-2 text-red-200"
            onClick={onConfirm}
          >
            Close pane
          </button>
        </div>
      </section>
    </div>
  );
}
