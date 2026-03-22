import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "../src/parser.ts";
import type { Command } from "../src/types.ts";

const getCmd = (ast: ReturnType<typeof parse>, i = 0) => ast.commands[i].command as Command;

// ── Basic quoting ────────────────────────────────────────────────────

test("single quotes", () => {
  assert.equal(getCmd(parse("echo 'hello world'")).suffix[0].text, "'hello world'");
});

test("double quotes", () => {
  assert.equal(getCmd(parse('echo "hello world"')).suffix[0].text, '"hello world"');
});

test("escaped chars in double quotes", () => {
  assert.equal(getCmd(parse('echo "hello \\"world\\""')).suffix[0].text, '"hello \\"world\\""');
});

// ── Quoting edge cases ──────────────────────────────────────────────

test("quotes mid-word do not create word boundaries", () => {
  const c = getCmd(parse("ec'h'o hello"));
  assert.equal(c.name?.text, "ec'h'o");
});

test("double quotes mid-word", () => {
  const c = getCmd(parse('ec"h"o hello'));
  assert.equal(c.name?.text, 'ec"h"o');
});

test("adjacent quoted segments form one word", () => {
  const c = getCmd(parse("echo 'foo'\"bar\"baz"));
  assert.equal(c.suffix[0].text, "'foo'\"bar\"baz");
});

test("double-quoted reserved word is not a keyword", () => {
  const ast = parse('"if" true');
  const c = getCmd(ast);
  assert.equal(c.name?.text, '"if"');
  assert.equal(c.suffix[0].text, "true");
});

test("single-quoted reserved word is not a keyword", () => {
  const c = getCmd(parse("'if' true"));
  assert.equal(c.name?.text, "'if'");
});

test("partially quoted reserved word is not a keyword", () => {
  const c = getCmd(parse('i"f" true'));
  assert.equal(c.name?.text, 'i"f"');
});

test("backslash-escaped reserved word is not a keyword", () => {
  const c = getCmd(parse("\\if true"));
  assert.equal(c.name?.text, "\\if");
});

test("single quote inside double quotes is literal", () => {
  const c = getCmd(parse(`echo "TEST1 'TEST2"`));
  assert.equal(c.suffix[0].text, '"TEST1 \'TEST2"');
});

test("double quote inside single quotes is literal", () => {
  const c = getCmd(parse("echo 'TEST1 \"TEST2'"));
  assert.equal(c.suffix[0].text, "'TEST1 \"TEST2'");
});

test("escaped quotes in unquoted context", () => {
  const c = getCmd(parse("ec\\'\\\"ho"));
  assert.equal(c.name?.text, "ec\\'\\\"ho");
});

test("escaped backslash before closing double quote", () => {
  const c = getCmd(parse('echo "foo\\\\"'));
  assert.equal(c.suffix[0].text, '"foo\\\\"');
});

test("backslash in double quotes only escapes special chars", () => {
  const c = getCmd(parse('echo "foo\\a"'));
  assert.equal(c.suffix[0].text, '"foo\\a"');
});

test("escaped dollar prevents expansion in double quotes", () => {
  const c = getCmd(parse('echo "\\$ciao"'));
  assert.equal(c.suffix[0].text, '"\\$ciao"');
});

test("partially quoted words join without boundary", () => {
  const c = getCmd(parse("echo TEST1' TEST2 'TEST3"));
  assert.equal(c.suffix[0].text, "TEST1' TEST2 'TEST3");
});

// ── $'...' ANSI-C quoting ───────────────────────────────────────────

test("$'\\n' produces newline", () => {
  const c = getCmd(parse("echo $'hello\\nworld'"));
  assert.equal(c.suffix[0].text, "$'hello\\nworld'");
});

test("$'\\t' produces tab", () => {
  const c = getCmd(parse("echo $'a\\tb'"));
  assert.equal(c.suffix[0].text, "$'a\\tb'");
});

test("$'\\'' produces single quote", () => {
  const c = getCmd(parse("echo $'it\\'s'"));
  assert.equal(c.suffix[0].text, "$'it\\'s'");
});

test("$'\\\\' produces backslash", () => {
  const c = getCmd(parse("echo $'\\\\'"));
  assert.equal(c.suffix[0].text, "$'\\\\'");
});

test("$'\\e' produces escape character", () => {
  const c = getCmd(parse("echo $'\\e[31m'"));
  assert.equal(c.suffix[0].text, "$'\\e[31m'");
});

test("$'...' adjacent to unquoted text", () => {
  const c = getCmd(parse("echo foo$'\\n'bar"));
  assert.equal(c.suffix[0].text, "foo$'\\n'bar");
});

// ── Word.value (dequoted) ───────────────────────────────────────────

test("value strips double quotes", () => {
  assert.equal(getCmd(parse('echo "hello world"')).suffix[0].value, "hello world");
});

test("value strips single quotes", () => {
  assert.equal(getCmd(parse("echo 'hello world'")).suffix[0].value, "hello world");
});

test("value on unquoted word equals text", () => {
  assert.equal(getCmd(parse("echo hello")).suffix[0].value, "hello");
});

test("value joins adjacent quoted segments", () => {
  assert.equal(getCmd(parse("echo 'foo'\"bar\"baz")).suffix[0].value, "foobarbaz");
});

test("value interprets ansi-c escapes", () => {
  assert.equal(getCmd(parse("echo $'hello\\nworld'")).suffix[0].value, "hello\nworld");
});

test("value preserves expansion text", () => {
  assert.equal(getCmd(parse('echo "$HOME/bin"')).suffix[0].value, "$HOME/bin");
});

test("value on command name with quotes", () => {
  assert.equal(getCmd(parse('"if" true')).name?.value, "if");
});

// ── Line continuation ───────────────────────────────────────────────

test("backslash-newline mid-word joins lines", () => {
  const c = getCmd(parse("ech\\\no hello"));
  assert.equal(c.name?.text, "ech\\\no");
});

test("backslash-newline between tokens", () => {
  const ast = parse("echo \\\nhello");
  const c = getCmd(ast);
  assert.equal(c.name?.text, "echo");
  assert.equal(c.suffix[0].text, "hello");
});

test("multiple line continuations in one word", () => {
  const c = getCmd(parse("fo\\\no\\\nba\\\nr"));
  assert.equal(c.name?.text, "fo\\\no\\\nba\\\nr");
});

test("line continuation mid-keyword", () => {
  const ast = parse("wh\\\nile true; do echo yes; done");
  assert.equal(ast.commands[0].command.type, "While");
});

test("leading line continuations are skipped", () => {
  const ast = parse("\\\n\\\n\\\necho world");
  assert.equal(getCmd(ast).name?.text, "echo");
});

test("line continuation in whitespace between tokens", () => {
  const ast = parse("echo; \\\nls");
  assert.equal(ast.commands.length, 2);
});

// ── Single-quoted strings are fully literal ───────────────────────────
// Everything inside single quotes is literal, including backticks, $(),
// ${}, $var, etc. No expansions of any kind occur.

test("backticks inside single quotes are literal (not command substitution)", () => {
  const ast = parse("echo '`cmd`'");
  const word = getCmd(ast).suffix[0];
  assert.equal(word.parts?.length, 1, "should have exactly one part");
  assert.equal(word.parts?.[0]?.type, "SingleQuoted", "should be SingleQuoted part");
  assert.equal(word.parts?.[0]?.value, "`cmd`", "backticks should be literal in value");
});

test("$() inside single quotes is literal (not command substitution)", () => {
  const ast = parse("echo '$(cmd)'");
  const word = getCmd(ast).suffix[0];
  assert.equal(word.parts?.length, 1, "should have exactly one part");
  assert.equal(word.parts?.[0]?.type, "SingleQuoted", "should be SingleQuoted part");
  assert.equal(word.parts?.[0]?.value, "$(cmd)", "$() should be literal in value");
});

test("${} inside single quotes is literal (not parameter expansion)", () => {
  const ast = parse("echo '${var}'");
  const word = getCmd(ast).suffix[0];
  assert.equal(word.parts?.length, 1, "should have exactly one part");
  assert.equal(word.parts?.[0]?.type, "SingleQuoted", "should be SingleQuoted part");
  assert.equal(word.parts?.[0]?.value, "${var}", "${} should be literal in value");
});

test("multiline single-quoted string with backticks is one SingleQuoted part", () => {
  const ast = parse(`echo '
const x = \`hello\`;
console.log(x);
'`);
  const word = getCmd(ast).suffix[0];
  assert.equal(word.parts?.length, 1, "should have exactly one part");
  assert.equal(word.parts?.[0]?.type, "SingleQuoted", "should be SingleQuoted part");
  // The value should contain the backticks literally
  assert.ok(word.parts?.[0]?.value?.includes("`hello`"), "value should contain literal backticks");
});

test("multiline single-quoted string with $() is one SingleQuoted part", () => {
  const ast = parse(`echo '
const src = "for (( i = $(start); i < $(limit); i++ )); do echo $i; done";
'`);
  const word = getCmd(ast).suffix[0];
  assert.equal(word.parts?.length, 1, "should have exactly one part");
  assert.equal(word.parts?.[0]?.type, "SingleQuoted", "should be SingleQuoted part");
  // The value should contain $() literally
  assert.ok(word.parts?.[0]?.value?.includes("$(start)"), "value should contain literal $(start)");
  assert.ok(word.parts?.[0]?.value?.includes("$(limit)"), "value should contain literal $(limit)");
});
