import assert from "node:assert/strict";
import test from "node:test";
import { Lexer, LexContext, Token } from "../src/lexer.ts";
import { parse } from "../src/parser.ts";
import { print } from "../src/printer.ts";
import { nodeOfType, redirectsOf } from "./ast-helpers.ts";

test("20000 consecutive comments inside a test command do not exhaust the stack", () => {
  const source = `[[\n${"# comment\n".repeat(20000)}-n value\n]]\nprintf after`;
  const ast = parse(source);
  assert.equal(ast.errors, undefined);
  assert.equal(ast.commands.length, 2);
  const command = nodeOfType(ast.commands[0].command, "TestCommand");
  const expression = nodeOfType(command.expression, "TestUnary");
  assert.equal(expression.operator, "-n");
  assert.equal(expression.operand.text, "value");
  assert.deepEqual([expression.pos, expression.end], [source.indexOf("-n"), source.indexOf("value") + 5]);
  assert.deepEqual([command.pos, command.end], [0, source.indexOf("]]") + 2]);
  const following = nodeOfType(ast.commands[1].command, "Command");
  assert.equal(following.name?.text, "printf");
  assert.equal(following.pos, source.indexOf("printf"));
  assert.equal(print(ast), "[[ -n value ]]\nprintf after");
});

test("test comments preserve token offsets across blanks, continuations and CRLF", () => {
  for (const newline of ["\n", "\r\n"]) {
    const source = ` \t# first${newline}\t# second${newline} \\\n\n\tvalue # trailing`;
    const lexer = new Lexer(source);
    const token = lexer.peek(LexContext.TestMode);
    assert.deepEqual(
      [token.token, token.value, token.pos, token.end],
      [Token.Word, "value", source.indexOf("value"), source.indexOf("value") + 5],
    );
    assert.equal(lexer.next(LexContext.TestMode), token);
    for (let i = 0; i < 2; i++) {
      const eof = lexer.next(LexContext.TestMode);
      assert.deepEqual([eof.token, eof.value, eof.pos, eof.end], [Token.EOF, "", source.length, source.length]);
    }
  }
});

test("ordinary comments retain each newline and do not split embedded hashes", () => {
  for (const context of [LexContext.Normal, LexContext.CommandStart]) {
    const source = " \t# first\r\n\t# second\nword#literal # last";
    const lexer = new Lexer(source);
    for (const pos of [source.indexOf("\n"), source.indexOf("\n", source.indexOf("\n") + 1)]) {
      const token = lexer.next(context);
      assert.deepEqual([token.token, token.value, token.pos, token.end], [Token.Newline, "\n", pos, pos + 1]);
    }
    const word = lexer.next(context);
    assert.deepEqual(
      [word.token, word.value, word.pos, word.end],
      [Token.Word, "word#literal", source.indexOf("word"), source.indexOf("word") + 12],
    );
    const eof = lexer.next(context);
    assert.deepEqual([eof.token, eof.pos, eof.end], [Token.EOF, source.length, source.length]);
  }
});

test("comment EOF respects lexer windows and empty input", () => {
  for (const context of [LexContext.Normal, LexContext.TestMode]) {
    for (const source of ["", " \t", "# comment", "# first\r\n# last"]) {
      const end = source.length;
      const lexer = new Lexer(`prefix${source} ignored\nword`, 6, 6 + end);
      let token = lexer.next(context);
      if (context === LexContext.Normal && source.includes("\n")) token = lexer.next(context);
      assert.deepEqual([token.token, token.pos, token.end], [Token.EOF, 6 + end, 6 + end]);
    }
  }
});

test("ordinary comment newlines terminate commands and start pending heredocs", () => {
  const source =
    "printf before # first\n# second\ncat <<EOF # header\n# literal body\nEOF\n# after heredoc\nprintf after # eof";
  const ast = parse(source);
  assert.equal(ast.errors, undefined);
  assert.equal(ast.commands.length, 3);
  assert.deepEqual(
    ast.commands.map((statement) => nodeOfType(statement.command, "Command").name?.text),
    ["printf", "cat", "printf"],
  );
  const heredoc = nodeOfType(redirectsOf(ast.commands[1].command)[0], "HereDoc");
  assert.equal(heredoc.body.text, "# literal body\n");
  assert.deepEqual([heredoc.body.pos, heredoc.body.end], [source.indexOf("# literal"), source.indexOf("\nEOF") + 1]);
  assert.deepEqual(heredoc.closing, { pos: source.indexOf("\nEOF") + 1, end: source.indexOf("\nEOF") + 4 });
  assert.equal(ast.commands[2].pos, source.indexOf("printf after"));
  assert.equal(print(ast), "printf before\ncat << EOF\n# literal body\nEOF\nprintf after");
});
