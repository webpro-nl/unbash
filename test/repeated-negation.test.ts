import { nodeOfType, redirectsOf } from "./ast-helpers.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "../src/parser.ts";
import { print } from "../src/printer.ts";

test("repeated negation applies to the entire pipeline", () => {
  const ast = parse("! ! false | true && echo yes");
  const andOr = ast.commands[0].command;
  assert.ok(andOr.type === "AndOr");
  assert.deepEqual(andOr.operators, ["&&"]);
  const negation = andOr.commands[0];
  assert.ok(negation.type === "Negation");
  assert.ok(negation.command?.type === "Negation");
  const pipeline = negation.command.command;
  assert.ok(pipeline);
  assert.ok(pipeline.type === "Pipeline");
  assert.deepEqual([negation.pos, negation.end, pipeline.pos, pipeline.end], [0, 16, 4, 16]);
  assert.deepEqual(pipeline.operators, ["|"]);
  assert.deepEqual(
    pipeline.commands.map((command) => command.type === "Command" && command.name?.text),
    ["false", "true"],
  );
  assert.equal(ast.errors, undefined);
  assert.equal(print(ast), "! ! false | true && echo yes");
});

test("quoted and escaped bangs remain command words after negation", () => {
  for (const name of ["'!'", '"!"', "\\!"]) {
    const ast = parse(`! ! ${name} arg !`);
    const negation = ast.commands[0].command;
    assert.ok(negation.type === "Negation");
    assert.ok(negation.command?.type === "Negation");
    const command = negation.command.command;
    assert.ok(command);
    assert.ok(command.type === "Command");
    assert.equal(command.name?.text, name);
    assert.equal(command.name.value, "!");
    assert.deepEqual(
      command.suffix.map((word) => nodeOfType(word, "Assignment", "Word").text),
      ["arg", "!"],
    );
    assert.equal(ast.errors, undefined);
  }
});

test("bare negation runs preserve null commands and source ranges", () => {
  const cases: [string, number, number, number, string][] = [
    ["!", 1, 0, 1, "!"],
    ["  ! !  ", 2, 2, 5, "! !"],
    ["! ! !", 3, 0, 5, "! ! !"],
    ["! ! ! !", 4, 0, 7, "! ! ! !"],
    ["time ! !", 2, 0, 8, "time ! !"],
  ];
  for (const [source, count, pos, end, printed] of cases) {
    const ast = parse(source);
    const prefix = ast.commands[0].command;
    assert.deepEqual([prefix.pos, prefix.end], [pos, end], source);
    let node = prefix.type === "Time" ? prefix.command : prefix;
    let actual = 0;
    while (node?.type === "Negation") {
      actual++;
      node = node.command;
    }
    assert.equal(actual, count, source);
    assert.equal(node, undefined, source);
    assert.equal(ast.errors, undefined, source);
    assert.equal(print(ast), printed, source);
  }
});

test("bare even negation survives statement and conditional printing", () => {
  const cases = [
    ["false; ! !; echo $?", "false\n! !\necho $?"],
    ["if ! !; then echo yes; fi", "if ! !; then\n  echo yes\nfi"],
    ["! !\necho next", "! !\necho next"],
  ];
  for (const [source, expected] of cases) {
    const ast = parse(source);
    assert.equal(ast.errors, undefined, source);
    const printed = print(ast);
    assert.equal(printed, expected, source);
    const reparsed = parse(printed);
    assert.equal(reparsed.errors, undefined, source);
    assert.equal(print(reparsed), expected, source);
  }
});

test("repeated negation retains compound redirects and background execution", () => {
  const ast = parse("! ! { echo yes; } > out &");
  const statement = ast.commands[0];
  const negation = statement.command;
  assert.equal(statement.background, true);
  assert.ok(negation.type === "Negation");
  assert.ok(negation.command?.type === "Negation");
  assert.deepEqual([negation.pos, negation.end], [0, 23]);
  const command = negation.command.command;
  assert.ok(command);
  assert.ok(command.type === "Redirected");
  assert.equal(command.command.type, "BraceGroup");
  assert.deepEqual(
    redirectsOf(command).map((redirect) => [
      redirect.operator,
      nodeOfType(redirect, "HereString", "Redirect").target?.text,
    ]),
    [[">", "out"]],
  );
  assert.equal(ast.errors, undefined);
  assert.equal(print(ast), "! ! {\n  echo yes\n} > out &");
});

test("repeated negation preserves errors and ranges for unfinished pipelines", () => {
  const cases: [string, string, number, number][] = [
    ["! ! | echo after", "unexpected token '|'", 4, 3],
    ["! ! cmd |", "expected command after '|'", 9, 7],
    ["! ! cmd |&", "expected command after '|&'", 10, 7],
  ];
  for (const [source, message, pos, end] of cases) {
    const ast = parse(source);
    const negation = ast.commands[0].command;
    assert.ok(negation.type === "Negation");
    assert.ok(negation.command?.type === "Negation");
    assert.deepEqual([negation.pos, negation.end], [0, end], source);
    assert.equal(negation.command.command?.type, source.includes("cmd") ? "Command" : undefined, source);
    assert.deepEqual(ast.errors, [{ message, pos }], source);
  }
});
