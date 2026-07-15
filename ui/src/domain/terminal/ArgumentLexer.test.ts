import assert from "node:assert/strict";
import test from "node:test";
import { lexArguments } from "./ArgumentLexer.ts";

function successfulLex(source: string) {
  const result = lexArguments(source);

  if (result.kind !== "success") {
    assert.fail(`Expected a successful lex but received ${result.error.kind}.`);
  }

  return result;
}

test("lexes whitespace-delimited arguments", () => {
  const result = successfulLex("  open\tprojects\nnow  ");

  assert.deepEqual(
    result.arguments.map((argument) => argument.value),
    ["open", "projects", "now"],
  );
  assert.deepEqual(result.optionTerminator, { kind: "absent" });
});

test("lexes quoted, concatenated, escaped, and empty arguments", () => {
  const result = successfulLex(
    "open 'one two' \"three four\" five\\ six '' \"seven\\\"eight\" nine'ten'",
  );

  assert.deepEqual(
    result.arguments.map((argument) => argument.value),
    ["open", "one two", "three four", "five six", "", 'seven"eight', "nineten"],
  );
});

test("recognises an unescaped unquoted option terminator", () => {
  const result = successfulLex("find -- -hidden --literal");

  assert.deepEqual(
    result.arguments.map((argument) => argument.value),
    ["find", "-hidden", "--literal"],
  );
  assert.deepEqual(result.optionTerminator, {
    kind: "present",
    argumentIndex: 1,
    sourceStart: 5,
    sourceEnd: 7,
  });
});

test("keeps quoted and escaped option terminators as arguments", () => {
  const result = successfulLex("echo '--' \\--");

  assert.deepEqual(
    result.arguments.map((argument) => argument.value),
    ["echo", "--", "--"],
  );
  assert.deepEqual(result.optionTerminator, { kind: "absent" });
});

test("reports each explicit lexer error", () => {
  assert.deepEqual(lexArguments("open 'unfinished"), {
    kind: "error",
    error: { kind: "unterminated-single-quote", position: 5 },
  });
  assert.deepEqual(lexArguments('open "unfinished'), {
    kind: "error",
    error: { kind: "unterminated-double-quote", position: 5 },
  });
  assert.deepEqual(lexArguments("open trailing\\"), {
    kind: "error",
    error: { kind: "trailing-escape", position: 13 },
  });
  assert.deepEqual(lexArguments('open "trailing\\'), {
    kind: "error",
    error: { kind: "trailing-escape", position: 14 },
  });
});
