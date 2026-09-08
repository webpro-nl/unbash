import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "../src/parser.ts";
import { print } from "../src/printer.ts";

test("repeated negation applies to the entire pipeline", () => {
  const ast = parse("! ! false | true && echo yes");
  const andOr = ast.commands[0].command;
  assert.ok(andOr.type === "AndOr");
  assert.deepEqual(andOr.operators, ["&&"]);
  const pipeline = andOr.commands[0];
  assert.ok(pipeline.type === "Pipeline");
  assert.equal(pipeline.negated, false);
  assert.deepEqual([pipeline.pos, pipeline.end], [0, 16]);
  assert.deepEqual(pipeline.operators, ["|"]);
  assert.deepEqual(
    pipeline.commands.map((command) => command.type === "Command" && command.name?.text),
    ["false", "true"],
  );
  assert.equal(ast.errors, undefined);
  assert.equal(print(ast), "false | true && echo yes");
});

test("quoted and escaped bangs remain command words after negation", () => {
  for (const name of ["'!'", '"!"', "\\!"]) {
    const ast = parse(`! ! ${name} arg !`);
    const pipeline = ast.commands[0].command;
    assert.ok(pipeline.type === "Pipeline");
    assert.equal(pipeline.negated, false);
    const command = pipeline.commands[0];
    assert.ok(command.type === "Command");
    assert.equal(command.name?.text, name);
    assert.equal(command.name.value, "!");
    assert.deepEqual(
      command.suffix.map((word) => word.text),
      ["arg", "!"],
    );
    assert.equal(ast.errors, undefined);
  }
});

test("bare negation runs preserve null commands and source ranges", () => {
  const cases: [string, boolean, number, number, string][] = [
    ["!", true, 0, 1, "!"],
    ["  ! !  ", false, 2, 5, "! !"],
    ["! ! !", true, 0, 5, "!"],
    ["! ! ! !", false, 0, 7, "! !"],
    ["time ! !", false, 0, 8, "time"],
  ];
  for (const [source, negated, pos, end, printed] of cases) {
    const ast = parse(source);
    const pipeline = ast.commands[0].command;
    assert.ok(pipeline.type === "Pipeline");
    assert.equal(pipeline.negated, negated, source);
    assert.deepEqual([pipeline.pos, pipeline.end], [pos, end], source);
    assert.deepEqual(pipeline.commands, [], source);
    assert.deepEqual(pipeline.operators, [], source);
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
  const pipeline = statement.command;
  assert.equal(statement.background, true);
  assert.ok(pipeline.type === "Pipeline");
  assert.equal(pipeline.negated, false);
  assert.deepEqual([pipeline.pos, pipeline.end], [0, 23]);
  const command = pipeline.commands[0];
  assert.ok(command.type === "Statement");
  assert.equal(command.command.type, "BraceGroup");
  assert.deepEqual(
    command.redirects.map((redirect) => [redirect.operator, redirect.target?.text]),
    [[">", "out"]],
  );
  assert.equal(ast.errors, undefined);
  assert.equal(print(ast), "{\n  echo yes\n} > out &");
});

test("repeated negation preserves errors and ranges for unfinished pipelines", () => {
  const cases: [string, string, number, number][] = [
    ["! ! | echo after", "unexpected token '|'", 4, 3],
    ["! ! cmd |", "expected command after '|'", 9, 7],
    ["! ! cmd |&", "expected command after '|&'", 10, 7],
  ];
  for (const [source, message, pos, end] of cases) {
    const ast = parse(source);
    const pipeline = ast.commands[0].command;
    assert.ok(pipeline.type === "Pipeline");
    assert.equal(pipeline.negated, false, source);
    assert.deepEqual([pipeline.pos, pipeline.end], [0, end], source);
    assert.deepEqual(pipeline.operators, [], source);
    assert.deepEqual(ast.errors, [{ message, pos }], source);
  }
});
