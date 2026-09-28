import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "../src/parser.ts";
import { print } from "../src/printer.ts";

test("for and select distinguish an omitted word list from an explicit empty list", () => {
  for (const keyword of ["for", "select"]) {
    for (const [head, expected] of [
      ["item", undefined],
      ["item in", []],
      ["item in one two", ["one", "two"]],
    ] as const) {
      for (const separator of ["; ", "\n"]) {
        const source = `${keyword} ${head}${separator}do echo "$item"; done`;
        const ast = parse(source);
        const loop = ast.commands[0].command;
        assert.ok(loop.type === "For" || loop.type === "Select", source);
        assert.deepEqual(
          loop.wordlist?.map((word) => word.text),
          expected,
          source,
        );
        assert.equal(ast.errors, undefined, source);
        const printed = `${keyword} ${head}; do\n  echo "$item"\ndone`;
        assert.equal(print(ast), printed, source);
        assert.equal(print(parse(printed)), printed, source);
        assert.deepEqual(
          JSON.parse(JSON.stringify(ast)).commands[0].command.wordlist?.map((word: { text: string }) => word.text),
          expected,
          source,
        );
      }
    }
  }
});

test("brace loop bodies retain explicit empty lists", () => {
  for (const keyword of ["for", "select"]) {
    const source = `${keyword} item in; { echo "$item"; }`;
    const ast = parse(source);
    const loop = ast.commands[0].command;
    assert.ok(loop.type === "For" || loop.type === "Select", source);
    assert.deepEqual(loop.wordlist, [], source);
    assert.equal(print(ast), `${keyword} item in; do\n  echo "$item"\ndone`, source);
    assert.equal(ast.errors, undefined, source);
  }
});
