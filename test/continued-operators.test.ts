import assert from "node:assert/strict";
import test from "node:test";
import { Lexer, Token } from "../src/lexer.ts";
import { parse } from "../src/parser.ts";
import { print } from "../src/printer.ts";
import { verify } from "./verify.ts";

const continuation = "\\\n";
const caseScript = "case x in\n  x)\n    a\n    @\n  y)\n    b\n    ;;\nesac";

function variants(op: string): string[] {
  const spellings = [op];
  for (let i = 1; i < op.length; i++) spellings.push(op.slice(0, i) + continuation + op.slice(i));
  spellings.push([...op].join(continuation.repeat(2)));
  return spellings;
}

for (const [op, tokenType, script] of [
  ["&&", Token.And, "false @ printf wrong"],
  ["||", Token.Or, "false @ printf recovered"],
  ["|&", Token.Pipe, "echo ok @ cat"],
  [";;", Token.DoubleSemi, caseScript],
  [";&", Token.SemiAmp, caseScript],
  [";;&", Token.DoubleSemiAmp, caseScript],
  ["&>", Token.Redirect, "cmd @ out"],
  ["&>>", Token.Redirect, "cmd @ out"],
  [">>", Token.Redirect, "cmd @ out"],
  [">|", Token.Redirect, "cmd @ out"],
  [">&", Token.Redirect, "cmd @1"],
  ["<&", Token.Redirect, "cmd @0"],
  ["<>", Token.Redirect, "cmd @ file"],
  ["<<", Token.Redirect, "cat @ EOF\npayload\nEOF"],
  ["<<-", Token.Redirect, "cat @ EOF\n\tpayload\nEOF"],
  ["<<<", Token.Redirect, "cat @ payload"],
] as const) {
  test(`continued ${op} preserves token identity, physical offsets and printed syntax`, () => {
    for (const spelling of variants(op)) {
      const lexer = new Lexer(`cmd ${spelling} target`);
      lexer.next();
      const token = lexer.next();
      assert.equal(token.token, tokenType, spelling);
      assert.equal(token.value, op);
      assert.equal(token.pos, 4);
      if (tokenType === Token.Redirect) {
        assert.equal(token.content, "target");
        assert.equal(token.targetPos, 5 + spelling.length);
        assert.equal(token.targetEnd, 11 + spelling.length);
        assert.equal(token.end, token.targetEnd);
      } else {
        assert.equal(token.end, 4 + spelling.length);
        const following = lexer.next();
        assert.equal(following.value, "target");
        assert.equal(following.pos, 5 + spelling.length);
      }

      const source = script.replace("@", spelling);
      const ast = parse(source);
      assert.equal(ast.errors, undefined, source);
      assert.equal(verify(source, ast), source);
      assert.equal(print(ast), script.replace("@", op));
    }
  });
}

test("operator lookahead does not consume whitespace, comments, or escaped backslashes", () => {
  for (const separator of [" ", "\t", "\n", " # comment\n", continuation + " ", "\\\\\n"]) {
    for (const [first, token] of [
      ["&", Token.Amp],
      ["|", Token.Pipe],
      [";", Token.Semi],
    ] as const) {
      const actual = new Lexer(first + separator + first).next();
      assert.equal(actual.token, token);
      assert.equal(actual.value, first);
      assert.equal(actual.pos, 0);
      assert.equal(actual.end, 1);
    }
  }
});

test("continued redirects retain quoted, escaped, and expanded targets", () => {
  for (const [target, printedTarget] of [
    ["'out file'", "'out file'"],
    ['"out file"', '"out file"'],
    ["out\\ file", "'out file'"],
    ["out" + continuation + "file", "'outfile'"],
    ['"$(printf output)"', '"$(printf output)"'],
  ]) {
    for (const op of ["&>", "&>>", ">>"]) {
      const operator = [...op].join(continuation);
      const source = `printf payload ${operator} ${target}`;
      const ast = parse(source);
      assert.equal(ast.errors, undefined);
      assert.equal(verify(source, ast), source);
      assert.equal(print(ast), `printf payload ${op} ${printedTarget}`);
    }
  }
});

test("ordinary process substitutions and quoted operator characters retain their meaning", () => {
  for (const source of [
    "cat < <(printf payload)",
    "printf payload > >(cat)",
    "printf '%s' '&" + continuation + "&'",
    'printf "%s" "&' + continuation + '&"',
    "printf '%s' \\&\\&",
  ]) {
    const ast = parse(source);
    assert.equal(ast.errors, undefined, source);
    assert.equal(verify(source, ast), source);
    assert.equal(print(ast), source);
  }
});

test("continued combined redirects preserve process substitution targets", () => {
  for (const op of ["&>", "&>>"]) {
    for (const operator of variants(op)) {
      for (const target of ["<(printf payload)", ">(cat)"]) {
        const source = `cmd ${operator} ${target}`;
        const lexer = new Lexer(source);
        lexer.next();
        const token = lexer.next();
        assert.equal(token.value, op);
        assert.equal(token.content, target);
        assert.equal(token.targetPos, source.indexOf(target));
        assert.equal(token.targetEnd, source.length);
        const ast = parse(source);
        assert.equal(ast.errors, undefined);
        assert.equal(verify(source, ast), source);
        assert.equal(print(ast), `cmd ${op} ${target}`);
      }
    }
  }
});
