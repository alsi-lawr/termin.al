import assert from "node:assert/strict";
import test from "node:test";
import {
  VimCapability,
  VimMode,
  appendVimCommandInput,
  applyNormalVimKey,
  createVimBuffer,
  submitVimCommand,
  type VimBuffer,
} from "../../domain/vim/VimBuffer.ts";
import {
  createVimSessionState,
  initialVimHistoryNavigation,
  navigateVimHistory,
  recordVimSubmission,
  vimSessionListing,
  type VimHistoryKind,
  type VimSessionState,
} from "./VimSessionState.ts";

function commandPrompt(
  source: string,
  capability: VimCapability = VimCapability.Editable,
): VimBuffer {
  return appendVimCommandInput(
    applyNormalVimKey(
      createVimBuffer({ text: "alpha", mode: VimMode.Normal, capability }),
      { kind: "enter-command" },
    ),
    source,
  );
}

function record(
  state: VimSessionState,
  history: VimHistoryKind,
  previous: VimBuffer,
): Readonly<{ state: VimSessionState; next: VimBuffer }> {
  if (previous.mode.kind !== "command" && previous.mode.kind !== "search") {
    throw new Error("Expected a Vim prompt before submission.");
  }

  const next = submitVimCommand(previous);
  return {
    state: recordVimSubmission(state, {
      history,
      source: previous.mode.input,
      previous,
      next,
    }),
    next,
  };
}

test("keeps bounded distinct command and search histories for one workspace", () => {
  const empty = createVimSessionState();
  const firstCommand = record(empty, "command", commandPrompt("write"));
  const otherCommand = record(
    firstCommand.state,
    "command",
    commandPrompt("other"),
  );
  const duplicateCommand = record(
    otherCommand.state,
    "command",
    commandPrompt("write"),
  );
  assert.deepEqual(duplicateCommand.state.commandHistory, ["other", "write"]);
  const searchPrompt = appendVimCommandInput(
    applyNormalVimKey(
      createVimBuffer({ text: "alpha", mode: VimMode.Normal }),
      { kind: "enter-search" },
    ),
    "alpha",
  );
  let shared = record(duplicateCommand.state, "search", searchPrompt).state;

  shared = recordVimSubmission(shared, {
    history: "command",
    source: "",
    previous: commandPrompt(""),
    next: submitVimCommand(commandPrompt("")),
  });

  for (let index = 0; index < 101; index += 1) {
    const prompt = commandPrompt(`unknown-${index}`);
    shared = record(shared, "command", prompt).state;
  }

  assert.equal(shared.commandHistory.length, 100);
  assert.equal(shared.commandHistory[0], "unknown-1");
  assert.equal(shared.commandHistory.at(-1), "unknown-100");
  assert.deepEqual(shared.searchHistory, ["alpha"]);
  assert.equal(shared.messages.length, 100);
  assert.equal(shared.messages.every((message) => message.text === "Unknown command"), true);

  const secondPane = shared;
  const remountedWorkspace = createVimSessionState();
  assert.equal(secondPane.commandHistory, shared.commandHistory);
  assert.deepEqual(remountedWorkspace, {
    commandHistory: [],
    searchHistory: [],
    messages: [],
  });
});

test("navigates a fixed history prefix and restores the captured draft", () => {
  const history = ["alpha", "alpine", "beta", "algebra"];
  const newest = navigateVimHistory(
    history,
    "al",
    initialVimHistoryNavigation,
    "older",
  );
  const previous = navigateVimHistory(
    history,
    newest.input,
    newest.navigation,
    "older",
  );
  const oldest = navigateVimHistory(
    history,
    previous.input,
    previous.navigation,
    "older",
  );
  const newer = navigateVimHistory(
    history,
    oldest.input,
    oldest.navigation,
    "newer",
  );
  const newestAgain = navigateVimHistory(
    history,
    newer.input,
    newer.navigation,
    "newer",
  );
  const draft = navigateVimHistory(
    history,
    newestAgain.input,
    newestAgain.navigation,
    "newer",
  );
  const editedRecall = navigateVimHistory(
    history,
    "alpine!",
    initialVimHistoryNavigation,
    "older",
  );

  assert.equal(newest.input, "algebra");
  assert.equal(previous.input, "alpine");
  assert.equal(oldest.input, "alpha");
  assert.equal(newer.input, "alpine");
  assert.equal(newestAgain.input, "algebra");
  assert.deepEqual(draft, {
    input: "al",
    navigation: initialVimHistoryNavigation,
  });
  assert.equal(editedRecall.input, "alpine!");
  assert.deepEqual(history, ["alpha", "alpine", "beta", "algebra"]);
});

test("lists typed histories and records only existing visible submission messages", () => {
  let state = createVimSessionState();
  const write = record(state, "command", commandPrompt("w"));
  state = write.state;
  const silentPrompt = commandPrompt("s/alpha/alpha/");
  state = record(state, "command", silentPrompt).state;
  const readOnly = record(
    state,
    "command",
    commandPrompt("w", VimCapability.ReadOnly),
  );
  state = readOnly.state;
  const history = record(state, "command", commandPrompt("history"));
  state = history.state;
  const messages = record(state, "command", commandPrompt("messages"));
  state = messages.state;

  assert.deepEqual(state.messages, [
    { kind: "effect", text: "Write requested" },
    { kind: "status", text: "Read-only: :w" },
  ]);
  assert.deepEqual(vimSessionListing(history.state, history.next.commandEffect), {
    kind: "lines",
    lines: [
      "1  s/alpha/alpha/",
      "2  w",
      "3  history",
    ],
  });
  assert.deepEqual(vimSessionListing(state, messages.next.commandEffect), {
    kind: "lines",
    lines: ["Write requested", "Read-only: :w"],
  });
  assert.deepEqual(state.commandHistory, [
    "s/alpha/alpha/",
    "w",
    "history",
    "messages",
  ]);
});
