import assert from "node:assert/strict";
import test from "node:test";
import {
  createTerminalInput,
  insertTerminalInputText,
} from "./TerminalInput.ts";

test("inserts text at the terminal input cursor", () => {
  const input = createTerminalInput({ value: "ac", cursor: 1 });

  const result = insertTerminalInputText(input, "b");

  assert.deepEqual(result, { value: "abc", cursor: 2 });
});
