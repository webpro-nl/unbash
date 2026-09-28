import { nodeOfType } from "./ast-helpers.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "../src/parser.ts";
import { print } from "../src/printer.ts";

test("simple commands own ordered prefix and suffix items", () => {
  const source = "A=1 >out B=2 export C=3 2>&1 D=4";
  const script = parse(source);
  const command = script.commands[0].command;
  assert.equal(command.type, "Command");
  if (command.type !== "Command") assert.fail();
  assert.equal(command.name?.text, "export");
  assert.deepEqual(
    command.prefix.map((item) => item.type),
    ["Assignment", "Redirect", "Assignment"],
  );
  assert.deepEqual(
    command.suffix.map((item) => item.type),
    ["Assignment", "Redirect", "Assignment"],
  );
  assert.equal(Object.hasOwn(command, "redirects"), false);
  assert.equal("redirects" in script.commands[0], false);
  assert.equal(print(script), "A=1 > out B=2 export C=3 2>&1 D=4");
  assert.equal((JSON.stringify(script).match(/"type":"Redirect"/g) ?? []).length, 2);
});

test("redirects keep their position among arguments", () => {
  const source = "echo one >out two 2>&1 three";
  const command = parse(source).commands[0].command;
  assert.equal(command.type, "Command");
  if (command.type !== "Command") assert.fail();
  assert.deepEqual(
    command.suffix.map((item) => item.type),
    ["Word", "Redirect", "Word", "Redirect", "Word"],
  );
  assert.equal(print(parse(source)), "echo one > out two 2>&1 three");
});

test("compound redirects belong to their pipeline member", () => {
  const pipeline = parse("{ :; } >a | cat >b").commands[0].command;
  assert.equal(pipeline.type, "Pipeline");
  if (pipeline.type !== "Pipeline") assert.fail();
  const first = pipeline.commands[0];
  assert.equal(first.type, "Redirected");
  if (first.type !== "Redirected") assert.fail();
  assert.equal(first.command.type, "BraceGroup");
  assert.equal(nodeOfType(first.redirects[0], "HereString", "Redirect").target?.text, "a");
  assert.equal(pipeline.commands[1].type, "Command");
});

test("function and coprocess redirects belong to their bodies", () => {
  for (const source of ["f() { :; } >out", "function f ( : ) >out", "coproc C { :; } >out"]) {
    const command = parse(source).commands[0].command;
    assert.ok(command.type === "Function" || command.type === "Coproc", source);
    if (command.type !== "Function" && command.type !== "Coproc") assert.fail();
    assert.equal(command.body.type, "Redirected", source);
    assert.equal("redirects" in command, false, source);
    assert.equal(print(parse(print(parse(source)))), print(parse(source)), source);
  }
});

test("prefix heredocs wait for a multiline command header", () => {
  const source = '<<EOF A=1 cat "first\nsecond" >out\nbody\nEOF';
  const script = parse(source);
  assert.equal(script.errors, undefined);
  assert.equal(print(script), '<< EOF A=1 cat "first\nsecond" > out\nbody\nEOF');
});
