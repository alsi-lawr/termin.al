import {
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import { viewerTitle } from "../../content/ViewerContent.ts";
import type { Pane } from "../../domain/workspace/PaneTree.ts";
import {
  dirtyCloseActionsVisibility,
  handleDirtyCloseConfirmationKey,
  type DirtyCloseConfirmationKeyInput,
} from "./DirtyCloseConfirmationKeyHandler.ts";

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
    case "authoring-preview":
      return viewerTitle(pane.content.viewer);
    case "editor":
    case "authoring-editor":
      return pane.content.title;
  }
}

function focusedDirtyCloseAction(
  target: EventTarget,
  cancelButton: HTMLButtonElement | null,
  confirmButton: HTMLButtonElement | null,
): "dialog" | "cancel" | "confirm" {
  if (target === confirmButton) {
    return "confirm";
  }

  if (target === cancelButton) {
    return "cancel";
  }

  return "dialog";
}

function dirtyCloseKeyInput(
  event: KeyboardEvent<HTMLDivElement>,
  focusedAction: "dialog" | "cancel" | "confirm",
  cancelButton: HTMLButtonElement | null,
  confirmButton: HTMLButtonElement | null,
): DirtyCloseConfirmationKeyInput {
  if (event.key === "Tab") {
    return {
      kind: "tab",
      focusedAction,
      actionsVisibility: dirtyCloseActionsVisibility(
        cancelButton,
        confirmButton,
      ),
      direction: event.shiftKey ? "backward" : "forward",
    };
  }

  return { kind: "key", key: event.key, focusedAction };
}

export function DirtyCloseConfirmation({
  pane,
  onConfirm,
  onCancel,
}: DirtyCloseConfirmationProps): ReactElement {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useLayoutEffect(() => {
    dialogRef.current?.focus();
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const focusedAction = focusedDirtyCloseAction(
      event.target,
      cancelRef.current,
      confirmRef.current,
    );
    const result = handleDirtyCloseConfirmationKey(
      dirtyCloseKeyInput(
        event,
        focusedAction,
        cancelRef.current,
        confirmRef.current,
      ),
    );

    switch (result.kind) {
      case "cancel":
        event.preventDefault();
        onCancel();
        return;
      case "confirm":
        event.preventDefault();
        onConfirm();
        return;
      case "focus-dialog":
        event.preventDefault();
        dialogRef.current?.focus();
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
      ref={dialogRef}
      className="fixed inset-0 z-10 grid place-items-center bg-surface-deepest/80 p-4"
      role="alertdialog"
      tabIndex={-1}
      aria-modal="true"
      aria-labelledby="dirty-pane-close-title"
      aria-describedby="dirty-pane-close-description"
      onKeyDown={handleKeyDown}
    >
      <section className="w-full max-w-md rounded-md border border-surface-border bg-surface-dark p-4 text-text-primary">
        <h2 id="dirty-pane-close-title" className="text-lg font-semibold">
          Discard editor changes?
        </h2>
        <p id="dirty-pane-close-description" className="mt-2 text-text-bright">
          {paneLabel(pane)} has unsaved changes.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            className="rounded border border-surface-border px-3 py-2 md:hidden"
            onClick={onCancel}
          >
            Keep editing
          </button>
          <button
            ref={confirmRef}
            type="button"
            className="rounded border border-diagnostic-error px-3 py-2 text-diagnostic-error md:hidden"
            onClick={onConfirm}
          >
            Close pane
          </button>
        </div>
      </section>
    </div>
  );
}
