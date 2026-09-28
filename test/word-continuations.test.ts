import { nodeOfType } from "./ast-helpers.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "../src/parser.ts";
import { print } from "../src/printer.ts";

test("word parts preserve empty literal spans containing line continuations", () => {
  for (const source of [
    'echo "x"\\\n"y"',
    "echo 'x'\\\n'y'",
    'echo "x"\\\n$value',
    'echo "x"\\\n`printf y`',
    'echo "x"\\\n{a,b}',
    'echo "x"\\\n@(a|b)',
    'echo "x"\\\n',
  ]) {
    const ast = parse(source);
    assert.equal(ast.errors, undefined, source);
    const node = ast.commands[0].command;
    assert.equal(node.type, "Command");
    if (node.type !== "Command") assert.fail(source);
    const parts = nodeOfType(node.suffix[0], "Word").parts;
    assert.equal(parts?.[1].type, "Literal", source);
    if (parts?.[1].type !== "Literal") assert.fail(source);
    assert.equal(parts[1].value, "", source);
    assert.equal(parts[1].text, "\\\n", source);
    assert.equal(print(ast), source);
  }
});

test("literal continuations do not create structured parts on their own", () => {
  const node = parse("echo a\\\nb").commands[0].command;
  assert.equal(node.type, "Command");
  if (node.type !== "Command") assert.fail();
  assert.equal(nodeOfType(node.suffix[0], "Word").parts, undefined);
  assert.equal(nodeOfType(node.suffix[0], "Word").value, "ab");
});
