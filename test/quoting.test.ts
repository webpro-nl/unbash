import { nodeOfType } from "./ast-helpers.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "../src/parser.ts";

const getCmd = (ast: ReturnType<typeof parse>, i = 0) => nodeOfType(ast.commands[i].command, "Command");

// ── Basic quoting ────────────────────────────────────────────────────

test("single quotes", () => {
  assert.equal(nodeOfType(getCmd(parse("echo 'hello world'")).suffix[0], "Word").text, "'hello world'");
});

test("double quotes", () => {
  assert.equal(nodeOfType(getCmd(parse('echo "hello world"')).suffix[0], "Word").text, '"hello world"');
});

test("escaped chars in double quotes", () => {
  assert.equal(nodeOfType(getCmd(parse('echo "hello \\"world\\""')).suffix[0], "Word").text, '"hello \\"world\\""');
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
  assert.equal(nodeOfType(c.suffix[0], "Word").text, "'foo'\"bar\"baz");
});

test("double-quoted reserved word is not a keyword", () => {
  const ast = parse('"if" true');
  const c = getCmd(ast);
  assert.equal(c.name?.text, '"if"');
  assert.equal(nodeOfType(c.suffix[0], "Word").text, "true");
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

test("dollar-quoted reserved words are not keywords", () => {
  for (const source of ["$'if' true", '$"if" true', "i$''f true"]) {
    const ast = parse(source);
    const c = getCmd(ast);

    assert.equal(c.name?.value, "if", source);
    assert.equal(nodeOfType(c.suffix[0], "Word").value, "true", source);
    assert.equal(ast.errors, undefined, source);
  }
});

test("single quote inside double quotes is literal", () => {
  const c = getCmd(parse(`echo "TEST1 'TEST2"`));
  assert.equal(nodeOfType(c.suffix[0], "Word").text, '"TEST1 \'TEST2"');
});

// Inside double quotes neither ANSI-C quoting nor locale strings are recognized, so `$'`
// and `$"` are a literal dollar followed by the quote character.
test("dollar-quote inside double quotes is literal", () => {
  for (const [source, value] of [
    [`echo "a$'b"`, "a$'b"],
    [`echo "x$'y'z"`, "x$'y'z"],
    [`echo "$'"`, "$'"],
    [`echo "grep -E '^(a|b)$' || true"`, "grep -E '^(a|b)$' || true"],
  ]) {
    const ast = parse(source);
    assert.equal(ast.errors, undefined, source);
    assert.equal(nodeOfType(getCmd(ast).suffix[0], "Word").value, value, source);
  }
});

test("ANSI-C quoting still decodes outside double quotes", () => {
  const ast = parse("echo $'a\\tb'");
  assert.equal(ast.errors, undefined);
  assert.equal(nodeOfType(getCmd(ast).suffix[0], "Word").value, "a\tb");
});

test("double quote inside single quotes is literal", () => {
  const c = getCmd(parse("echo 'TEST1 \"TEST2'"));
  assert.equal(nodeOfType(c.suffix[0], "Word").text, "'TEST1 \"TEST2'");
});

test("escaped quotes in unquoted context", () => {
  const c = getCmd(parse("ec\\'\\\"ho"));
  assert.equal(c.name?.text, "ec\\'\\\"ho");
});

test("escaped backslash before closing double quote", () => {
  const c = getCmd(parse('echo "foo\\\\"'));
  assert.equal(nodeOfType(c.suffix[0], "Word").text, '"foo\\\\"');
});

test("backslash in double quotes only escapes special chars", () => {
  const c = getCmd(parse('echo "foo\\a"'));
  assert.equal(nodeOfType(c.suffix[0], "Word").text, '"foo\\a"');
});

test("escaped dollar prevents expansion in double quotes", () => {
  const c = getCmd(parse('echo "\\$ciao"'));
  assert.equal(nodeOfType(c.suffix[0], "Word").text, '"\\$ciao"');
});

test("partially quoted words join without boundary", () => {
  const c = getCmd(parse("echo TEST1' TEST2 'TEST3"));
  assert.equal(nodeOfType(c.suffix[0], "Word").text, "TEST1' TEST2 'TEST3");
});

test("empty quotes and close-escape-reopen preserve one word", () => {
  const source = String.raw`echo '\' '\' 'a'\''b' '' "" ''a''`;
  const words = getCmd(parse(source)).suffix;

  assert.deepEqual(
    words.map((word) => nodeOfType(word, "Assignment", "Word").value),
    ["\\", "\\", "a'b", "", "", "a"],
  );
  assert.deepEqual(
    words.map((word) => nodeOfType(word, "Assignment", "Word").text),
    ["'\\'", "'\\'", String.raw`'a'\''b'`, "''", '""', "''a''"],
  );
  assert.deepEqual(
    nodeOfType(words[2], "Word").parts?.map((part) => part.type),
    ["SingleQuoted", "Literal", "SingleQuoted"],
  );
});

test("backslashes do not escape quotes inside single quotes (#234)", () => {
  const invalid = parse(String.raw`'sed -E \'s///\''`);
  assert.deepEqual(invalid.errors, [{ message: "unterminated single quote", pos: 16 }]);

  const valid = parse(String.raw`'sed -E '\''s///'\'`);
  const word = getCmd(valid).name!;
  assert.equal(valid.errors, undefined);
  assert.equal(word.value, "sed -E 's///'");
  assert.deepEqual(word.parts, [
    { type: "SingleQuoted", pos: 0, end: 9, value: "sed -E ", text: "'sed -E '" },
    { type: "Literal", pos: 9, end: 11, value: "'", text: "\\'" },
    { type: "SingleQuoted", pos: 11, end: 17, value: "s///", text: "'s///'" },
    { type: "Literal", pos: 17, end: 19, value: "'", text: "\\'" },
  ]);
});

test("locale strings remain structured when concatenated (#258)", () => {
  const ast = parse('foo$"bar"');
  const word = getCmd(ast).name!;
  assert.equal(ast.errors, undefined);
  assert.deepEqual([word.text, word.value, word.pos, word.end], ['foo$"bar"', "foobar", 0, 9]);
  assert.deepEqual(word.parts, [
    { type: "Literal", pos: 0, end: 3, value: "foo", text: "foo" },
    {
      type: "LocaleString",
      pos: 3,
      end: 9,
      text: '$"bar"',
      parts: [{ type: "Literal", pos: 5, end: 8, value: "bar", text: "bar" }],
    },
  ]);
});

test("unquoted escapes suppress parameter and backtick expansion", () => {
  const words = getCmd(parse("echo ab\\${x}def bo\\`op")).suffix;

  assert.deepEqual(
    words.map((word) => nodeOfType(word, "Assignment", "Word").value),
    ["ab${x}def", "bo`op"],
  );
  assert.equal(nodeOfType(words[0], "Word").parts, undefined);
  assert.equal(nodeOfType(words[1], "Word").parts, undefined);
});

test("dollar before a closing double quote is literal", () => {
  const ast = parse('grep "xy$"');
  const word = nodeOfType(getCmd(ast).suffix[0], "Word");

  assert.equal(word.text, '"xy$"');
  assert.equal(word.value, "xy$");
  assert.deepEqual(word.parts, [
    {
      type: "DoubleQuoted",
      pos: 5,
      end: 10,
      text: '"xy$"',
      parts: [{ type: "Literal", pos: 6, end: 9, value: "xy$", text: "xy$" }],
    },
  ]);
  assert.equal(ast.errors, undefined);
});

// ── $'...' ANSI-C quoting ───────────────────────────────────────────

test("$'\\n' produces newline", () => {
  const c = getCmd(parse("echo $'hello\\nworld'"));
  assert.equal(nodeOfType(c.suffix[0], "Word").text, "$'hello\\nworld'");
});

test("$'\\t' produces tab", () => {
  const c = getCmd(parse("echo $'a\\tb'"));
  assert.equal(nodeOfType(c.suffix[0], "Word").text, "$'a\\tb'");
});

test("$'\\'' produces single quote", () => {
  const c = getCmd(parse("echo $'it\\'s'"));
  assert.equal(nodeOfType(c.suffix[0], "Word").text, "$'it\\'s'");
});

test("$'\\\\' produces backslash", () => {
  const c = getCmd(parse("echo $'\\\\'"));
  assert.equal(nodeOfType(c.suffix[0], "Word").text, "$'\\\\'");
});

test("$'\\e' produces escape character", () => {
  const c = getCmd(parse("echo $'\\e[31m'"));
  assert.equal(nodeOfType(c.suffix[0], "Word").text, "$'\\e[31m'");
});

test("$'...' adjacent to unquoted text", () => {
  const c = getCmd(parse("echo foo$'\\n'bar"));
  assert.equal(nodeOfType(c.suffix[0], "Word").text, "foo$'\\n'bar");
});

// ── Word.value (dequoted) ───────────────────────────────────────────

test("value strips double quotes", () => {
  assert.equal(nodeOfType(getCmd(parse('echo "hello world"')).suffix[0], "Word").value, "hello world");
});

test("value strips single quotes", () => {
  assert.equal(nodeOfType(getCmd(parse("echo 'hello world'")).suffix[0], "Word").value, "hello world");
});

test("value on unquoted word equals text", () => {
  assert.equal(nodeOfType(getCmd(parse("echo hello")).suffix[0], "Word").value, "hello");
});

test("value strips unquoted backslash escapes", () => {
  assert.equal(nodeOfType(getCmd(parse(String.raw`echo hello\ world`)).suffix[0], "Word").value, "hello world");
  assert.equal(
    getCmd(parse(String.raw`/Applications/Visual\ Studio\ Code.app --wait`)).name?.value,
    "/Applications/Visual Studio Code.app",
  );
});

test("value joins adjacent quoted segments", () => {
  assert.equal(nodeOfType(getCmd(parse("echo 'foo'\"bar\"baz")).suffix[0], "Word").value, "foobarbaz");
});

test("value interprets ansi-c escapes", () => {
  assert.equal(nodeOfType(getCmd(parse("echo $'hello\\nworld'")).suffix[0], "Word").value, "hello\nworld");
});

test("value preserves expansion text", () => {
  assert.equal(nodeOfType(getCmd(parse('echo "$HOME/bin"')).suffix[0], "Word").value, "$HOME/bin");
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
  assert.equal(nodeOfType(c.suffix[0], "Word").text, "hello");
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
  const word = nodeOfType(getCmd(ast).suffix[0], "Word");
  assert.equal(word.parts?.length, 1, "should have exactly one part");
  assert.equal(word.parts?.[0]?.type, "SingleQuoted", "should be SingleQuoted part");
  assert.equal(word.parts?.[0]?.value, "`cmd`", "backticks should be literal in value");
});

test("$() inside single quotes is literal (not command substitution)", () => {
  const ast = parse("echo '$(cmd)'");
  const word = nodeOfType(getCmd(ast).suffix[0], "Word");
  assert.equal(word.parts?.length, 1, "should have exactly one part");
  assert.equal(word.parts?.[0]?.type, "SingleQuoted", "should be SingleQuoted part");
  assert.equal(word.parts?.[0]?.value, "$(cmd)", "$() should be literal in value");
});

test("${} inside single quotes is literal (not parameter expansion)", () => {
  const ast = parse("echo '${var}'");
  const word = nodeOfType(getCmd(ast).suffix[0], "Word");
  assert.equal(word.parts?.length, 1, "should have exactly one part");
  assert.equal(word.parts?.[0]?.type, "SingleQuoted", "should be SingleQuoted part");
  assert.equal(word.parts?.[0]?.value, "${var}", "${} should be literal in value");
});

test("multiline single-quoted string with backticks is one SingleQuoted part", () => {
  const ast = parse(`echo '
const x = \`hello\`;
console.log(x);
'`);
  const word = nodeOfType(getCmd(ast).suffix[0], "Word");
  assert.equal(word.parts?.length, 1, "should have exactly one part");
  assert.equal(word.parts?.[0]?.type, "SingleQuoted", "should be SingleQuoted part");
  // The value should contain the backticks literally
  assert.ok(word.parts?.[0]?.value?.includes("`hello`"), "value should contain literal backticks");
});

test("multiline single-quoted string with $() is one SingleQuoted part", () => {
  const ast = parse(`echo '
const src = "for (( i = $(start); i < $(limit); i++ )); do echo $i; done";
'`);
  const word = nodeOfType(getCmd(ast).suffix[0], "Word");
  assert.equal(word.parts?.length, 1, "should have exactly one part");
  assert.equal(word.parts?.[0]?.type, "SingleQuoted", "should be SingleQuoted part");
  // The value should contain $() literally
  assert.ok(word.parts?.[0]?.value?.includes("$(start)"), "value should contain literal $(start)");
  assert.ok(word.parts?.[0]?.value?.includes("$(limit)"), "value should contain literal $(limit)");
});
