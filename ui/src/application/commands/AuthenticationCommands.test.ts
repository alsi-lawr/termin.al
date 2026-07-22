import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DemoCvClient } from "../../api/CvClient.ts";
import { DemoCapabilityState, DemoSessionClient } from "../../api/SessionClient.ts";
import { AuthenticationController } from "../../auth/Authentication.ts";
import { virtualHomeDirectory } from "../../domain/filesystem/VirtualFilesystem.ts";
import {
  createShellId,
  createShellSessionId,
  createShellState,
  reduceShellState,
  type CommandLineOutcome,
  type ShellCommandRequest,
} from "../../domain/terminal/Shell.ts";
import { demoContentCorpus } from "../../content/DemoContentCorpus.ts";
import { executeCommandLine } from "./CommandExecution.ts";
import { createCommandRegistry } from "./CommandRegistry.ts";
import {
  createAuthenticationCommandDefinitions,
  submitCvSecret,
} from "./AuthenticationCommands.ts";

function request(source: string): ShellCommandRequest {
  const initial = createShellState({
    id: createShellId("authentication-test-shell"),
    sessionId: createShellSessionId("authentication-test-session"),
    currentDirectory: virtualHomeDirectory(),
    scrollbackLimit: 10,
    commandHistoryLimit: 10,
    commandHistory: [],
  });
  const typed = reduceShellState(initial, { kind: "input.insert", text: source });
  const submitted = reduceShellState(typed, {
    kind: "prompt.submit",
    submission: { kind: "command", persistence: { kind: "persistent" } },
  });

  if (submitted.lifecycle.kind !== "running") {
    throw new Error("Expected an authentication command request.");
  }

  return submitted.lifecycle.command;
}

function outputText(outcome: CommandLineOutcome): string {
  if (outcome.kind !== "succeeded") {
    assert.fail("Expected a successful authentication command.");
  }

  const output = outcome.events.find(
    (event) => event.kind === "output" && event.output.kind === "text",
  );

  if (output === undefined || output.kind !== "output" || output.output.kind !== "text") {
    assert.fail("Expected authentication command text.");
  }

  return output.output.text;
}

describe("authentication terminal commands", () => {
  test("complete login, identity, protected CV, lock, and logout transitions", async () => {
    const demoCapabilities = new DemoCapabilityState();
    const authentication = new AuthenticationController(
      new DemoSessionClient(demoCapabilities),
      new DemoCvClient(demoCapabilities),
    );
    const registry = createCommandRegistry({
      filesystem: demoContentCorpus.filesystem,
      documents: demoContentCorpus.documents,
      onFilesystemChange: () => {},
      commands: createAuthenticationCommandDefinitions(authentication),
    });
    const execute = (source: string): Promise<CommandLineOutcome> =>
      executeCommandLine({
        registry,
        request: request(source),
        signal: new AbortController().signal,
      });

    assert.equal(outputText(await execute("whoami")), "anonymous");
    assert.match(outputText(await execute("login")), /^Authenticated as demo-viewer/);
    assert.equal(outputText(await execute("whoami")), "demo-viewer (GitHub viewer)");

    const cv = await execute("cv --split vertical");

    if (cv.kind !== "succeeded") {
      assert.fail("Expected CV key prompting to succeed.");
    }

    const prompt = cv.events.find(
      (event) => event.kind === "effect" && event.effect.kind === "request-secret-prompt",
    );

    if (prompt === undefined || prompt.kind !== "effect" || prompt.effect.kind !== "request-secret-prompt") {
      assert.fail("Expected a non-echoing CV key prompt effect.");
    }

    const opened: Array<Readonly<{ title: string; disposition: string }>> = [];
    const secretInitial = createShellState({
      id: createShellId("authentication-secret-shell"),
      sessionId: createShellSessionId("authentication-secret-session"),
      currentDirectory: virtualHomeDirectory(),
      scrollbackLimit: 10,
      commandHistoryLimit: 10,
      commandHistory: [],
    });
    const secretActive = reduceShellState(secretInitial, {
      kind: "secret.begin",
      request: prompt.effect.request,
    });
    const secretTyped = reduceShellState(secretActive, {
      kind: "input.insert",
      text: "x".repeat(32),
    });
    const secretSubmitted = reduceShellState(secretTyped, {
      kind: "prompt.submit",
      submission: { kind: "secret" },
    });

    if (secretSubmitted.pendingEffect.kind !== "secret-submitted") {
      assert.fail("Expected a submitted non-echoing CV prompt.");
    }

    const delivered = await submitCvSecret(
      secretSubmitted.pendingEffect,
      authentication,
      (viewer, disposition) => {
        opened.push({
          title: viewer.title,
          disposition:
            disposition.kind === "inline" ? "inline" : disposition.orientation,
        });
      },
    );

    assert.deepEqual(delivered, { kind: "succeeded" });
    assert.deepEqual(opened, [{ title: "cv.md", disposition: "vertical" }]);
    assert.equal(outputText(await execute("cv lock")), "CV access locked.");
    assert.equal((await execute("cv positional-secret")).kind, "failed");
    assert.equal(outputText(await execute("logout")), "Logged out.");
    assert.equal(authentication.snapshot().sensitiveRevision, 1);
  });
});
