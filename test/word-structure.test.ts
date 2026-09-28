import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "../src/parser.ts";
import { print } from "../src/printer.ts";
import type { ParsedScript, Word } from "../src/types.ts";

function argument(source: string): Word {
  const command = parse(source).commands[0].command;
  assert.equal(command.type, "Command");
  if (command.type !== "Command") throw new Error("expected command");
  const word = command.suffix[0];
  assert.equal(word.type, "Word");
  if (word.type !== "Word") throw new Error("expected word");
  return word;
}

test("words expose their discriminant before and after JSON serialization", () => {
  const word = argument("echo plain");
  assert.deepEqual(JSON.parse(JSON.stringify(word)), { type: "Word", text: "plain", pos: 5, end: 10, value: "plain" });
});

for (const [spelling, type, end] of [
  ["a'$x'", "Literal", 6],
  ["'abc'", "SingleQuoted", 10],
  ['"abc"', "DoubleQuoted", 10],
  ["$'a\\n'", "AnsiCQuoted", 11],
  ['$"abc"', "LocaleString", 11],
  ["$name", "SimpleExpansion", 10],
  ["${name:-x}", "ParameterExpansion", 15],
  ["$(echo x)", "CommandExpansion", 14],
  ["$((1+2))", "ArithmeticExpansion", 13],
  ["<(echo x)", "ProcessSubstitution", 14],
  ["@(a|b)", "ExtendedGlob", 11],
  ["{a,b}", "BraceExpansion", 10],
] as const) {
  test(`${type} retains its raw source range`, () => {
    const part = argument("echo " + spelling).parts?.[0];
    assert.ok(part);
    assert.deepEqual([part.type, part.pos, part.end], [type, 5, end]);
  });
}

test("empty decoded literals retain continuation spans in quoted and embedded words", () => {
  const quoted = argument('echo "\\\n$x\\\n"').parts?.[0];
  assert.equal(quoted?.type, "DoubleQuoted");
  if (quoted?.type !== "DoubleQuoted") return;
  assert.deepEqual(quoted.parts, [
    { type: "Literal", value: "", text: "\\\n", pos: 6, end: 8 },
    { type: "SimpleExpansion", text: "$x", pos: 8, end: 10 },
    { type: "Literal", value: "", text: "\\\n", pos: 10, end: 12 },
  ]);
  const parameter = argument("echo ${x:-'a'\\\n'b'\\\n}").parts?.[0];
  assert.equal(parameter?.type, "ParameterExpansion");
  if (parameter?.type !== "ParameterExpansion") return;
  assert.equal(parameter.operation?.type, "Default");
  if (parameter.operation?.type !== "Default") return;
  assert.equal(parameter.operation.operand.value, "ab");
  assert.deepEqual(parameter.operation.operand.parts, [
    { type: "SingleQuoted", value: "a", text: "'a'", pos: 10, end: 13 },
    { type: "Literal", value: "", text: "\\\n", pos: 13, end: 15 },
    { type: "SingleQuoted", value: "b", text: "'b'", pos: 15, end: 18 },
    { type: "Literal", value: "", text: "\\\n", pos: 18, end: 20 },
  ]);
});

test("deferred expansion bookkeeping is absent from public syntax", () => {
  for (const source of ["echo $(date)", "echo <(date)", "echo $(( $(date) ))", "(( $(date) ))"]) {
    const script = parse(source);
    const json = JSON.stringify(script);
    assert.equal(json.includes('"inner"'), false);
    assert.equal(json.includes('"innerStart"'), false);
    const command = script.commands[0].command;
    const expression = command.type === "ArithmeticCommand" ? command.expression : undefined;
    if (expression?.type === "ArithmeticCommandExpansion") {
      assert.equal("inner" in expression, false);
      assert.equal("innerStart" in expression, false);
    }
    if (command.type !== "Command") continue;
    for (const part of argument(source).parts ?? []) {
      assert.equal("inner" in part, false);
      assert.equal("innerStart" in part, false);
    }
  }
});

test("decoded backtick source survives JSON with inherited nested coordinates", () => {
  const script: ParsedScript = JSON.parse(JSON.stringify(parse("echo `outer \\`inner cmd\\` tail`")));
  const command = script.commands[0].command;
  assert.equal(command.type, "Command");
  if (command.type !== "Command") return;
  const word = command.suffix[0];
  if (word.type !== "Word") throw new Error("expected word");
  const part = word.parts?.[0];
  assert.equal(part?.type, "CommandExpansion");
  if (part?.type !== "CommandExpansion" || !part.script) return;
  assert.equal(part.script.source, "outer `inner cmd` tail");
  const outer = part.script.commands[0].command;
  if (outer.type !== "Command") throw new Error("expected command");
  const nestedWord = outer.suffix[0];
  if (nestedWord.type !== "Word") throw new Error("expected word");
  const nested = nestedWord.parts?.[0];
  assert.equal(nested?.type, "CommandExpansion");
  assert.deepEqual(nested && [nested.pos, nested.end], [6, 17]);
  if (nested?.type !== "CommandExpansion" || !nested.script) return;
  assert.equal(nested.script.source, undefined);
  assert.deepEqual([nested.script.pos, nested.script.end], [7, 16]);
});

test("continued extglob operators retain their raw range and dequoted word value", () => {
  const word = argument("echo a@\\\n\\\n(b|c)");
  assert.equal(word.value, "a@(b|c)");
  assert.deepEqual(word.parts, [
    { type: "Literal", pos: 5, end: 6, text: "a", value: "a" },
    { type: "ExtendedGlob", pos: 6, end: 16, text: "@\\\n\\\n(b|c)", operator: "@", pattern: "b|c", parts: undefined },
  ]);
});

test("incomplete expansion ranges stop at the supplied source boundary", () => {
  for (const [source, text, end] of [
    ["echo $((1", "$((1", 9],
    ["echo $((1\\", "$((1\\", 10],
    ["echo ${x\\", "${x\\", 9],
  ] as const) {
    const word = argument(source);
    const part = word.parts?.[0];
    assert.deepEqual([word.pos, word.end, part?.pos, part?.end, part?.text], [5, end, 5, end, text]);
  }
});

test("parameter expansion owns one ranged operation and one source-backed index", () => {
  const word = argument("echo ${!arr[$(key)]:-$(fallback)}");
  const part = word.parts?.[0];
  assert.equal(part?.type, "ParameterExpansion");
  if (part?.type !== "ParameterExpansion") return;
  assert.deepEqual([part.prefix, part.parameter, part.parameterPos, part.parameterEnd], ["!", "arr", 8, 11]);
  assert.deepEqual([part.index?.type, part.index?.text, part.index?.pos, part.index?.end], ["Word", "$(key)", 12, 18]);
  const operation = part.operation;
  assert.equal(operation?.type, "Default");
  if (operation?.type !== "Default") return;
  assert.deepEqual([operation.operator, operation.pos, operation.operatorEnd, operation.end], [":-", 19, 21, 32]);
  assert.deepEqual([operation.operand.text, operation.operand.pos, operation.operand.end], ["$(fallback)", 21, 32]);
  const commands: string[] = [];
  JSON.stringify(word, (_key, value) => {
    if (value?.type === "Command") commands.push(value.name.text);
    return value;
  });
  assert.deepEqual(commands, ["key", "fallback"]);
  for (const obsolete of ["indexParts", "indirect", "length", "operand", "slice", "replace", "operator"]) {
    assert.equal(Object.hasOwn(part, obsolete), false, obsolete);
  }
});

for (const [source, kind, operator, start, operatorEnd, end] of [
  ["echo ${x:-y}", "Default", ":-", 8, 10, 11],
  ["echo ${x%%y}", "Remove", "%%", 8, 10, 11],
  ["echo ${x//a/b}", "Replace", "//", 8, 10, 13],
  ["echo ${x:1:2}", "Slice", ":", 8, 9, 12],
  ["echo ${x^^}", "CaseModification", "^^", 8, 10, 10],
  ["echo ${x@Q}", "Transform", "@", 8, 9, 10],
  ["echo ${!pre*}", "Names", "*", 11, 12, 12],
  ["echo ${!pre@}", "Names", "@", 11, 12, 12],
  ["echo ${x~bad}", "Unknown", "~bad", 8, 12, 12],
] as const) {
  test(`${kind} parameter operation retains its operator and suffix ranges`, () => {
    const part = argument(source).parts?.[0];
    assert.equal(part?.type, "ParameterExpansion");
    if (part?.type !== "ParameterExpansion") return;
    const operation = part.operation;
    assert.deepEqual(
      operation && [operation.type, operation.operator, operation.pos, operation.operatorEnd, operation.end],
      [kind, operator, start, operatorEnd, end],
    );
  });
}

test("parameter prefixes distinguish length and special parameters (Bash 5.3.20)", () => {
  for (const [source, prefix, parameter, start, end] of [
    ["echo ${#}", undefined, "#", 7, 8],
    ["echo ${!}", undefined, "!", 7, 8],
    ["echo ${##}", "#", "#", 8, 9],
    ["echo ${#x}", "#", "x", 8, 9],
    ["echo ${!#}", "!", "#", 8, 9],
  ] as const) {
    const part = argument(source).parts?.[0];
    assert.equal(part?.type, "ParameterExpansion");
    if (part?.type !== "ParameterExpansion") return;
    assert.deepEqual(
      [part.prefix, part.parameter, part.parameterPos, part.parameterEnd, part.operation],
      [prefix, parameter, start, end, undefined],
    );
  }
});

test("indirection composes with existing operations (Bash 5.3.20)", () => {
  for (const suffix of [":-x", "#a", ":1:2", "/a/z", "^^", "@Q"]) {
    const part = argument("echo ${!ref" + suffix + "}").parts?.[0];
    assert.equal(part?.type, "ParameterExpansion");
    if (part?.type !== "ParameterExpansion") return;
    assert.equal(part.prefix, "!");
    assert.equal(part.parameter, "ref");
    assert.ok(part.operation);
  }
});

test("parameter materialization and JSON preserve printing", () => {
  const source = 'echo "${!array[$(key)]:-$(fallback)}" ${value//a/b} ${value:1:2}';
  const script = parse(source);
  assert.equal(print(script), source);
  const command = script.commands[0].command;
  assert.equal(command.type, "Command");
  if (command.type !== "Command") return;
  for (const word of command.suffix) {
    if (word.type === "Word") assert.ok(word.parts);
  }
  const serialized: ParsedScript = JSON.parse(JSON.stringify(script));
  assert.equal(print(script), source);
  assert.equal(print(serialized), source);
});
