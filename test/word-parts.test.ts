import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "../src/parser.ts";
import type { Command } from "../src/types.ts";
import { computeWordParts } from "../src/parts.ts";

const getCmd = (ast: ReturnType<typeof parse>, i = 0) => ast.commands[i].command as Command;
const p = (s: string, w: import("../src/types.ts").Word) => computeWordParts(s, w);

test("simple word has no parts", () => {
  const src = "echo hello";
  const c = getCmd(parse(src));
  assert.equal(p(src, c.name!), undefined);
  assert.equal(p(src, c.suffix[0]), undefined);
});

test("double-quoted literal", () => {
  const src = 'echo "hello world"';
  const c = getCmd(parse(src));
  assert.deepEqual(p(src, c.suffix[0]), [
    {
      type: "DoubleQuoted",
      text: '"hello world"',
      parts: [{ type: "Literal", value: "hello world", text: "hello world" }],
    },
  ]);
});

test("double-quoted with variable", () => {
  const src = 'echo "hello $name world"';
  const c = getCmd(parse(src));
  assert.deepEqual(p(src, c.suffix[0]), [
    {
      type: "DoubleQuoted",
      text: '"hello $name world"',
      parts: [
        { type: "Literal", value: "hello ", text: "hello " },
        { type: "SimpleExpansion", text: "$name" },
        { type: "Literal", value: " world", text: " world" },
      ],
    },
  ]);
});

test("unquoted variable", () => {
  const src = "echo $name";
  const c = getCmd(parse(src));
  assert.deepEqual(p(src, c.suffix[0]), [{ type: "SimpleExpansion", text: "$name" }]);
});

test("special variables", () => {
  const src = "echo $@ $# $?";
  const c = getCmd(parse(src));
  assert.deepEqual(p(src, c.suffix[0]), [{ type: "SimpleExpansion", text: "$@" }]);
  assert.deepEqual(p(src, c.suffix[1]), [{ type: "SimpleExpansion", text: "$#" }]);
  assert.deepEqual(p(src, c.suffix[2]), [{ type: "SimpleExpansion", text: "$?" }]);
});

test("positional parameter", () => {
  const src = "echo $1";
  const c = getCmd(parse(src));
  assert.deepEqual(p(src, c.suffix[0]), [{ type: "SimpleExpansion", text: "$1" }]);
});

test("parameter expansion ${...}", () => {
  const src = "echo ${var:-default}";
  const c = getCmd(parse(src));
  const parts = p(src, c.suffix[0])!;
  assert.equal(parts.length, 1);
  assert.equal(parts[0].type, "ParameterExpansion");
  assert.equal((parts[0] as any).text, "${var:-default}");
  assert.equal((parts[0] as any).parameter, "var");
  assert.equal((parts[0] as any).operator, ":-");
  assert.equal((parts[0] as any).operand.text, "default");
});

test("command substitution $()", () => {
  const src = "echo $(hostname)";
  const c = getCmd(parse(src));
  const parts = p(src, c.suffix[0])!;
  assert.equal(parts.length, 1);
  assert.equal(parts[0].type, "CommandExpansion");
  assert.equal((parts[0] as any).text, "$(hostname)");
  assert.ok((parts[0] as any).script);
});

test("backtick command substitution", () => {
  const src = "echo `hostname`";
  const c = getCmd(parse(src));
  const parts = p(src, c.suffix[0])!;
  assert.equal(parts.length, 1);
  assert.equal(parts[0].type, "CommandExpansion");
  assert.ok((parts[0] as any).script);
});

test("arithmetic expansion", () => {
  const src = "echo $((1+2))";
  const c = getCmd(parse(src));
  const parts = p(src, c.suffix[0])!;
  assert.equal(parts.length, 1);
  assert.equal(parts[0].type, "ArithmeticExpansion");
  assert.equal((parts[0] as any).text, "$((1+2))");
  assert.ok((parts[0] as any).expression);
});

test("single-quoted string", () => {
  const src = "echo 'hello world'";
  const c = getCmd(parse(src));
  assert.deepEqual(p(src, c.suffix[0]), [{ type: "SingleQuoted", value: "hello world", text: "'hello world'" }]);
});

test("ANSI-C quoted string", () => {
  const src = "echo $'line1\\nline2'";
  const c = getCmd(parse(src));
  const parts = p(src, c.suffix[0])!;
  assert.equal(parts.length, 1);
  assert.equal(parts[0].type, "AnsiCQuoted");
  assert.equal((parts[0] as any).text, "$'line1\\nline2'");
});

test("mixed quoting: un'quo'ted\"mix\"$end", () => {
  const src = "echo un'quo'ted\"mix\"$end";
  const c = getCmd(parse(src));
  const parts = p(src, c.suffix[0])!;
  assert.equal(parts[0].type, "Literal");
  assert.equal((parts[0] as any).value, "un");
  assert.equal((parts[0] as any).text, "un");
  assert.equal(parts[1].type, "SingleQuoted");
  assert.equal((parts[1] as any).value, "quo");
  assert.equal((parts[1] as any).text, "'quo'");
  assert.equal(parts[2].type, "Literal");
  assert.equal((parts[2] as any).value, "ted");
  assert.equal((parts[2] as any).text, "ted");
  assert.equal(parts[3].type, "DoubleQuoted");
  assert.equal((parts[3] as any).text, '"mix"');
  assert.equal(parts[4].type, "SimpleExpansion");
  assert.equal((parts[4] as any).text, "$end");
});

test("variable concatenated with literal", () => {
  const src = "echo prefix-$name-suffix";
  const c = getCmd(parse(src));
  const parts = p(src, c.suffix[0])!;
  assert.equal(parts[0].type, "Literal");
  assert.equal((parts[0] as any).value, "prefix-");
  assert.equal((parts[0] as any).text, "prefix-");
  assert.equal(parts[1].type, "SimpleExpansion");
  assert.equal((parts[1] as any).text, "$name");
  assert.equal(parts[2].type, "Literal");
  assert.equal((parts[2] as any).value, "-suffix");
  assert.equal((parts[2] as any).text, "-suffix");
});

test("double-quoted with command substitution", () => {
  const src = 'echo "hello $(whoami)"';
  const c = getCmd(parse(src));
  const parts = p(src, c.suffix[0])!;
  assert.equal(parts.length, 1);
  assert.equal(parts[0].type, "DoubleQuoted");
  assert.equal((parts[0] as any).text, '"hello $(whoami)"');
  const inner = (parts[0] as any).parts;
  assert.equal(inner.length, 2);
  assert.equal(inner[0].type, "Literal");
  assert.equal(inner[0].value, "hello ");
  assert.equal(inner[0].text, "hello ");
  assert.equal(inner[1].type, "CommandExpansion");
});

test("double-quoted with param expansion", () => {
  const src = 'echo "${var:-default}"';
  const c = getCmd(parse(src));
  const parts = p(src, c.suffix[0])!;
  assert.equal(parts[0].type, "DoubleQuoted");
  const inner = (parts[0] as any).parts;
  assert.equal(inner.length, 1);
  assert.equal(inner[0].type, "ParameterExpansion");
  assert.equal(inner[0].text, "${var:-default}");
});

test("double-quoted with arithmetic", () => {
  const src = 'echo "$((1 + 2))"';
  const c = getCmd(parse(src));
  const parts = p(src, c.suffix[0])!;
  assert.equal(parts[0].type, "DoubleQuoted");
  const inner = (parts[0] as any).parts;
  assert.equal(inner[0].type, "ArithmeticExpansion");
});

test("escaped characters in unquoted word", () => {
  // backslash-escaped char enters slow path but is literal
  const c = getCmd(parse("echo hello\\ world"));
  assert.equal(c.suffix[0].text, "hello\\ world");
  // single literal — parts should be null (no structure)
  assert.equal(computeWordParts("echo hello\\ world", c.suffix[0]), undefined);
});

test('locale string $"..."', () => {
  const src = 'echo $"hello $name"';
  const c = getCmd(parse(src));
  const parts = p(src, c.suffix[0])!;
  assert.equal(parts[0].type, "LocaleString");
  assert.equal((parts[0] as any).text, '$"hello $name"');
  const inner = (parts[0] as any).parts;
  assert.equal(inner[0].type, "Literal");
  assert.equal(inner[0].value, "hello ");
  assert.equal(inner[0].text, "hello ");
  assert.equal(inner[1].type, "SimpleExpansion");
});

test("assignment word gets parts", () => {
  const c = getCmd(parse('x="hello $name"'));
  const prefix = c.prefix[0];
  assert.equal(prefix.type, "Assignment");
});

test("text field unchanged with parts", () => {
  const src = 'echo "hello $name world"';
  const c = getCmd(parse(src));
  assert.equal(c.suffix[0].text, '"hello $name world"');
  assert.ok(p(src, c.suffix[0]));
});

test("LiteralPart.text includes backslash escapes", () => {
  const src = "echo he\\nllo-$x";
  const c = getCmd(parse(src));
  const parts = p(src, c.suffix[0])!;
  assert.equal(parts[0].type, "Literal");
  assert.equal((parts[0] as any).value, "henllo-");
  assert.equal((parts[0] as any).text, "he\\nllo-");
});

test("locale string without expansions", () => {
  const src = 'echo $"hello"';
  const c = getCmd(parse(src));
  const parts = p(src, c.suffix[0])!;
  assert.equal(parts[0].type, "LocaleString");
  assert.equal((parts[0] as any).text, '$"hello"');
  const inner = (parts[0] as any).parts;
  assert.equal(inner[0].type, "Literal");
  assert.equal(inner[0].value, "hello");
  assert.equal(inner[0].text, "hello");
});

test("CommandExpansion part has script", () => {
  const src = "echo $(pwd)";
  const c = getCmd(parse(src));
  assert.equal(p(src, c.suffix[0])![0].type, "CommandExpansion");
  assert.ok((p(src, c.suffix[0])![0] as any).script);
});
