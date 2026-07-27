import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "../src/parser.ts";

// ── Error recovery ──────────────────────────────────────────────────

test("unclosed single quote doesn't throw", () => {
  const ast = parse("echo 'unterminated");
  assert.equal(ast.type, "Script");
});

test("unclosed double quote doesn't throw", () => {
  const ast = parse('echo "unterminated');
  assert.equal(ast.type, "Script");
});

test("unmatched parentheses don't throw", () => {
  const ast = parse("(echo hello");
  assert.equal(ast.type, "Script");
});

test("truncated if (missing fi) doesn't throw", () => {
  const ast = parse("if true; then echo yes");
  assert.equal(ast.type, "Script");
});

test("truncated for (missing done) doesn't throw", () => {
  const ast = parse("for x in a b; do echo $x");
  assert.equal(ast.type, "Script");
});

test("truncated while (missing done) doesn't throw", () => {
  const ast = parse("while true; do echo loop");
  assert.equal(ast.type, "Script");
});

// ── Error collection ────────────────────────────────────────────────

test("missing fi collects error", () => {
  const ast = parse("if true; then echo yes");
  assert.ok(ast.errors);
  assert.ok(ast.errors.some((e) => e.message.includes("expected 'fi'")));
});

test("missing done collects error", () => {
  const ast = parse("for x in a b; do echo $x");
  assert.ok(ast.errors);
  assert.ok(ast.errors.some((e) => e.message.includes("expected 'done'")));
});

test("missing ) collects error", () => {
  const ast = parse("(echo hello");
  assert.ok(ast.errors);
  assert.ok(ast.errors.some((e) => e.message.includes("expected ')'")));
});

test("unclosed single quote collects error", () => {
  const ast = parse("echo 'unterminated");
  assert.ok(ast.errors);
  assert.ok(ast.errors.some((e) => e.message.includes("unterminated single quote")));
});

test("unclosed double quote collects error", () => {
  const ast = parse('echo "unterminated');
  assert.ok(ast.errors);
  assert.ok(ast.errors.some((e) => e.message.includes("unterminated double quote")));
});

test("valid input has no errors", () => {
  const ast = parse("echo hello world");
  assert.equal(ast.errors, undefined);
});

test("valid compound commands have no errors", () => {
  const ast = parse("if true; then echo yes; fi");
  assert.equal(ast.errors, undefined);
});

test("multiple errors collected", () => {
  const ast = parse("if true; then (echo hello");
  assert.ok(ast.errors);
  assert.ok(ast.errors.length >= 2, `expected >= 2 errors, got ${ast.errors.length}`);
});

test("error positions are reasonable", () => {
  const input = "for x in a b; do echo $x";
  const ast = parse(input);
  assert.ok(ast.errors);
  for (const err of ast.errors) {
    assert.ok(err.pos >= 0, `pos ${err.pos} should be >= 0`);
    assert.ok(err.pos <= input.length, `pos ${err.pos} should be <= input length ${input.length}`);
  }
});

// ── Edge-case inputs ─────────────────────────────────────────────────

test("empty input returns empty Script", () => {
  const ast = parse("");
  assert.equal(ast.type, "Script");
  assert.equal(ast.commands.length, 0);
});

test("whitespace-only returns empty Script", () => {
  const ast = parse("   \n\n  \t  ");
  assert.equal(ast.type, "Script");
  assert.equal(ast.commands.length, 0);
});

test("comment-only returns empty Script", () => {
  const ast = parse("# just a comment\n# another");
  assert.equal(ast.type, "Script");
  assert.equal(ast.commands.length, 0);
});

test("unclosed command substitution collects error", () => {
  const ast = parse("curl $(foo");
  assert.ok(ast.errors);
  assert.ok(ast.errors.some((e) => e.message.includes("unterminated command substitution")));
});

test("unclosed command substitution inside double quotes collects error", () => {
  const ast = parse('echo "$(foo"');
  assert.ok(ast.errors);
  assert.ok(ast.errors.some((e) => e.message.includes("unterminated command substitution")));
});

test("unclosed process substitution collects error", () => {
  const ast = parse("diff <(foo");
  assert.ok(ast.errors);
  assert.ok(ast.errors.some((e) => e.message.includes("unterminated process substitution")));
});

test("unclosed command substitution keeps the inner command name intact", () => {
  const ast = parse("curl $(foo");
  const word = ast.commands[0].command.suffix[0];
  const part = word.parts.find((p) => p.type === "CommandExpansion");
  assert.equal(part.script.commands[0].command.name.text, "foo");
});
