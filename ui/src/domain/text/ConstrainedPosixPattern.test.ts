import assert from "node:assert/strict";
import test from "node:test";
import {
  ConstrainedPosixPattern,
  type ConstrainedPosixMatchSpan,
  type ConstrainedPosixPatternDialect,
} from "./ConstrainedPosixPattern.ts";

const activeSignal = new AbortController().signal;

function compile(
  source: string,
  dialect: ConstrainedPosixPatternDialect = "basic",
  caseSensitivity: "sensitive" | "ascii-insensitive" = "sensitive",
): ConstrainedPosixPattern {
  const result = ConstrainedPosixPattern.compile(
    source,
    { dialect, caseSensitivity },
    activeSignal,
  );

  if (result.kind !== "compiled") {
    assert.fail(result.kind === "invalid" ? result.message : "Pattern compilation was cancelled.");
  }

  return result.pattern;
}

async function match(
  source: string,
  input: string,
  dialect: ConstrainedPosixPatternDialect = "basic",
  caseSensitivity: "sensitive" | "ascii-insensitive" = "sensitive",
): Promise<ConstrainedPosixMatchSpan | undefined> {
  const result = await compile(source, dialect, caseSensitivity).findMatch(
    input,
    activeSignal,
  );

  if (result.kind === "cancelled") {
    assert.fail("Pattern matching was cancelled.");
  }

  return result.kind === "matched" ? result.span : undefined;
}

function invalidMessage(
  source: string,
  dialect: ConstrainedPosixPatternDialect = "basic",
): string {
  const result = ConstrainedPosixPattern.compile(
    source,
    { dialect, caseSensitivity: "sensitive" },
    activeSignal,
  );

  if (result.kind !== "invalid") {
    assert.fail("Expected an invalid constrained POSIX pattern.");
  }

  return result.message;
}

test("matches fixed patterns literally with Unicode-scalar spans", async () => {
  assert.deepEqual(await match(".*[x]", "before .*[x] after", "fixed"), { start: 7, end: 12 });
  assert.deepEqual(await match("😀😀", "x😀😀y", "fixed"), { start: 1, end: 3 });
  assert.deepEqual(await match("", "😀", "fixed"), { start: 0, end: 0 });
  assert.equal(await match("Ä", "ä", "fixed", "ascii-insensitive"), undefined);
  assert.deepEqual(await match("A", "a", "fixed", "ascii-insensitive"), { start: 0, end: 1 });
});

test("supports the constrained BRE grammar", async () => {
  const cases: ReadonlyArray<readonly [string, string, ConstrainedPosixMatchSpan]> = [
    ["a.c", "xxa😀czz", { start: 2, end: 5 }],
    ["^abc$", "abc", { start: 0, end: 3 }],
    ["[abc][a-c]", "zzbc", { start: 2, end: 4 }],
    ["[^a-c]*", "xyz", { start: 0, end: 3 }],
    ["ab*", "abbb", { start: 0, end: 4 }],
    ["a\\{2\\}", "zaa", { start: 1, end: 3 }],
    ["a\\{1,2\\}", "zaaa", { start: 1, end: 3 }],
    ["a\\{2,\\}", "zaaaa", { start: 1, end: 5 }],
    ["\\(ab\\)*", "abab", { start: 0, end: 4 }],
    ["\\(\\)", "text", { start: 0, end: 0 }],
    ["\\.\\*\\[", ".*[", { start: 0, end: 3 }],
    ["[-a][a-]", "-a", { start: 0, end: 2 }],
  ];

  for (const [source, input, expected] of cases) {
    assert.deepEqual(await match(source, input), expected, source);
  }

  assert.equal(await match("^abc$", "xabc"), undefined);
  assert.equal(await match("a.b", "a\nb"), undefined);
});

test("supports ERE alternation, precedence, grouping, intervals, and epsilon", async () => {
  const cases: ReadonlyArray<readonly [string, string, ConstrainedPosixMatchSpan]> = [
    ["a+", "zaaa", { start: 1, end: 4 }],
    ["ba?", "b", { start: 0, end: 1 }],
    ["a{2}", "zaa", { start: 1, end: 3 }],
    ["a{1,2}", "aaa", { start: 0, end: 2 }],
    ["a{2,}", "aaaa", { start: 0, end: 4 }],
    ["(ab|a)c", "zabc", { start: 1, end: 4 }],
    ["ab|cd+", "xcddd", { start: 1, end: 5 }],
    ["(|a)b", "ab", { start: 0, end: 2 }],
    ["a|", "text", { start: 0, end: 0 }],
    ["", "text", { start: 0, end: 0 }],
  ];

  for (const [source, input, expected] of cases) {
    assert.deepEqual(await match(source, input, "extended"), expected, source);
  }
});

test("returns leftmost-longest matches without exponential backtracking", async () => {
  assert.deepEqual(await match("(a|aa)", "zaa", "extended"), { start: 1, end: 3 });
  assert.deepEqual(await match("ab|a", "ab", "extended"), { start: 0, end: 2 });
  assert.deepEqual(await match("😀+", "x😀😀y", "extended"), { start: 1, end: 3 });

  const pathological = `${"a".repeat(20_000)}c`;
  assert.equal(await match("^(a|aa)*b$", pathological, "extended"), undefined);
});

test("applies case-insensitive matching to ASCII only", async () => {
  assert.deepEqual(await match("[A-Z]+", "xxaBc", "extended", "ascii-insensitive"), {
    start: 0,
    end: 5,
  });
  assert.deepEqual(await match("abc", "xxABc", "basic", "ascii-insensitive"), {
    start: 2,
    end: 5,
  });
  assert.equal(await match("ä", "Ä", "basic", "ascii-insensitive"), undefined);
  assert.deepEqual(await match("[^A]", "aB", "basic", "ascii-insensitive"), {
    start: 1,
    end: 2,
  });
});

test("reports stable scalar-offset diagnostics for unsupported constructs", () => {
  const cases: ReadonlyArray<readonly [string, ConstrainedPosixPatternDialect, string]> = [
    ["😀\\1", "basic", "Invalid regular expression at offset 1: backreferences are not supported."],
    ["a\\|b", "basic", "Invalid regular expression at offset 1: GNU \\| is not supported; use -E."],
    ["a\\+", "basic", "Invalid regular expression at offset 1: GNU \\+ is not supported; use -E."],
    ["a\\?", "basic", "Invalid regular expression at offset 1: GNU \\? is not supported; use -E."],
    ["\\w", "basic", "Invalid regular expression at offset 0: GNU character and word operators are not supported."],
    ["\\p", "extended", "Invalid regular expression at offset 0: unknown escape \\p."],
    ["[[:alpha:]]", "basic", "Invalid regular expression at offset 1: POSIX named character classes are not supported."],
    ["[[.ch.]]", "basic", "Invalid regular expression at offset 1: collating symbols are not supported."],
    ["[[=a=]]", "basic", "Invalid regular expression at offset 1: equivalence classes are not supported."],
    ["[z-a]", "basic", "Invalid regular expression at offset 2: bracket range is in descending Unicode scalar order."],
    ["[abc", "basic", "Invalid regular expression at offset 0: unterminated bracket expression."],
    ["a^", "basic", "Invalid regular expression at offset 1: start anchor is only valid at a complete or group boundary."],
    ["$a", "basic", "Invalid regular expression at offset 0: end anchor is only valid at a complete or group boundary."],
    ["*a", "basic", "Invalid regular expression at offset 0: repetition operator has no preceding expression."],
    ["a**", "basic", "Invalid regular expression at offset 2: possessive, lazy, and repeated quantifiers are not supported."],
    ["a\\{256\\}", "basic", "Invalid regular expression at offset 1: interval bounds cannot exceed 255."],
    ["a{3,2}", "extended", "Invalid regular expression at offset 1: interval lower bound exceeds its upper bound."],
    ["a{", "extended", "Invalid regular expression at offset 1: interval requires a lower bound."],
    ["(?=a)", "extended", "Invalid regular expression at offset 0: lookaround and atomic groups are not supported."],
    ["(?>a)", "extended", "Invalid regular expression at offset 0: lookaround and atomic groups are not supported."],
    ["a*+", "extended", "Invalid regular expression at offset 2: possessive, lazy, and repeated quantifiers are not supported."],
    ["\\(a\\)", "extended", "Invalid regular expression at offset 0: escaped BRE operators are not valid with -E."],
    ["a\nb", "basic", "Invalid regular expression at offset 1: newline is not supported in patterns."],
  ];

  for (const [source, dialect, expected] of cases) {
    assert.equal(invalidMessage(source, dialect), expected, source);
  }
});

test("enforces pattern, program, and interval limits", () => {
  assert.equal(
    invalidMessage("a".repeat(257)),
    "Invalid regular expression at offset 256: pattern exceeds 256 Unicode scalars.",
  );
  assert.equal(
    invalidMessage("(a{255}){255}", "extended"),
    "Invalid regular expression at offset 1: compiled program exceeds 2048 instructions.",
  );
  assert.equal(
    invalidMessage("\ud800"),
    "Invalid regular expression at offset 0: pattern contains an isolated surrogate.",
  );
});

test("honours cancellation before pattern and NFA work", async () => {
  const controller = new AbortController();
  controller.abort();
  assert.deepEqual(
    ConstrainedPosixPattern.compile(
      "a",
      { dialect: "basic", caseSensitivity: "sensitive" },
      controller.signal,
    ),
    { kind: "cancelled" },
  );
  assert.deepEqual(await compile("a").findMatch("a", controller.signal), { kind: "cancelled" });
});

test("yields a host task so queued cancellation interrupts pathological NFA work", async () => {
  const controller = new AbortController();
  const pattern = compile("((a?){255})*b", "extended");
  const input = "a".repeat(20_000);
  setTimeout(() => {
    controller.abort();
  }, 0);

  assert.deepEqual(await pattern.findMatch(input, controller.signal), {
    kind: "cancelled",
  });
});
