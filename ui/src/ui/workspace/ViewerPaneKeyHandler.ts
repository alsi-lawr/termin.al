import {
  rawPagerOperationFromKey,
  type RawPagerOperation,
} from "../../domain/viewer/RawPager.ts";
import type {
  InputCapturePaneKeyInput,
  InputCapturePaneKeyResult,
} from "../terminal/InputCapture";

type RawPagerNavigationOperation = Exclude<
  RawPagerOperation,
  Readonly<{ kind: "quit" }>
>;

type ViewerPaneKeyInput =
  | Readonly<{
      kind: "raw-pager";
      key: string;
      altKey: boolean;
      ctrlKey: boolean;
      metaKey: boolean;
    }>
  | Readonly<{
      kind: "viewer";
      key: string;
      ctrlKey: boolean;
      metaKey: boolean;
    }>;

type ViewerPaneKeyHandlerOptions = Readonly<{
  input: ViewerPaneKeyInput;
  onPaneKeyInput: (
    input: InputCapturePaneKeyInput,
  ) => InputCapturePaneKeyResult;
  onClose?: () => void;
  onViewerKeyInput?: (
    input: Extract<ViewerPaneKeyInput, { kind: "viewer" }>,
  ) => InputCapturePaneKeyResult;
  onPagerOperation: (operation: RawPagerNavigationOperation) => void;
  preventDefault: () => void;
}>;

export function handleViewerPaneKeyInput({
  input,
  onPaneKeyInput,
  onClose,
  onViewerKeyInput,
  onPagerOperation,
  preventDefault,
}: ViewerPaneKeyHandlerOptions): void {
  const paneKeyResult = onPaneKeyInput({
    key: input.key,
    ctrlKey: input.ctrlKey,
    metaKey: input.metaKey,
  });

  if (paneKeyResult.kind === "handled") {
    preventDefault();
    return;
  }

  if (input.kind === "raw-pager") {
    const pagerKeyResult = rawPagerOperationFromKey(input);

    if (pagerKeyResult.kind === "ignored") {
      return;
    }

    preventDefault();

    if (pagerKeyResult.operation.kind === "quit") {
      onClose?.();
      return;
    }

    onPagerOperation(pagerKeyResult.operation);
    return;
  }

  const viewerKeyResult = onViewerKeyInput?.(input);

  if (viewerKeyResult?.kind === "handled") {
    preventDefault();
    return;
  }

  if (input.ctrlKey || input.metaKey) {
    return;
  }

  if (input.key !== "Escape" && input.key !== "q") {
    return;
  }

  if (onClose === undefined) {
    return;
  }

  preventDefault();
  onClose();
}
