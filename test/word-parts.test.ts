import { nodeOfType } from "./ast-helpers.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "../src/parser.ts";
import { computeWordParts } from "../src/parts.ts";

const getCmd = (ast: ReturnType<typeof parse>, i = 0) => nodeOfType(ast.commands[i].command, "Command");
const p = (s: string, w: import("../src/types.ts").Word) => computeWordParts(s, w);

test("simple word has no parts", () => {
  const src = "echo hello";
  const c = getCmd(parse(src));
  assert.equal(p(src, c.name!), undefined);
  assert.equal(p(src, nodeOfType(c.suffix[0], "Word")), undefined);
});

test("double-quoted literal", () => {
  const src = 'echo "hello world"';
  const c = getCmd(parse(src));
  assert.deepEqual(p(src, nodeOfType(c.suffix[0], "Word")), [
    {
      type: "DoubleQuoted",
      pos: 5,
      end: 18,
      text: '"hello world"',
      parts: [{ type: "Literal", pos: 6, end: 17, value: "hello world", text: "hello world" }],
    },
  ]);
});

test("double-quoted with variable", () => {
  const src = 'echo "hello $name world"';
  const c = getCmd(parse(src));
  assert.deepEqual(p(src, nodeOfType(c.suffix[0], "Word")), [
    {
      type: "DoubleQuoted",
      pos: 5,
      end: 24,
      text: '"hello $name world"',
      parts: [
        { type: "Literal", pos: 6, end: 12, value: "hello ", text: "hello " },
        { type: "SimpleExpansion", pos: 12, end: 17, text: "$name" },
        { type: "Literal", pos: 17, end: 23, value: " world", text: " world" },
      ],
    },
  ]);
});

test("unquoted variable", () => {
  const src = "echo $name";
  const c = getCmd(parse(src));
  assert.deepEqual(p(src, nodeOfType(c.suffix[0], "Word")), [
    { type: "SimpleExpansion", pos: 5, end: 10, text: "$name" },
  ]);
});

for (const [label, source, range] of [
  ["primary", "$FOO/$BAR/", [0, 10]],
  ["echo argument", "echo $FOO/$BAR/", [5, 15]],
] as const) {
  test(`punctuation-separated expansions stay in one ${label} word (#315)`, () => {
    const ast = parse(source);
    const command = getCmd(ast);
    const word = command.name?.text === "echo" ? nodeOfType(command.suffix[0], "Word") : command.name!;
    assert.equal(ast.errors, undefined);
    assert.deepEqual([word.text, word.pos, word.end], ["$FOO/$BAR/", ...range]);
    assert.deepEqual(
      p(source, word)?.map(({ type, text }) => [type, text]),
      [
        ["SimpleExpansion", "$FOO"],
        ["Literal", "/"],
        ["SimpleExpansion", "$BAR"],
        ["Literal", "/"],
      ],
    );
  });
}

test("special variables", () => {
  const src = "echo $@ $# $?";
  const c = getCmd(parse(src));
  assert.deepEqual(p(src, nodeOfType(c.suffix[0], "Word")), [{ type: "SimpleExpansion", pos: 5, end: 7, text: "$@" }]);
  assert.deepEqual(p(src, nodeOfType(c.suffix[1], "Word")), [{ type: "SimpleExpansion", pos: 8, end: 10, text: "$#" }]);
  assert.deepEqual(p(src, nodeOfType(c.suffix[2], "Word")), [
    { type: "SimpleExpansion", pos: 11, end: 13, text: "$?" },
  ]);
});

test("positional parameter", () => {
  const src = "echo $1";
  const c = getCmd(parse(src));
  assert.deepEqual(p(src, nodeOfType(c.suffix[0], "Word")), [{ type: "SimpleExpansion", pos: 5, end: 7, text: "$1" }]);
});

test("parameter expansion ${...}", () => {
  const src = "echo ${var:-default}";
  const c = getCmd(parse(src));
  const parts = p(src, nodeOfType(c.suffix[0], "Word"))!;
  assert.equal(parts.length, 1);
  assert.equal(parts[0].type, "ParameterExpansion");
  assert.equal(nodeOfType(parts[0], "ParameterExpansion").text, "${var:-default}");
  assert.equal(nodeOfType(parts[0], "ParameterExpansion").parameter, "var");
  const operation = nodeOfType(nodeOfType(parts[0], "ParameterExpansion").operation, "Default");
  assert.equal(operation.operator, ":-");
  assert.equal(operation.operand.text, "default");
});

test("associative indexes keep whitespace-concatenated expansions (#268)", () => {
  const source = 'echo "${things[$foo $bar]}"';
  const ast = parse(source);
  assert.equal(ast.errors, undefined);
  const word = nodeOfType(getCmd(ast).suffix[0], "Word");
  assert.deepEqual([word.text, word.pos, word.end], ['"${things[$foo $bar]}"', 5, 27]);

  const quoted = p(source, word)?.[0];
  assert.equal(quoted?.type, "DoubleQuoted");
  if (quoted?.type !== "DoubleQuoted") return;
  assert.equal(quoted.parts.length, 1);
  const expansion = quoted.parts[0];
  assert.equal(expansion.type, "ParameterExpansion");
  if (expansion.type !== "ParameterExpansion") return;
  assert.deepEqual(
    [expansion.text, expansion.parameter, expansion.index?.text],
    ["${things[$foo $bar]}", "things", "$foo $bar"],
  );
  assert.deepEqual(expansion.index?.parts, [
    { type: "SimpleExpansion", pos: 15, end: 19, text: "$foo" },
    { type: "Literal", pos: 19, end: 20, value: " ", text: " " },
    { type: "SimpleExpansion", pos: 20, end: 24, text: "$bar" },
  ]);
});

test("command substitution $()", () => {
  const src = "echo $(hostname)";
  const c = getCmd(parse(src));
  const parts = p(src, nodeOfType(c.suffix[0], "Word"))!;
  assert.equal(parts.length, 1);
  assert.equal(parts[0].type, "CommandExpansion");
  assert.equal(nodeOfType(parts[0], "CommandExpansion").text, "$(hostname)");
  assert.ok(nodeOfType(parts[0], "CommandExpansion").script);
});

test("backtick command substitution", () => {
  const src = "echo `hostname`";
  const c = getCmd(parse(src));
  const parts = p(src, nodeOfType(c.suffix[0], "Word"))!;
  assert.equal(parts.length, 1);
  assert.equal(parts[0].type, "CommandExpansion");
  assert.ok(nodeOfType(parts[0], "CommandExpansion").script);
});

test("arithmetic expansion", () => {
  const src = "echo $((1+2))";
  const c = getCmd(parse(src));
  const parts = p(src, nodeOfType(c.suffix[0], "Word"))!;
  assert.equal(parts.length, 1);
  assert.equal(parts[0].type, "ArithmeticExpansion");
  assert.equal(nodeOfType(parts[0], "ArithmeticExpansion").text, "$((1+2))");
  assert.ok(nodeOfType(parts[0], "ArithmeticExpansion").expression);
});

test("single-quoted string", () => {
  const src = "echo 'hello world'";
  const c = getCmd(parse(src));
  assert.deepEqual(p(src, nodeOfType(c.suffix[0], "Word")), [
    { type: "SingleQuoted", pos: 5, end: 18, value: "hello world", text: "'hello world'" },
  ]);
});

test("ANSI-C quoted string", () => {
  const src = "echo $'line1\\nline2'";
  const c = getCmd(parse(src));
  const parts = p(src, nodeOfType(c.suffix[0], "Word"))!;
  assert.equal(parts.length, 1);
  assert.equal(parts[0].type, "AnsiCQuoted");
  assert.equal(nodeOfType(parts[0], "AnsiCQuoted").text, "$'line1\\nline2'");
});

test("ANSI-C numeric and control escapes", () => {
  const src = "$'ec\\x68o' $'\\141\\u0062\\U00000063' $'\\0123' $'\\777' $'\\cA' $'\\?' $'\\q'";
  const c = getCmd(parse(src));

  assert.equal(c.name!.value, "echo");
  assert.deepEqual(
    c.suffix.map((word) => nodeOfType(word, "Word").value),
    ["abc", "\n3", "\xff", "\x01", "?", "\\q"],
  );
});

test("ANSI-C \\c operand edge cases", () => {
  const src = String.raw`$'\c' $'\c\\' $'\c\'' $'AB\c' $'\c\cA' $'\c<\\' $'\c\x41' $'\cq' $'\c1' $'\c?'`;
  const c = getCmd(parse(src));

  assert.equal(c.name!.value, "\\c");
  assert.deepEqual(
    c.suffix.map((word) => nodeOfType(word, "Word").value),
    ["\x1c", "\x1c'", "AB\\c", "\x1ccA", "\x1c\\", "\x1cx41", "\x11", "\x11", "\x7f"],
  );
});

test("mixed quoting: un'quo'ted\"mix\"$end", () => {
  const src = "echo un'quo'ted\"mix\"$end";
  const c = getCmd(parse(src));
  const parts = p(src, nodeOfType(c.suffix[0], "Word"))!;
  assert.equal(parts[0].type, "Literal");
  assert.equal(nodeOfType(parts[0], "Literal").value, "un");
  assert.equal(nodeOfType(parts[0], "Literal").text, "un");
  assert.equal(parts[1].type, "SingleQuoted");
  assert.equal(nodeOfType(parts[1], "SingleQuoted").value, "quo");
  assert.equal(nodeOfType(parts[1], "SingleQuoted").text, "'quo'");
  assert.equal(parts[2].type, "Literal");
  assert.equal(nodeOfType(parts[2], "Literal").value, "ted");
  assert.equal(nodeOfType(parts[2], "Literal").text, "ted");
  assert.equal(parts[3].type, "DoubleQuoted");
  assert.equal(nodeOfType(parts[3], "DoubleQuoted").text, '"mix"');
  assert.equal(parts[4].type, "SimpleExpansion");
  assert.equal(nodeOfType(parts[4], "SimpleExpansion").text, "$end");
});

test("variable concatenated with literal", () => {
  const src = "echo prefix-$name-suffix";
  const c = getCmd(parse(src));
  const parts = p(src, nodeOfType(c.suffix[0], "Word"))!;
  assert.equal(parts[0].type, "Literal");
  assert.equal(nodeOfType(parts[0], "Literal").value, "prefix-");
  assert.equal(nodeOfType(parts[0], "Literal").text, "prefix-");
  assert.equal(parts[1].type, "SimpleExpansion");
  assert.equal(nodeOfType(parts[1], "SimpleExpansion").text, "$name");
  assert.equal(parts[2].type, "Literal");
  assert.equal(nodeOfType(parts[2], "Literal").value, "-suffix");
  assert.equal(nodeOfType(parts[2], "Literal").text, "-suffix");
});

test("double-quoted with command substitution", () => {
  const src = 'echo "hello $(whoami)"';
  const c = getCmd(parse(src));
  const parts = p(src, nodeOfType(c.suffix[0], "Word"))!;
  assert.equal(parts.length, 1);
  assert.equal(parts[0].type, "DoubleQuoted");
  assert.equal(nodeOfType(parts[0], "DoubleQuoted").text, '"hello $(whoami)"');
  const inner = nodeOfType(parts[0], "DoubleQuoted").parts;
  assert.equal(inner.length, 2);
  assert.equal(inner[0].type, "Literal");
  assert.equal(inner[0].value, "hello ");
  assert.equal(inner[0].text, "hello ");
  assert.equal(inner[1].type, "CommandExpansion");
});

test("double-quoted with param expansion", () => {
  const src = 'echo "${var:-default}"';
  const c = getCmd(parse(src));
  const parts = p(src, nodeOfType(c.suffix[0], "Word"))!;
  assert.equal(parts[0].type, "DoubleQuoted");
  const inner = nodeOfType(parts[0], "DoubleQuoted").parts;
  assert.equal(inner.length, 1);
  assert.equal(inner[0].type, "ParameterExpansion");
  assert.equal(inner[0].text, "${var:-default}");
});

test("double-quoted with arithmetic", () => {
  const src = 'echo "$((1 + 2))"';
  const c = getCmd(parse(src));
  const parts = p(src, nodeOfType(c.suffix[0], "Word"))!;
  assert.equal(parts[0].type, "DoubleQuoted");
  const inner = nodeOfType(parts[0], "DoubleQuoted").parts;
  assert.equal(inner[0].type, "ArithmeticExpansion");
});

test("escaped characters in unquoted word", () => {
  // backslash-escaped char enters slow path but is literal
  const c = getCmd(parse("echo hello\\ world"));
  assert.equal(nodeOfType(c.suffix[0], "Word").text, "hello\\ world");
  // single literal — parts should be null (no structure)
  assert.equal(computeWordParts("echo hello\\ world", nodeOfType(c.suffix[0], "Word")), undefined);
});

test('locale string $"..."', () => {
  const src = 'echo $"hello $name"';
  const c = getCmd(parse(src));
  const parts = p(src, nodeOfType(c.suffix[0], "Word"))!;
  assert.equal(parts[0].type, "LocaleString");
  assert.equal(nodeOfType(parts[0], "LocaleString").text, '$"hello $name"');
  const inner = nodeOfType(parts[0], "LocaleString").parts;
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
  assert.equal(nodeOfType(c.suffix[0], "Word").text, '"hello $name world"');
  assert.ok(p(src, nodeOfType(c.suffix[0], "Word")));
});

test("LiteralPart.text includes backslash escapes", () => {
  const src = "echo he\\nllo-$x";
  const c = getCmd(parse(src));
  const parts = p(src, nodeOfType(c.suffix[0], "Word"))!;
  assert.equal(parts[0].type, "Literal");
  assert.equal(nodeOfType(parts[0], "Literal").value, "henllo-");
  assert.equal(nodeOfType(parts[0], "Literal").text, "he\\nllo-");
});

test("locale string without expansions", () => {
  const src = 'echo $"hello"';
  const c = getCmd(parse(src));
  const parts = p(src, nodeOfType(c.suffix[0], "Word"))!;
  assert.equal(parts[0].type, "LocaleString");
  assert.equal(nodeOfType(parts[0], "LocaleString").text, '$"hello"');
  const inner = nodeOfType(parts[0], "LocaleString").parts;
  assert.equal(inner[0].type, "Literal");
  assert.equal(inner[0].value, "hello");
  assert.equal(inner[0].text, "hello");
});

test("CommandExpansion part has script", () => {
  const src = "echo $(pwd)";
  const c = getCmd(parse(src));
  assert.equal(p(src, nodeOfType(c.suffix[0], "Word"))![0].type, "CommandExpansion");
  assert.ok(nodeOfType(p(src, nodeOfType(c.suffix[0], "Word"))![0], "CommandExpansion").script);
});
