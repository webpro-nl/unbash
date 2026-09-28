import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "../src/parser.ts";

for (const [source, pos, bodyType] of [
  ["f() echo hi", 4, "Command"],
  ["function f echo hi", 11, "Command"],
  ["function f() echo hi", 13, "Command"],
  ["f() A=1", 4, "Command"],
  ["f() > /dev/null", 4, "Command"],
  ["f() function g { :; }", 4, "Function"],
  ["f() g() { :; }", 4, "Function"],
  ["f() coproc { :; }", 4, "Coproc"],
  ["f() coproc echo hi", 4, "Coproc"],
] as const) {
  test(`invalid function body reports an error: ${source}`, () => {
    const ast = parse(source);
    assert.deepEqual(ast.errors, [{ message: "expected compound command as function body", pos }]);
    const fn = ast.commands[0].command;
    assert.equal(fn.type, "Function");
    if (fn.type !== "Function") assert.fail();
    assert.equal(fn.body.type, "CompoundList");
    if (fn.body.type !== "CompoundList") assert.fail();
    assert.deepEqual(
      fn.body.commands.map((statement) => statement.command.type),
      [bodyType],
    );
    assert.equal(fn.body.pos, pos);
    assert.equal(fn.body.end, source.length);
    assert.equal(fn.end, source.length);
  });
}

for (const [source, pos] of [
  ["f()", 3],
  ["f()\n", 4],
  ["function f", 10],
  ["function f()", 12],
  ["f() #comment\n", 13],
] as const) {
  test(`missing function body reports an error: ${JSON.stringify(source)}`, () => {
    const ast = parse(source);
    assert.deepEqual(ast.errors, [{ message: "expected compound command as function body", pos }]);
    const fn = ast.commands[0].command;
    assert.equal(fn.type, "Function");
    if (fn.type !== "Function") assert.fail();
    assert.deepEqual(fn.body, { type: "CompoundList", pos, end: pos, commands: [] });
  });
}

test("function body errors preserve following statements", () => {
  for (const [source, pos, kept] of [
    ["f() echo hi; recovered", 4, ["Command"]],
    ["f() ; recovered", 5, []],
  ] as const) {
    const ast = parse(source);
    assert.deepEqual(ast.errors, [{ message: "expected compound command as function body", pos }]);
    assert.equal(ast.commands.length, 2);
    const fn = ast.commands[0].command;
    assert.equal(fn.type, "Function");
    if (fn.type !== "Function") assert.fail();
    assert.equal(fn.body.type, "CompoundList");
    if (fn.body.type !== "CompoundList") assert.fail();
    assert.deepEqual(
      fn.body.commands.map((statement) => statement.command.type),
      kept,
    );
    const recovered = ast.commands[1].command;
    assert.equal(recovered.type, "Command");
    if (recovered.type !== "Command") assert.fail();
    assert.equal(recovered.name?.text, "recovered");
  }
});

test("functions accept compound bodies with each definition syntax", () => {
  for (const header of ["f()", "function f", "function f()"]) {
    for (const [body, bodyType] of [
      ["{ :; }", "BraceGroup"],
      ["( : )", "Subshell"],
      ["if :; then :; fi", "If"],
      ["for a in x; do :; done", "For"],
      ["for ((i=0; i<1; i++)); do :; done", "ArithmeticFor"],
      ["while :; do :; done", "While"],
      ["until :; do :; done", "While"],
      ["case x in x) :;; esac", "Case"],
      ["select a in x; do :; done", "Select"],
      ["[[ x ]]", "TestCommand"],
      ["((1))", "ArithmeticCommand"],
      ["{ :; } > /dev/null", "Redirected"],
      ["( : ) > /dev/null", "Redirected"],
    ] as const) {
      const source = `${header} ${body}`;
      const ast = parse(source);
      assert.equal(ast.errors, undefined, source);
      const fn = ast.commands[0].command;
      assert.equal(fn.type, "Function", source);
      if (fn.type !== "Function") assert.fail();
      assert.equal(fn.body.type, bodyType, source);
    }
  }
});

test("coproc bodies accept simple and compound commands with trailing redirects", () => {
  for (const [source, name, bodyType] of [
    ["coproc cmd arg", undefined, "Command"],
    ["coproc NAME cmd arg", undefined, "Command"],
    ["coproc >out", undefined, "Command"],
    ["coproc { :; }", undefined, "BraceGroup"],
    ["coproc NAME ( : )", "NAME", "Subshell"],
    ["coproc C { :; } >out", "C", "Redirected"],
  ] as const) {
    const ast = parse(source);
    assert.equal(ast.errors, undefined, source);
    const coproc = ast.commands[0].command;
    assert.equal(coproc.type, "Coproc", source);
    if (coproc.type !== "Coproc") assert.fail();
    assert.equal(coproc.name?.text, name, source);
    assert.equal(coproc.body.type, bodyType, source);
  }
  // A name precedes only a compound command, so this pipe belongs to the enclosing pipeline.
  const piped = parse("coproc cmd | cat");
  assert.equal(piped.errors, undefined);
  assert.equal(piped.commands[0].command.type, "Pipeline");
});

for (const [source, pos, bodyType] of [
  ["coproc f() { :; }", 7, "Function"],
  ["coproc function f { :; }", 7, "Function"],
  ["coproc coproc x", 7, "Coproc"],
] as const) {
  test(`invalid coproc body reports an error: ${source}`, () => {
    const ast = parse(source);
    assert.deepEqual(ast.errors, [{ message: "expected command after 'coproc'", pos }]);
    const coproc = ast.commands[0].command;
    assert.equal(coproc.type, "Coproc");
    if (coproc.type !== "Coproc") assert.fail();
    assert.equal(coproc.name, undefined);
    assert.equal(coproc.body.type, "CompoundList");
    if (coproc.body.type !== "CompoundList") assert.fail();
    assert.deepEqual(
      coproc.body.commands.map((statement) => statement.command.type),
      [bodyType],
    );
    assert.equal(coproc.body.pos, pos);
    assert.equal(coproc.body.end, source.length);
    assert.equal(coproc.end, source.length);
  });
}

for (const [source, pos, statements] of [
  ["coproc", 6, 1],
  ["coproc\n", 6, 1],
  ["coproc ; recovered", 6, 2],
] as const) {
  test(`missing coproc body reports an error: ${JSON.stringify(source)}`, () => {
    const ast = parse(source);
    assert.deepEqual(ast.errors, [{ message: "expected command after 'coproc'", pos }]);
    assert.equal(ast.commands.length, statements);
    const coproc = ast.commands[0].command;
    assert.equal(coproc.type, "Coproc");
    if (coproc.type !== "Coproc") assert.fail();
    assert.equal(coproc.name, undefined);
    assert.deepEqual(coproc.body, { type: "CompoundList", pos, end: pos, commands: [] });
    assert.equal(coproc.end, pos);
  });
}
