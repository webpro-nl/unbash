import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "../src/parser.ts";
import { print } from "../src/printer.ts";

function firstAssignment(source: string) {
  const command = parse(source).commands[0].command;
  if (command.type !== "Command") assert.fail(source);
  const assignment = [...command.prefix, ...command.suffix].find((item) => item.type === "Assignment");
  if (assignment === undefined) assert.fail(source);
  return assignment;
}

function arrayWords(source: string) {
  const assignment = firstAssignment(source);
  if (assignment.value.type !== "ArrayValue") assert.fail(source);
  return assignment.value.elements;
}

test("compound array keys retain operators and whitespace in one word", () => {
  const source = "declare -a a=([1|2]=x [1 + 3]=y [2>1]=z [1]+=next)";
  assert.deepEqual(
    arrayWords(source).map(({ text, pos, end }) => [text, pos, end]),
    [
      ["[1|2]=x", 14, 21],
      ["[1 + 3]=y", 22, 31],
      ["[2>1]=z", 32, 39],
      ["[1]+=next", 40, 49],
    ],
  );
  assert.equal(print(parse(source)), source);
});

test("compound array keys preserve nested executable syntax and suffix structure", () => {
  const source = 'a=([1 | $(printf 2)]=@("x"|y) ["3|4"]="a b" [5]\\\n+\\\n=z)';
  const words = arrayWords(source);
  assert.deepEqual(
    words.map(({ text, value }) => [text, value]),
    [
      ['[1 | $(printf 2)]=@("x"|y)', '[1 | $(printf 2)]=@("x"|y)'],
      ['["3|4"]="a b"', "[3|4]=a b"],
      ["[5]\\\n+\\\n=z", "[5]+=z"],
    ],
  );
  const substitution = words[0].parts?.find((part) => part.type === "CommandExpansion");
  assert.equal(substitution?.script?.commands[0].command.type, "Command");
  assert.deepEqual(substitution && [substitution.text, substitution.pos, substitution.end], ["$(printf 2)", 8, 19]);
  assert.equal(words[0].parts?.at(-1)?.type, "ExtendedGlob");
  for (const word of words) {
    assert.equal(source.slice(word.pos, word.end), word.text);
    assert.equal(word.parts?.map((part) => part.text).join("") ?? word.text, word.text);
  }
  assert.equal(print(parse(source)), source);
  assert.equal(print(JSON.parse(JSON.stringify(parse(source)))), source);
});

test("only leading unquoted brackets group compound array words", () => {
  const source = 'a=([1|2]x [1 2]"="x "[1|2]"=x plain "two words" @(x|y) {a,b})';
  const words = arrayWords(source);
  assert.deepEqual(
    words.map(({ text }) => text),
    ["[1|2]x", '[1 2]"="x', '"[1|2]"=x', "plain", '"two words"', "@(x|y)", "{a,b}"],
  );
  assert.equal(words[5].parts?.[0].type, "ExtendedGlob");
  assert.equal(words[6].parts?.[0].type, "BraceExpansion");
  assert.equal(print(parse(source)), source);
  for (const command of ["echo [1|2]=x", "declare [1|2]=x", "echo pre[1|2]=x", "echo \\[1|2]=x"]) {
    assert.equal(parse(command).commands[0].command.type, "Pipeline", command);
  }
});

test("assignment values have one scalar or array owner", () => {
  const script = parse("x=one; declare a=(one 'two words')");
  const scalar = script.commands[0].command;
  const declaration = script.commands[1].command;
  assert.equal(scalar.type, "Command");
  assert.equal(declaration.type, "Command");
  if (scalar.type !== "Command" || declaration.type !== "Command") assert.fail();
  const first = scalar.prefix[0];
  const second = declaration.suffix[0];
  assert.equal(first.type, "Assignment");
  assert.equal(second.type, "Assignment");
  if (first.type !== "Assignment" || second.type !== "Assignment") assert.fail();
  assert.equal(first.value.type, "Word");
  assert.equal(second.value.type, "ArrayValue");
  if (second.value.type !== "ArrayValue") assert.fail();
  assert.deepEqual(
    second.value.elements.map((word) => [word.text, word.value]),
    [
      ["one", "one"],
      ["'two words'", "two words"],
    ],
  );
  assert.deepEqual([second.value.pos, second.value.end], [17, 34]);
  assert.equal("array" in second, false);
  assert.equal(print(script), "x=one\ndeclare a=(one 'two words')");
});

test("assignment subscripts own their spelling and parts", () => {
  const node = parse("export a[$(printf 1)]+=x").commands[0].command;
  assert.equal(node.type, "Command");
  if (node.type !== "Command") assert.fail();
  const assignment = node.suffix[0];
  assert.equal(assignment.type, "Assignment");
  if (assignment.type !== "Assignment") assert.fail();
  assert.equal(assignment.index?.type, "Word");
  assert.deepEqual([assignment.index?.text, assignment.index?.pos, assignment.index?.end], ["$(printf 1)", 9, 20]);
  assert.equal(assignment.index?.parts?.[0].type, "CommandExpansion");
  assert.equal("indexParts" in assignment, false);
  assert.equal(assignment.append, true);
});

test("lazy assignment fields remain stable through JSON and printing", () => {
  const source = "declare values=(one $(printf two)) index[2]=three";
  const script = parse(source);
  const before = JSON.stringify(script);
  const command = script.commands[0].command;
  assert.equal(command.type, "Command");
  if (command.type !== "Command") assert.fail();
  const assignment = command.suffix[0];
  assert.equal(assignment.type, "Assignment");
  if (assignment.type !== "Assignment") assert.fail();
  assert.equal(assignment.value, assignment.value);
  if (assignment.value.type !== "ArrayValue") assert.fail();
  assert.equal(assignment.value.elements, assignment.value.elements);
  assert.equal(JSON.stringify(script), before);
  assert.equal(print(script), source);
  assert.equal(print(JSON.parse(before)), source);
  assert.equal((before.match(/"type":"CommandExpansion"/g) ?? []).length, 1);
});

test("empty assignments keep a string name and a present value", () => {
  for (const [source, expected] of [
    ["a=", ["a", "Word", ""]],
    ["a[x]=", ["a", "Word", ""]],
    ["a+=", ["a", "Word", ""]],
    ["a=()", ["a", "ArrayValue", []]],
    ["export A=", ["A", "Word", ""]],
  ] as const) {
    const { name, value } = firstAssignment(source);
    assert.deepEqual([name, value.type, value.type === "Word" ? value.text : value.elements], expected, source);
  }
  assert.equal(
    JSON.stringify(firstAssignment("export A=1")),
    '{"type":"Assignment","pos":7,"end":10,"text":"A=1","name":"A","value":{"type":"Word","text":"1","pos":9,"end":10,"value":"1"}}',
  );
});
