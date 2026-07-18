import {
  createEditorPaneContent,
  createPlaceholderViewerPaneContent,
  createShellPaneContent,
  type PaneContent,
  type PaneDirection,
  type PaneId,
  type PaneLayout,
  type PaneOperation,
  type PaneOperationResult,
} from "../../domain/workspace/PaneTree.ts";
import {
  createShellDiagnosticId,
  createShellOutputId,
  type CommandOutcome,
} from "../../domain/terminal/Shell.ts";
import type {
  CommandDefinition,
  CommandInvocation,
} from "./CommandRegistry.ts";

export type PaneCommandParseResult =
  | Readonly<{
      kind: "parsed";
      operation: PaneOperation;
    }>
  | Readonly<{
      kind: "invalid";
      message: string;
    }>;

export type PaneCommandHandler = (
  operation: PaneOperation,
) => PaneOperationResult;

type DirectionParseResult =
  | Readonly<{
      kind: "parsed";
      direction: PaneDirection;
    }>
  | Readonly<{ kind: "invalid" }>;

type ContentParseResult =
  | Readonly<{
      kind: "parsed";
      content: PaneContent;
    }>
  | Readonly<{
      kind: "invalid";
      message: string;
    }>;

type LayoutParseResult =
  | Readonly<{
      kind: "parsed";
      layout: Exclude<PaneLayout, "manual">;
    }>
  | Readonly<{ kind: "invalid" }>;

function direction(value: string | undefined): DirectionParseResult {
  switch (value) {
    case "left":
    case "right":
    case "up":
    case "down":
      return { kind: "parsed", direction: value };
    default:
      return { kind: "invalid" };
  }
}

function content(value: string | undefined): ContentParseResult {
  switch (value ?? "shell") {
    case "shell":
      return { kind: "parsed", content: createShellPaneContent() };
    case "viewer":
      return {
        kind: "parsed",
        content: createPlaceholderViewerPaneContent("Viewer"),
      };
    case "editor":
      return { kind: "parsed", content: createEditorPaneContent("Untitled") };
    default:
      return {
        kind: "invalid",
        message: "Pane content must be shell, viewer, or editor.",
      };
  }
}

function layout(value: string | undefined): LayoutParseResult {
  switch (value) {
    case "even-horizontal":
    case "even-vertical":
    case "main-horizontal":
    case "main-vertical":
    case "tiled":
      return { kind: "parsed", layout: value };
    default:
      return { kind: "invalid" };
  }
}

function paneNumber(value: string | undefined): number | undefined {
  if (value === undefined || !/^[1-9][0-9]*$/u.test(value)) {
    return undefined;
  }

  const number = Number(value);

  return Number.isSafeInteger(number) ? number : undefined;
}

function hasOnlyArguments(
  argumentsList: ReadonlyArray<string>,
  count: number,
): boolean {
  return argumentsList.length === count;
}

function invalid(message: string): PaneCommandParseResult {
  return { kind: "invalid", message };
}

function parseSplit(
  argumentsList: ReadonlyArray<string>,
  paneId: PaneId,
): PaneCommandParseResult {
  const orientation = argumentsList[1];

  if (orientation !== "horizontal" && orientation !== "vertical") {
    return invalid("Usage: pane split horizontal|vertical [shell|viewer|editor].");
  }

  if (argumentsList.length > 3) {
    return invalid("Usage: pane split horizontal|vertical [shell|viewer|editor].");
  }

  const parsedContent = content(argumentsList[2]);

  if (parsedContent.kind === "invalid") {
    return invalid(parsedContent.message);
  }

  return {
    kind: "parsed",
    operation: {
      kind: "split",
      paneId,
      orientation,
      content: parsedContent.content,
    },
  };
}

function parseFocus(
  argumentsList: ReadonlyArray<string>,
): PaneCommandParseResult {
  const target = argumentsList[1];

  if (!hasOnlyArguments(argumentsList, 2)) {
    return invalid("Usage: pane focus left|right|up|down|next|<number>.");
  }

  if (target === "next") {
    return { kind: "parsed", operation: { kind: "focus-next" } };
  }

  const parsedDirection = direction(target);

  if (parsedDirection.kind === "parsed") {
    return {
      kind: "parsed",
      operation: {
        kind: "focus-direction",
        direction: parsedDirection.direction,
      },
    };
  }

  const number = paneNumber(target);

  return number === undefined
    ? invalid("Usage: pane focus left|right|up|down|next|<number>.")
    : {
        kind: "parsed",
        operation: { kind: "focus-number", number },
      };
}

function parseResize(
  argumentsList: ReadonlyArray<string>,
): PaneCommandParseResult {
  if (!hasOnlyArguments(argumentsList, 2)) {
    return invalid("Usage: pane resize left|right|up|down.");
  }

  const parsedDirection = direction(argumentsList[1]);

  return parsedDirection.kind === "invalid"
    ? invalid("Usage: pane resize left|right|up|down.")
    : {
        kind: "parsed",
        operation: { kind: "resize", direction: parsedDirection.direction },
      };
}

function parseOrderedOperation(
  argumentsList: ReadonlyArray<string>,
  operationKind: "swap" | "rotate",
): PaneCommandParseResult {
  const direction = argumentsList[1];

  if (
    !hasOnlyArguments(argumentsList, 2) ||
    (direction !== "previous" && direction !== "next")
  ) {
    return invalid("Usage: pane " + operationKind + " previous|next.");
  }

  return {
    kind: "parsed",
    operation: { kind: operationKind, direction },
  };
}

function parseLayout(
  argumentsList: ReadonlyArray<string>,
): PaneCommandParseResult {
  if (!hasOnlyArguments(argumentsList, 2)) {
    return invalid(
      "Usage: pane layout even-horizontal|even-vertical|main-horizontal|main-vertical|tiled|next.",
    );
  }

  if (argumentsList[1] === "next") {
    return { kind: "parsed", operation: { kind: "cycle-layout" } };
  }

  const parsedLayout = layout(argumentsList[1]);

  return parsedLayout.kind === "invalid"
    ? invalid(
        "Usage: pane layout even-horizontal|even-vertical|main-horizontal|main-vertical|tiled|next.",
      )
    : {
        kind: "parsed",
        operation: { kind: "set-layout", layout: parsedLayout.layout },
      };
}

export function parsePaneCommand(
  argumentsList: ReadonlyArray<string>,
  paneId: PaneId,
): PaneCommandParseResult {
  switch (argumentsList[0]) {
    case "split":
      return parseSplit(argumentsList, paneId);
    case "focus":
      return parseFocus(argumentsList);
    case "select": {
      const number =
        hasOnlyArguments(argumentsList, 2)
          ? paneNumber(argumentsList[1])
          : undefined;

      return number === undefined
        ? invalid("Usage: pane select <number>.")
        : {
            kind: "parsed",
            operation: { kind: "focus-number", number },
          };
    }
    case "resize":
      return parseResize(argumentsList);
    case "close":
      return hasOnlyArguments(argumentsList, 1)
        ? { kind: "parsed", operation: { kind: "close" } }
        : invalid("Usage: pane close.");
    case "zoom":
      return hasOnlyArguments(argumentsList, 1)
        ? { kind: "parsed", operation: { kind: "toggle-zoom" } }
        : invalid("Usage: pane zoom.");
    case "swap":
      return parseOrderedOperation(argumentsList, "swap");
    case "rotate":
      return parseOrderedOperation(argumentsList, "rotate");
    case "layout":
      return parseLayout(argumentsList);
    default:
      return invalid(
        "Usage: pane split|focus|select|resize|close|zoom|swap|rotate|layout.",
      );
  }
}

function rejectedOutcome(message: string): CommandOutcome {
  return {
    kind: "failed",
    failure: {
      kind: "command-rejected",
      commandName: "pane",
      message,
    },
    diagnostics: [
      {
        kind: "command",
        id: createShellDiagnosticId("pane-command-rejected"),
        code: "command.rejected",
        message,
      },
    ],
  };
}

function appliedOutcome(message: string): CommandOutcome {
  return {
    kind: "succeeded",
    outputs: [
      {
        kind: "text",
        id: createShellOutputId("pane-command"),
        text: message,
      },
    ],
    effects: [],
  };
}

function commandOutcome(result: PaneOperationResult): CommandOutcome {
  switch (result.kind) {
    case "applied":
      return appliedOutcome("Pane operation applied.");
    case "confirmation-required":
      return appliedOutcome("Confirm closing the dirty editor pane.");
    case "rejected":
      return rejectedOutcome("Pane operation rejected: " + result.reason + ".");
  }
}

function executePaneCommand(
  invocation: CommandInvocation,
  paneId: PaneId,
  handler: PaneCommandHandler,
): CommandOutcome {
  const parsed = parsePaneCommand(invocation.arguments, paneId);

  return parsed.kind === "invalid"
    ? rejectedOutcome(parsed.message)
    : commandOutcome(handler(parsed.operation));
}

export function createPaneCommandDefinition(
  paneId: PaneId,
  handler: PaneCommandHandler,
): CommandDefinition {
  return {
    metadata: {
      group: "application",
      name: "pane",
      aliases: [],
      summary: "Manage terminal panes.",
      usage: "pane split|focus|select|resize|close|zoom|swap|rotate|layout",
      examples: ["pane split horizontal viewer", "pane focus next"],
    },
    pipeline: "effects",
    execute: (invocation) =>
      Promise.resolve(executePaneCommand(invocation, paneId, handler)),
  };
}
