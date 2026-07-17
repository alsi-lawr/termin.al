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
    result.tokens.map((token) => token.kind === "argument" ? token.value : token.kind),
    ["open", "projects", "now"],
  );
});

test("lexes quoted, concatenated, escaped, and empty arguments", () => {
  const result = successfulLex(
    "open 'one two' \"three four\" five\\ six '' \"seven\\\"eight\" nine'ten'",
  );

  assert.deepEqual(
    result.tokens.map((token) => token.kind === "argument" ? token.value : token.kind),
    ["open", "one two", "three four", "five six", "", 'seven"eight', "nineten"],
  );
});

test("recognises an unescaped unquoted option terminator", () => {
  const result = successfulLex("find -- -hidden --literal");

  assert.deepEqual(result.tokens, [
    { kind: "argument", value: "find", sourceStart: 0, sourceEnd: 4 },
    {
      kind: "option-terminator",
      argumentIndex: 1,
      sourceStart: 5,
      sourceEnd: 7,
    },
    { kind: "argument", value: "-hidden", sourceStart: 8, sourceEnd: 15 },
    { kind: "argument", value: "--literal", sourceStart: 16, sourceEnd: 25 },
  ]);
});

test("keeps quoted and escaped option terminators as arguments", () => {
  const result = successfulLex("echo '--' \\--");

  assert.deepEqual(
    result.tokens.map((token) => token.kind === "argument" ? token.value : token.kind),
    ["echo", "--", "--"],
  );
});

test("separates unquoted operators and keeps quoted or escaped operators literal", () => {
  const result = successfulLex("echo ';' \\| && echo \"||\";next|last");

  assert.deepEqual(
    result.tokens.map((token) => {
      if (token.kind === "argument") {
        return token.value;
      }

      return token.kind === "operator" ? token.operator : token.kind;
    }),
    ["echo", ";", "|", "&&", "echo", "||", ";", "next", "|", "last"],
  );

  assert.deepEqual(
    result.tokens
      .filter((token) => token.kind === "operator")
      .map((token) => token.position),
    [12, 24, 29],
  );
});

test("tracks option terminators independently for each command unit", () => {
  const result = successfulLex("first -- one; second -- two");

  assert.deepEqual(
    result.tokens
      .filter((token) => token.kind === "option-terminator")
      .map((token) => ({
        argumentIndex: token.argumentIndex,
        sourceStart: token.sourceStart,
        sourceEnd: token.sourceEnd,
      })),
    [
      { argumentIndex: 1, sourceStart: 6, sourceEnd: 8 },
      { argumentIndex: 1, sourceStart: 21, sourceEnd: 23 },
    ],
  );
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
  assert.deepEqual(lexArguments("echo one & echo two"), {
    kind: "error",
    error: { kind: "unsupported-background-operator", position: 9 },
  });
});
