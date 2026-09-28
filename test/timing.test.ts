import { nodeOfType } from "./ast-helpers.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "../src/parser.ts";
import { print } from "../src/printer.ts";
import type { SyntaxNode } from "../src/types.ts";

test("timing and negation retain prefix order around the complete pipeline", () => {
  for (const [source, prefixes] of [
    ["time ! first | second", ["Time", "Negation"]],
    ["! time first | second", ["Negation", "Time"]],
    ["time ! time -p ! first | second", ["Time", "Negation", "Time", "Negation"]],
    ["time time first | second", ["Time", "Time"]],
  ] as const) {
    const ast = parse(source);
    let node: SyntaxNode | undefined = ast.commands[0].command;
    const actual = [];
    while (node?.type === "Time" || node?.type === "Negation") {
      actual.push(node.type);
      node = node.command;
    }
    assert.deepEqual(actual, prefixes, source);
    assert.ok(node?.type === "Pipeline", source);
    assert.deepEqual(
      node.commands.map((command) => command.type),
      ["Command", "Command"],
      source,
    );
    assert.deepEqual(node.operators, ["|"], source);
    assert.equal("time" in node, false, source);
    assert.equal("negated" in node, false, source);
    assert.equal(ast.errors, undefined, source);
    assert.equal(print(ast), source, source);
    assert.equal(print(parse(print(ast))), source, source);
  }
});

test("bare prefix JSON has one child owner and complete keyword and flag ranges", () => {
  const ast = parse("! time -p --");
  assert.deepEqual(JSON.parse(JSON.stringify(ast.commands[0].command)), {
    type: "Negation",
    pos: 0,
    end: 12,
    keywordEnd: 1,
    command: {
      type: "Time",
      pos: 2,
      end: 12,
      keywordEnd: 6,
      posix: { pos: 7, end: 9 },
      endOfOptions: { pos: 10, end: 12 },
    },
  });
});

test("timing preserves option presence and source ranges", () => {
  for (const [source, keywordEnd, posix, endOfOptions, printed] of [
    ["  time  ", 6, undefined, undefined, "time"],
    ["time -p", 4, { pos: 5, end: 7 }, undefined, "time -p"],
    ["time --", 4, undefined, { pos: 5, end: 7 }, "time --"],
    ["time -p --", 4, { pos: 5, end: 7 }, { pos: 8, end: 10 }, "time -p --"],
    ["ti\\\nme -\\\np --", 6, { pos: 7, end: 11 }, { pos: 12, end: 14 }, "time -p --"],
  ] as const) {
    const ast = parse(source);
    const time = ast.commands[0].command;
    assert.ok(time.type === "Time", source);
    assert.equal(time.keywordEnd, keywordEnd, source);
    assert.deepEqual(time.posix, posix, source);
    assert.deepEqual(time.endOfOptions, endOfOptions, source);
    assert.equal(time.command, undefined, source);
    assert.equal(time.end, source.trimEnd().length, source);
    assert.equal(ast.errors, undefined, source);
    assert.equal(print(ast), printed, source);
  }
});

test("timing consumes each eligible option only once", () => {
  for (const [source, name] of [
    ["time -p -p arg", "-p"],
    ["time -- -p arg", "-p"],
    ["time -p -- -- arg", "--"],
    ["time '--' arg", "--"],
    ["time -p '--' arg", "--"],
  ]) {
    const ast = parse(source);
    const time = ast.commands[0].command;
    assert.ok(time.type === "Time", source);
    assert.ok(time.command?.type === "Command", source);
    assert.equal(time.command.name?.value, name, source);
    assert.equal(ast.errors, undefined, source);
    assert.equal(print(ast), source, source);
  }
});

test("timing remains an ordinary word after a pipe or command prefix", () => {
  for (const source of ["first | time -p second", "A=1 time -p second", ">out time -p second"]) {
    const ast = parse(source);
    const node = ast.commands[0].command;
    const command = node.type === "Pipeline" ? node.commands[1] : node;
    assert.ok(command.type === "Command", source);
    assert.equal(command.name?.value, "time", source);
    assert.equal(ast.errors, undefined, source);
  }
});

test("long prefix sequences use the nesting limit without overflowing JSON or printing", () => {
  const ast = parse("! time ".repeat(10000) + ":");
  assert.deepEqual(ast.errors, [{ message: "maximum pipeline prefix nesting depth exceeded", pos: 896 }]);
  assert.doesNotThrow(() => JSON.stringify(ast));
  assert.doesNotThrow(() => print(ast));
});

test("prefix nesting shares the compound command budget and recovers the following statement", () => {
  const ast = parse("! ".repeat(256) + "{ echo body; }; echo after");
  assert.deepEqual(ast.errors, [{ message: "maximum brace group nesting depth exceeded", pos: 512 }]);
  assert.equal(ast.commands.length, 2);
  const command = ast.commands[1].command;
  assert.ok(command.type === "Command");
  assert.equal(command.name?.text, "echo");
  assert.deepEqual(
    command.suffix.map((word) => nodeOfType(word, "Assignment", "Word").text),
    ["after"],
  );
  assert.doesNotThrow(() => JSON.stringify(ast));
  assert.doesNotThrow(() => print(ast));
});

test("continued negation retains its complete keyword range", () => {
  const ast = parse("!\\\n !\\\n false");
  const first = ast.commands[0].command;
  assert.ok(first.type === "Negation");
  assert.deepEqual([first.pos, first.keywordEnd, first.end], [0, 3, 13]);
  const second = first.command;
  assert.ok(second?.type === "Negation");
  assert.deepEqual([second.pos, second.keywordEnd, second.end], [4, 7, 13]);
  assert.equal(print(ast), "! ! false");
  assert.equal(ast.errors, undefined);
});
