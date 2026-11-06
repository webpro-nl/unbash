import assert from "node:assert/strict";
import test from "node:test";
import { LexContext, Lexer, Token } from "../src/lexer.ts";
import { parse } from "../src/parser.ts";
import { nodeOfType } from "./ast-helpers.ts";

test("failed subscript queries do not replay the remaining suffix", () => {
  const source = "a[x y\n".repeat(128) + "]";
  const lexer = new Lexer(source);
  const charCodeAt = String.prototype.charCodeAt;
  const lastIndexOf = String.prototype.lastIndexOf;
  let work = 0;
  String.prototype.charCodeAt = function (index: number): number {
    if (this === source) work++;
    return charCodeAt.call(this, index);
  };
  String.prototype.lastIndexOf = function (search: string, from?: number): number {
    if (this === source) work += Math.min(source.length, (from ?? source.length) + 1);
    return lastIndexOf.call(this, search, from);
  };
  try {
    assert.equal(lexer.findClosingBracket(3), -1);
    assert.equal(lexer.findClosingBracket(9), -1);
    assert.equal(lexer.getPos(), 0);
  } finally {
    String.prototype.charCodeAt = charCodeAt;
    String.prototype.lastIndexOf = lastIndexOf;
  }
  assert.ok(work < 2307, `counted ${work} units of suffix work`);
});

test("repeated failed subscript lookup keeps one nested diagnostic", () => {
  const lexer = new Lexer('a[x y\nb["$(echo ]');
  assert.equal(lexer.findClosingBracket(3), -1);
  assert.equal(lexer.findClosingBracket(3), -1);
  assert.equal(lexer.findClosingBracket(3), -1);
  assert.deepEqual(lexer.errors, [{ message: "unterminated command substitution", pos: 9 }]);
});

test("a failed subscript leaves valid following assignments and commands recoverable", () => {
  for (const [source, index] of [
    ['a[$x y # "\nb[$x z]=1\n# "\nprintf after', "$x z"],
    ["a[x y\nb[1 +\n 2]=1\nprintf after", "1 +\n 2"],
  ]) {
    const ast = parse(source);
    assert.deepEqual(ast.errors, [{ message: "unterminated array subscript", pos: 1 }]);
    assert.equal(ast.commands.length, 3);
    const assignment = nodeOfType(nodeOfType(ast.commands[1].command, "Command").prefix[0], "Assignment");
    assert.equal(assignment.name, "b");
    assert.equal(assignment.index?.text, index);
    assert.equal(nodeOfType(assignment.value, "Word").value, "1");
    assert.equal(nodeOfType(ast.commands[2].command, "Command").name?.value, "printf");
    assert.equal(nodeOfType(ast.commands[2].command, "Command").args[0].value, "after");
    JSON.stringify(ast);
    assert.deepEqual(ast.errors, [{ message: "unterminated array subscript", pos: 1 }]);
  }
});

test("bounded token values preserve recovery work across peek", () => {
  const counts = [32, 64, 128].map((size) => {
    const source = 'a[x y\nb["1" + 2]=2\n'.repeat(size) + "]\nprintf tail";
    const lexer = new Lexer(source);
    const charCodeAt = String.prototype.charCodeAt;
    let reads = 0;
    const values: string[] = [];
    String.prototype.charCodeAt = function (index: number): number {
      reads++;
      return charCodeAt.call(this, index);
    };
    try {
      for (;;) {
        const token = lexer.next(LexContext.CommandStart);
        if (token.token === Token.EOF) break;
        lexer.peek(LexContext.CommandStart);
        values.push(token.value);
      }
    } finally {
      String.prototype.charCodeAt = charCodeAt;
    }
    assert.deepEqual(values.slice(-2), ["printf", "tail"]);
    return reads;
  });
  assert.ok(counts[1] < counts[0] * 2.2, JSON.stringify(counts));
  assert.ok(counts[2] < counts[1] * 2.2, JSON.stringify(counts));
});

test("a malformed nested tail does not restore quadratic subscript recovery", () => {
  const counts = [64, 128, 256].map((size) => {
    const source = "a[x y\n".repeat(size) + 'b["$(echo ]';
    const charCodeAt = String.prototype.charCodeAt;
    let reads = 0;
    String.prototype.charCodeAt = function (index: number): number {
      reads++;
      return charCodeAt.call(this, index);
    };
    let ast: ReturnType<typeof parse>;
    try {
      ast = parse(source);
      const json = JSON.stringify(ast);
      assert.equal(JSON.stringify(ast), json);
    } finally {
      String.prototype.charCodeAt = charCodeAt;
    }
    assert.equal(ast.commands.length, size + 1);
    assert.equal(nodeOfType(ast.commands.at(-1)!.command, "Command").name?.text, 'b["$(echo ]');
    return reads;
  });
  assert.ok(counts[1] < counts[0] * 2.2, JSON.stringify(counts));
  assert.ok(counts[2] < counts[1] * 2.2, JSON.stringify(counts));
});
