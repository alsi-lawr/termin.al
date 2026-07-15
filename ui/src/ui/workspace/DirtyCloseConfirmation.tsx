import {
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import { viewerTitle } from "../../content/ViewerContent.ts";
import type { Pane } from "../../domain/workspace/PaneTree.ts";
import { handleDirtyCloseConfirmationKey } from "./DirtyCloseConfirmationKeyHandler.ts";

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
      return viewerTitle(pane.content.viewer);
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
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useLayoutEffect(() => {
    cancelRef.current?.focus();
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const result = handleDirtyCloseConfirmationKey({
      key: event.key,
      focusedAction:
        event.target === confirmRef.current ? "confirm" : "cancel",
    });

    switch (result.kind) {
      case "cancel":
        event.preventDefault();
        onCancel();
        return;
      case "focus-cancel":
        event.preventDefault();
        cancelRef.current?.focus();
        return;
      case "focus-confirm":
        event.preventDefault();
        confirmRef.current?.focus();
        return;
      case "unhandled":
        return;
    }
  };

  return (
    <div
      className="fixed inset-0 z-10 grid place-items-center bg-neutral-950/80 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="dirty-pane-close-title"
      aria-describedby="dirty-pane-close-description"
      onKeyDown={handleKeyDown}
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
            ref={confirmRef}
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
