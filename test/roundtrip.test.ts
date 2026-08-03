import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "../src/parser.ts";
import { verify } from "./verify.ts";

const roundtrip = (src: string) => verify(src, parse(src));

// --- Basic commands ---

test("simple command", () => {
  const src = "echo hello world";
  assert.equal(roundtrip(src), src);
});

test("command with quotes", () => {
  const src = `echo "hello world" 'foo bar'`;
  assert.equal(roundtrip(src), src);
});

test("command with expansions", () => {
  const src = `echo $HOME "\${PATH}" $(date)`;
  assert.equal(roundtrip(src), src);
});

test("assignments", () => {
  const src = "FOO=bar BAZ=qux cmd arg1 arg2";
  assert.equal(roundtrip(src), src);
});

// --- Pipes and logical ---

test("pipeline", () => {
  const src = "echo hello | grep h | wc -l";
  assert.equal(roundtrip(src), src);
});

test("and-or", () => {
  const src = "true && echo yes || echo no";
  assert.equal(roundtrip(src), src);
});

test("negated pipeline", () => {
  const src = "! cmd | grep err";
  assert.equal(roundtrip(src), src);
});

// --- Compound commands ---

test("if/then/fi", () => {
  const src = "if true; then echo yes; fi";
  assert.equal(roundtrip(src), src);
});

test("if/elif/else/fi", () => {
  const src = "if a; then b; elif c; then d; else e; fi";
  assert.equal(roundtrip(src), src);
});

test("if/elif with trailing redirect", () => {
  const src = "if a; then b; elif c; then d; fi >out";
  assert.equal(roundtrip(src), src);
});

test("for loop", () => {
  const src = "for x in a b c; do echo $x; done";
  assert.equal(roundtrip(src), src);
});

test("arithmetic for", () => {
  const src = "for (( i = 0; i < 10; i++ )); do echo $i; done";
  assert.equal(roundtrip(src), src);
});

test("while loop", () => {
  const src = "while read line; do echo $line; done";
  assert.equal(roundtrip(src), src);
});

test("until loop", () => {
  const src = "until false; do echo loop; done";
  assert.equal(roundtrip(src), src);
});

test("case statement", () => {
  const src = "case $x in a) echo a;; b|c) echo bc;; *) echo other;; esac";
  assert.equal(roundtrip(src), src);
});

test("select", () => {
  const src = "select x in a b c; do echo $x; done";
  assert.equal(roundtrip(src), src);
});

test("subshell", () => {
  const src = "(echo hello; echo world)";
  assert.equal(roundtrip(src), src);
});

test("brace group", () => {
  const src = "{ echo hello; echo world; }";
  assert.equal(roundtrip(src), src);
});

// --- Functions ---

test("function keyword", () => {
  const src = "function greet { echo hi; }";
  assert.equal(roundtrip(src), src);
});

test("function parens", () => {
  const src = "greet() { echo hi; }";
  assert.equal(roundtrip(src), src);
});

// --- Test and arithmetic ---

test("test command", () => {
  const src = "[[ -f $file && $x == hello ]]";
  assert.equal(roundtrip(src), src);
});

test("arithmetic command", () => {
  const src = "(( x + y * 2 ))";
  assert.equal(roundtrip(src), src);
});

// --- Redirects ---

test("redirects", () => {
  const src = "echo hello > /tmp/out 2>&1";
  assert.equal(roundtrip(src), src);
});

test("heredoc", () => {
  const src = "cat <<EOF\nhello world\nEOF\n";
  assert.equal(roundtrip(src), src);
});

// --- Multi-statement ---

test("semicolon-separated", () => {
  const src = "echo a; echo b; echo c";
  assert.equal(roundtrip(src), src);
});

test("newline-separated", () => {
  const src = "echo a\necho b\necho c\n";
  assert.equal(roundtrip(src), src);
});

test("background", () => {
  const src = "sleep 5 &";
  assert.equal(roundtrip(src), src);
});

// --- Fixture round-trip ---

const fixtureDir = join(import.meta.dirname, "../fixtures/large");
let fixtures: { name: string; src: string }[] = [];
try {
  fixtures = readdirSync(fixtureDir)
    .filter((f) => f.endsWith(".sh") || f.endsWith(".bash"))
    .sort()
    .map((f) => ({ name: f, src: readFileSync(join(fixtureDir, f), "utf8") }));
} catch {}

for (const { name, src } of fixtures) {
  test(`fixture round-trip: ${name}`, () => {
    const result = roundtrip(src);
    if (result !== src) {
      // Find first mismatch for useful error
      for (let i = 0; i < Math.max(result.length, src.length); i++) {
        if (result[i] !== src[i]) {
          const ctx = 40;
          const srcSnip = src.slice(Math.max(0, i - ctx), i + ctx);
          const resSnip = result.slice(Math.max(0, i - ctx), i + ctx);
          assert.fail(
            `Mismatch at pos ${i} (line ${src.slice(0, i).split("\n").length}):\n` +
              `  src: ...${JSON.stringify(srcSnip)}...\n` +
              `  got: ...${JSON.stringify(resSnip)}...`,
          );
        }
      }
      assert.fail(`Length mismatch: src=${src.length} got=${result.length}`);
    }
  });
}
