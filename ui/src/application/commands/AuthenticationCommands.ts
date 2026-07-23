import { cvViewerKeyFrom } from "../../api/CvClient.ts";
import type { Session } from "../../api/SessionClient.ts";
import type { AuthenticationController } from "../../auth/Authentication.ts";
import { createDocumentViewerContent, type ViewerContent, type ViewerOpenDisposition } from "../../content/ViewerContent.ts";
import {
  createSecretPromptId,
  createSecretPromptRequest,
  createShellDiagnosticId,
  createShellOutputId,
  type CommandOutcome,
  type SecretPromptEffect,
  type SecretPromptId,
  type ShellOutput,
} from "../../domain/terminal/Shell.ts";
import type {
  CommandDefinition,
  CommandInvocation,
} from "./CommandRegistry.ts";

const cvInlinePromptId = createSecretPromptId("cv-key-inline");
const cvHorizontalPromptId = createSecretPromptId("cv-key-horizontal");
const cvVerticalPromptId = createSecretPromptId("cv-key-vertical");

type CvCommandAction =
  | Readonly<{ kind: "read"; disposition: ViewerOpenDisposition }>
  | Readonly<{ kind: "lock" }>
  | Readonly<{ kind: "invalid"; message: string }>;

export type CvViewerOpener = (
  viewer: ViewerContent,
  disposition: ViewerOpenDisposition,
) => void;

function succeeded(
  outputs: ReadonlyArray<ShellOutput>,
  effects: Extract<CommandOutcome, { kind: "succeeded" }>["effects"] = [],
): CommandOutcome {
  return { kind: "succeeded", outputs, effects };
}

function textOutcome(id: string, text: string): CommandOutcome {
  return succeeded([{ kind: "text", id: createShellOutputId(id), text }]);
}

function rejected(commandName: string, message: string): CommandOutcome {
  return {
    kind: "failed",
    failure: { kind: "command-rejected", commandName, message },
    diagnostics: [
      {
        kind: "command",
        id: createShellDiagnosticId(`${commandName}-rejected`),
        code: "command.rejected",
        message,
      },
    ],
  };
}

function noArguments(invocation: CommandInvocation, usage: string): CommandOutcome | undefined {
  return invocation.arguments.length === 0
    ? undefined
    : rejected(invocation.name, `Usage: ${usage}`);
}

function sessionDescription(session: Session): string {
  switch (session.kind) {
    case "anonymous":
      return "anonymous";
    case "github-viewer":
      return `${session.login} (GitHub viewer)`;
    case "cv-viewer":
      return "anonymous (CV viewer)";
    case "github-cv-viewer":
      return `${session.login} (GitHub viewer, CV viewer)`;
    case "owner":
      return `${session.login} (owner, CV viewer)`;
  }
}

function parseCvCommand(invocation: CommandInvocation): CvCommandAction {
  const [first, second] = invocation.arguments;

  if (first === undefined) {
    return { kind: "read", disposition: { kind: "inline" } };
  }

  if (first === "lock" && second === undefined) {
    return { kind: "lock" };
  }

  if (
    first === "--split" &&
    invocation.arguments.length === 2 &&
    (second === "horizontal" || second === "vertical")
  ) {
    return {
      kind: "read",
      disposition: { kind: "split", orientation: second },
    };
  }

  return {
    kind: "invalid",
    message: "Usage: cv [--split horizontal|vertical] | cv lock",
  };
}

function promptIdFor(disposition: ViewerOpenDisposition): SecretPromptId {
  if (disposition.kind === "inline") {
    return cvInlinePromptId;
  }

  return disposition.orientation === "horizontal"
    ? cvHorizontalPromptId
    : cvVerticalPromptId;
}

function dispositionForPrompt(requestId: SecretPromptId): ViewerOpenDisposition | undefined {
  if (requestId === cvInlinePromptId) {
    return { kind: "inline" };
  }

  if (requestId === cvHorizontalPromptId) {
    return { kind: "split", orientation: "horizontal" };
  }

  if (requestId === cvVerticalPromptId) {
    return { kind: "split", orientation: "vertical" };
  }

  return undefined;
}

export function cvViewerContent(markdown: string): ViewerContent {
  return createDocumentViewerContent({
    title: "cv.md",
    presentation: "inline",
    document: {
      text: markdown,
      source: { path: "~/cv.md" },
      preview: { kind: "markdown" },
    },
    statsIdentity: { kind: "uncounted" },
  });
}

export async function submitCvSecret(
  effect: Extract<SecretPromptEffect, { kind: "secret-submitted" }>,
  authentication: AuthenticationController,
  openViewer: CvViewerOpener,
): Promise<Readonly<{ kind: "succeeded" }> | Readonly<{
  kind: "failed";
  message: "CV access failed.";
}>> {
  const disposition = dispositionForPrompt(effect.requestId);
  const parsed = cvViewerKeyFrom(effect.value);

  if (disposition === undefined || parsed.kind === "invalid") {
    return { kind: "failed", message: "CV access failed." };
  }

  try {
    const signal = AbortSignal.timeout(10_000);
    const access = await authentication.unlockCv(parsed.key, signal);

    if (access.kind !== "unlocked") {
      return { kind: "failed", message: "CV access failed." };
    }

    const document = await authentication.readCv(signal);

    if (document.kind !== "available") {
      return { kind: "failed", message: "CV access failed." };
    }

    openViewer(cvViewerContent(document.markdown), disposition);
    return { kind: "succeeded" };
  } catch {
    return { kind: "failed", message: "CV access failed." };
  }
}

function loginCommand(authentication: AuthenticationController): CommandDefinition {
  return {
    metadata: {
      group: "application",
      name: "login",
      aliases: [],
      summary: "Authenticate with GitHub.",
      usage: "login",
      examples: ["login"],
    },
    pipeline: "effects",
    execute: async (invocation, context) => {
      const invalid = noArguments(invocation, "login");

      if (invalid !== undefined) {
        return invalid;
      }

      const state = await authentication.login(context.signal);

      if (state.kind !== "available" || state.session.kind === "anonymous") {
        return rejected("login", "Authentication failed.");
      }

      return textOutcome("login-output", `Authenticated as ${sessionDescription(state.session)}.`);
    },
  };
}

function logoutCommand(authentication: AuthenticationController): CommandDefinition {
  return {
    metadata: {
      group: "application",
      name: "logout",
      aliases: [],
      summary: "End the authenticated session.",
      usage: "logout",
      examples: ["logout"],
    },
    pipeline: "effects",
    execute: async (invocation, context) => {
      const invalid = noArguments(invocation, "logout");

      if (invalid !== undefined) {
        return invalid;
      }

      const state = await authentication.logout(context.signal);

      if (state.kind !== "available" || state.session.kind !== "anonymous") {
        return rejected("logout", "Authentication failed.");
      }

      return textOutcome("logout-output", "Logged out.");
    },
  };
}

function whoamiCommand(authentication: AuthenticationController): CommandDefinition {
  return {
    metadata: {
      group: "gnu-like",
      name: "whoami",
      aliases: [],
      summary: "Show the current development capability.",
      usage: "whoami",
      examples: ["whoami"],
    },
    pipeline: "text",
    execute: async (invocation, context) => {
      const invalid = noArguments(invocation, "whoami");

      if (invalid !== undefined) {
        return invalid;
      }

      const state = await authentication.refresh(context.signal);

      if (state.kind === "unavailable") {
        return textOutcome("whoami-output", "anonymous (authentication unavailable)");
      }

      if (state.kind === "loading") {
        return textOutcome("whoami-output", "anonymous");
      }

      return textOutcome("whoami-output", sessionDescription(state.session));
    },
  };
}

function cvCommand(authentication: AuthenticationController): CommandDefinition {
  return {
    metadata: {
      group: "navigation",
      name: "cv",
      aliases: [],
      summary: "Unlock or open protected CV content.",
      usage: "cv [--split horizontal|vertical] | cv lock",
      examples: ["cv", "cv --split vertical", "cv lock"],
    },
    pipeline: "effects",
    execute: async (invocation, context) => {
      const action = parseCvCommand(invocation);

      if (action.kind === "invalid") {
        return rejected("cv", action.message);
      }

      if (action.kind === "lock") {
        const result = await authentication.lockCv(context.signal);
        return result.kind === "locked"
          ? textOutcome("cv-locked-output", "CV access locked.")
          : rejected("cv", "CV access failed.");
      }

      await authentication.refresh(context.signal);
      const document = await authentication.readCv(context.signal);

      if (document.kind === "failed") {
        return rejected("cv", "CV access failed.");
      }

      if (document.kind === "locked") {
        return succeeded([], [
          {
            kind: "request-secret-prompt",
            request: createSecretPromptRequest(
              promptIdFor(action.disposition),
              "CV viewer key",
            ),
          },
        ]);
      }

      return succeeded([], [
        {
          kind: "open-viewer",
          viewer: cvViewerContent(document.markdown),
          disposition: action.disposition,
        },
      ]);
    },
  };
}

export function createAuthenticationCommandDefinitions(
  authentication: AuthenticationController,
): ReadonlyArray<CommandDefinition> {
  return [
    loginCommand(authentication),
    logoutCommand(authentication),
    whoamiCommand(authentication),
    cvCommand(authentication),
  ];
}
