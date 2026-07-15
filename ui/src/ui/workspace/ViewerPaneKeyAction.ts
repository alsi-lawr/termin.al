import {
  rawPagerOperationFromKey,
  type RawPagerOperation,
} from "../../domain/viewer/RawPager.ts";

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

type ViewerPaneKeyAction =
  | Readonly<{
      kind: "pager-operation";
      operation: RawPagerNavigationOperation;
    }>
  | Readonly<{ kind: "close" }>
  | Readonly<{ kind: "ignored" }>;

export function viewerPaneKeyActionFromInput(
  input: ViewerPaneKeyInput,
): ViewerPaneKeyAction {
  if (input.kind === "raw-pager") {
    const pagerKey = rawPagerOperationFromKey(input);

    if (pagerKey.kind === "ignored") {
      return { kind: "ignored" };
    }

    if (pagerKey.operation.kind === "quit") {
      return { kind: "close" };
    }

    return {
      kind: "pager-operation",
      operation: pagerKey.operation,
    };
  }

  if (input.ctrlKey || input.metaKey) {
    return { kind: "ignored" };
  }

  if (input.key !== "Escape" && input.key !== "q") {
    return { kind: "ignored" };
  }

  return { kind: "close" };
}
