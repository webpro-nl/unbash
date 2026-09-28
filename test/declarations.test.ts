import { nodeOfType, arrayElements, argumentsOf, redirectsOf } from "./ast-helpers.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "../src/parser.ts";
import { print } from "../src/printer.ts";
import type { Assignment, Command, ParsedScript } from "../src/types.ts";

function command(source: string): Command {
  const ast = parse(source);
  assert.equal(ast.errors, undefined, source);
  const node = ast.commands[0].command;
  assert.equal(node.type, "Command", source);
  if (node.type !== "Command") assert.fail(source);
  return node;
}

function assignment(argument: Command["suffix"][number]): Assignment {
  return nodeOfType(argument, "Assignment");
}

test("export operands are canonical assignments in the command suffix (#12)", () => {
  const node = command("export FOO=10");
  assert.equal(node.name?.text, "export");
  assert.deepEqual(node.prefix, []);
  assert.deepEqual(JSON.parse(JSON.stringify(node.suffix)), [
    {
      type: "Assignment",
      pos: 7,
      end: 13,
      text: "FOO=10",
      name: "FOO",
      value: { type: "Word", text: "10", pos: 11, end: 13, value: "10" },
    },
  ]);
  const operand = assignment(node.suffix[0]);
  assert.equal(nodeOfType(operand.value, "Word").value, "10");
  assert.equal(Object.getPrototypeOf(JSON.parse(JSON.stringify(operand))), Object.prototype);
});

test("declaration options and bare names remain words beside assignments", () => {
  for (const name of ["export", "declare", "typeset", "local", "readonly", "alias"]) {
    const node = command(`${name} -p -- EMPTY= VALUE+=more NAME`);
    assert.deepEqual(
      node.suffix.map((argument) => nodeOfType(argument, "Assignment", "Word").text),
      ["-p", "--", "EMPTY=", "VALUE+=more", "NAME"],
    );
    assert.deepEqual(
      argumentsOf(node).map((argument) => (argument.type === "Assignment" ? argument.name : undefined)),
      [undefined, undefined, "EMPTY", "VALUE", undefined],
    );
    assert.equal(nodeOfType(assignment(node.suffix[2]).value, "Word").text, "");
    assert.equal(assignment(node.suffix[3]).append, true);
    assert.equal(nodeOfType(assignment(node.suffix[3]).value, "Word").text, "more");
  }
});

test("prefixes, redirects, and continuations preserve declaration assignment recognition", () => {
  const node = command("BEFORE=1 >out ex\\\nport A=one 2>err B=two if C=three");
  assert.equal(nodeOfType(node.prefix[0], "Assignment").name, "BEFORE");
  assert.deepEqual(
    argumentsOf(node).map((argument) => (argument.type === "Assignment" ? argument.name : undefined)),
    ["A", "B", undefined, "C"],
  );
  assert.deepEqual(
    redirectsOf(node).map((redirect) => nodeOfType(redirect, "HereString", "Redirect").target?.text),
    ["out", "err"],
  );
  const operand = assignment(command('export FO\\\nO+\\\n="a b"').suffix[0]);
  assert.equal(operand.name, "FOO");
  assert.equal(operand.append, true);
  assert.equal(nodeOfType(operand.value, "Word").value, "a b");
});

test("ordinary, wrapped, quoted, and expanded commands keep word arguments", () => {
  for (const source of [
    "echo FOO=10",
    "command export FOO=10",
    "builtin export FOO=10",
    "env export FOO=10",
    'ex"port" FOO=10',
    "'export' FOO=10",
    "ex\\port FOO=10",
    "$command FOO=10",
  ]) {
    const node = command(source);
    assert.ok(
      node.suffix.every((argument) => argument.type !== "Assignment"),
      source,
    );
    assert.equal(nodeOfType(node.suffix.at(-1), "Word").value, "FOO=10", source);
  }
});

test("quoted and expanded assignment introducers remain words", () => {
  const node = command('export "FOO=10" F"OO"=10 FOO\\=10 "$name=10" $name=10 =value if');
  assert.equal(node.suffix.length, 7);
  assert.ok(node.suffix.every((argument) => argument.type !== "Assignment"));
  assert.deepEqual(
    command("export arr[1 + 2]=value").suffix.map((argument) => nodeOfType(argument, "Assignment", "Word").text),
    ["arr[1", "+", "2]=value"],
  );
});

test("scalar declaration assignments own their value structure once", () => {
  const operand = assignment(command('export FOO=before$(printf hi)"after"').suffix[0]);
  assert.equal(operand.name, "FOO");
  assert.equal(nodeOfType(operand.value, "Word").text, 'before$(printf hi)"after"');
  assert.equal(nodeOfType(operand.value, "Word").value, "before$(printf hi)after");
  assert.deepEqual(
    nodeOfType(operand.value, "Word").parts?.map((part) => [part.type, part.text]),
    [
      ["Literal", "before"],
      ["CommandExpansion", "$(printf hi)"],
      ["DoubleQuoted", '"after"'],
    ],
  );
  assert.equal("parts" in operand, false);
  assert.equal("assignment" in operand, false);
});

test("declaration arrays own element words and executable substitutions", () => {
  const source = 'declare -a arr=(one "two three" $(printf hi))';
  const operand = assignment(command(source).suffix[1]);
  assert.equal(operand.name, "arr");
  assert.equal(operand.value.type, "ArrayValue");
  assert.deepEqual(
    arrayElements(operand)?.map((element) => [element.text, element.value]),
    [
      ["one", "one"],
      ['"two three"', "two three"],
      ["$(printf hi)", "$(printf hi)"],
    ],
  );
  const expansion = arrayElements(operand)?.[2].parts?.[0];
  assert.equal(expansion?.type, "CommandExpansion");
  if (expansion?.type !== "CommandExpansion") assert.fail();
  assert.equal(expansion.script?.commands[0].command.pos, 34);
  assert.equal(expansion.script?.commands[0].command.end, 43);
  assert.equal(print(parse(source)), source);
});

test("indexed declaration assignments retain subscript parts", () => {
  const operand = assignment(command('declare arr[$(printf 1)]+="value"').suffix[0]);
  assert.equal(operand.index?.text, "$(printf 1)");
  assert.equal(operand.append, true);
  assert.equal(nodeOfType(operand.value, "Word").value, "value");
  assert.equal(operand.index?.parts?.[0].type, "CommandExpansion");
});

test("continued array values use the same parser in prefixes and suffixes", () => {
  for (const source of ["a=\\\n($(printf hi))", "declare a=\\\n($(printf hi))"]) {
    const node = command(source);
    const operand = nodeOfType(assignment(node.prefix[0] ?? node.suffix[0]), "Assignment");
    assert.equal(operand.value.type, "ArrayValue", source);
    assert.deepEqual(
      arrayElements(operand)?.map((word) => word.text),
      ["$(printf hi)"],
      source,
    );
    assert.equal(arrayElements(operand)?.[0].parts?.[0].type, "CommandExpansion", source);
  }
});

test("array comments are not executable parts and empty arrays remain arrays", () => {
  const source = 'declare -A a=([$(printf key)]="value" # $(not_a_command)\n [other]=$(printf next))';
  const operand = assignment(command(source).suffix[1]);
  assert.deepEqual(
    arrayElements(operand)?.map((word) => word.text),
    ['[$(printf key)]="value"', "[other]=$(printf next)"],
  );
  assert.equal(JSON.stringify(operand).split('"type":"CommandExpansion"').length - 1, 2);
  assert.equal(print(parse(source)), 'declare -A a=([$(printf key)]="value" [other]=$(printf next))');
  assert.deepEqual(arrayElements(assignment(command("declare empty=()").suffix[0])), []);
});

test("declaration array elements preserve continuations", () => {
  const source = 'declare a=("x"\\\n "y"\\\n)';
  assert.deepEqual(
    arrayElements(assignment(command(source).suffix[0]))?.map((word) => word.value),
    ["x", "y"],
  );
  assert.equal(print(parse(source)), source);
  assert.equal(print(JSON.parse(JSON.stringify(parse(source)))), source);
});

test("nested declaration assignments retain absolute source offsets", () => {
  const outer = command('echo $(export FOO="a b")');
  const word = outer.suffix[0];
  if (word.type !== "Word") assert.fail();
  const expansion = word.parts?.[0];
  assert.equal(expansion?.type, "CommandExpansion");
  if (expansion?.type !== "CommandExpansion") assert.fail();
  const inner = expansion.script?.commands[0].command;
  assert.equal(inner?.type, "Command");
  if (inner?.type !== "Command") assert.fail();
  const operand = assignment(inner.suffix[0]);
  assert.equal(operand.pos, 14);
  assert.equal(operand.end, 23);
  assert.equal(operand.value.pos, 18);
  assert.equal(nodeOfType(operand.value, "Word").value, "a b");
});

test("coprocess operands use the actual command's declaration context", () => {
  for (const [source, name, assigned] of [
    ["coproc export FOO=10", "export", true],
    ["coproc declare -a arr=(one two)", "declare", true],
    ["coproc echo export FOO=10", "echo", false],
  ] as const) {
    const ast = parse(source);
    assert.equal(ast.errors, undefined, source);
    const coproc = ast.commands[0].command;
    assert.equal(coproc.type, "Coproc");
    if (coproc.type !== "Coproc" || coproc.body.type !== "Command") assert.fail(source);
    assert.equal(coproc.body.name?.text, name);
    assert.deepEqual(coproc.body.prefix, []);
    const argument = coproc.body.suffix.at(-1)!;
    assert.equal(argument.type === "Assignment", assigned, source);
    assert.equal(print(ast), source);
  }
});

test("declarations inside decoded backticks retain their owning source", () => {
  const outer = command("echo `export FOO=\\$HOME`");
  const word = outer.suffix[0];
  if (word.type !== "Word") assert.fail();
  const expansion = word.parts?.[0];
  if (expansion?.type !== "CommandExpansion" || !expansion.script) assert.fail();
  assert.equal(expansion.script.source, "export FOO=$HOME");
  const inner = expansion.script.commands[0].command;
  if (inner.type !== "Command") assert.fail();
  const operand = assignment(inner.suffix[0]);
  assert.equal(operand.pos, 7);
  assert.equal(operand.end, 16);
  assert.equal(operand.value.pos, 11);
  assert.equal(operand.value.end, 16);
  assert.equal(nodeOfType(operand.value, "Word").parts?.[0].type, "SimpleExpansion");
  assert.equal(nodeOfType(operand.value, "Word").text, "$HOME");
});

test("JSON transfer retains declaration structure without reparsing", () => {
  const transferred: ParsedScript = JSON.parse(JSON.stringify(parse("export FOO=10")));
  const node = transferred.commands[0].command;
  if (node.type !== "Command") assert.fail();
  const operand = assignment(node.suffix[0]);
  assert.equal(operand.name, "FOO");
  assert.equal(nodeOfType(operand.value, "Word").value, "10");
  assert.equal(print(transferred), "export FOO=10");
});

test("nested declarations serialize each substitution once", () => {
  const source = "declare a=($(".repeat(12) + "printf hi" + "))".repeat(12);
  const serialized = JSON.stringify(parse(source));
  assert.equal(serialized.split('"type":"CommandExpansion"').length - 1, 12);
  assert.equal(serialized.split('"type":"Assignment"').length - 1, 12);
  const restored: ParsedScript = JSON.parse(serialized);
  assert.equal(print(restored), source);
});

test("nested declaration arrays preserve the substitution depth budget", () => {
  const source = "declare a=($(".repeat(300) + "printf hi" + "))".repeat(300);
  const ast = parse(source);
  const serialized = JSON.stringify(ast);
  assert.ok(ast.errors?.some((error) => error.message === "maximum command substitution nesting depth exceeded"));
  assert.equal(serialized.split('"type":"CommandExpansion"').length - 1, 258);
});
