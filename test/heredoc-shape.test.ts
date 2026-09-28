import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "../src/parser.ts";
import { print } from "../src/printer.ts";
import { redirectsOf } from "./ast-helpers.ts";

test("redirect kinds keep descriptors and targets in their own variants", () => {
  const ast = parse("cmd 02>out {fd}<<<\"$value\" <<'E'\n$name\nE\n");
  const redirects = redirectsOf(ast.commands[0].command);
  assert.deepEqual(
    redirects.map((redirect) => redirect.type),
    ["Redirect", "HereString", "HereDoc"],
  );
  assert.deepEqual(
    redirects.map((redirect) => redirect.descriptor),
    [
      { type: "FileDescriptor", pos: 4, end: 6, value: 2 },
      { type: "FileDescriptorVariable", pos: 11, end: 15, name: "fd" },
      undefined,
    ],
  );
  const heredoc = redirects[2];
  assert.ok(heredoc.type === "HereDoc");
  assert.deepEqual(heredoc.delimiter, {
    type: "HereDocDelimiter",
    text: "'E'",
    value: "E",
    quoted: true,
    pos: 29,
    end: 32,
  });
  assert.deepEqual([heredoc.pos, heredoc.end], [27, 32]);
  assert.deepEqual(
    [heredoc.body.type, heredoc.body.pos, heredoc.body.end, heredoc.body.text],
    ["HereDocBody", 33, 39, "$name\n"],
  );
  assert.equal(heredoc.body.parts, undefined);
  assert.deepEqual(heredoc.closing, { pos: 39, end: 40 });
  assert.equal("target" in heredoc, false);
  assert.equal("content" in heredoc, false);
  assert.equal("heredocQuoted" in heredoc, false);
  assert.equal(ast.errors, undefined);
});

test("heredoc body and closing ranges include empty and unterminated forms", () => {
  for (const [source, body, closing] of [
    ["cat <<-E\n\t$x\n\tE\n", [9, 13, "\t$x\n"], { pos: 14, end: 15 }],
    ["cat <<''\n\n", [9, 9, ""], { pos: 9, end: 9 }],
    ["cat <<''\n", [9, 9, ""], undefined],
    ["cat <<E", [7, 7, ""], undefined],
    ["cat <<E\nbody", [8, 12, "body"], undefined],
    ["cat <<E\nE", [8, 8, ""], { pos: 8, end: 9 }],
  ] as const) {
    const ast = parse(source);
    const redirect = redirectsOf(ast.commands[0].command)[0];
    assert.ok(redirect.type === "HereDoc", source);
    assert.deepEqual([redirect.body.pos, redirect.body.end, redirect.body.text], body, source);
    assert.equal(source.slice(redirect.body.pos, redirect.body.end), redirect.body.text, source);
    assert.deepEqual(redirect.closing, closing, source);
    assert.equal(print(parse(print(ast))), print(ast), source);
  }
});

test("heredoc delimiter syntax is literal and has no expandable child", () => {
  for (const delimiter of ["$name", "$(cmd)", "$((1+2))", "`cmd`"]) {
    const source = `cat <<${delimiter}\ntext\n${delimiter}\n`;
    const ast = parse(source);
    const redirect = redirectsOf(ast.commands[0].command)[0];
    assert.ok(redirect.type === "HereDoc");
    assert.equal(redirect.delimiter?.text, delimiter);
    assert.equal(redirect.delimiter?.value, delimiter);
    assert.equal(redirect.delimiter?.quoted, false);
    assert.equal("parts" in redirect.delimiter!, false);
    assert.equal(redirect.body.text, "text\n");
    assert.equal(redirect.body.parts, undefined);
    assert.equal(ast.errors, undefined);
  }
});

test("every queued heredoc owns its raw body and closing range", () => {
  const source = "cmd <<A <<B\nfirst\nA\nsecond\nB\n";
  const ast = parse(source);
  const redirects = redirectsOf(ast.commands[0].command);
  assert.deepEqual(
    redirects.map(
      (redirect) =>
        redirect.type === "HereDoc" && [redirect.body.pos, redirect.body.end, redirect.body.text, redirect.closing],
    ),
    [
      [12, 18, "first\n", { pos: 18, end: 19 }],
      [20, 27, "second\n", { pos: 27, end: 28 }],
    ],
  );
  assert.equal(ast.errors, undefined);
});

test("heredoc JSON owns body syntax once regardless of lazy access order", () => {
  const source = "cat <<E\nhello $name\nE";
  const ast = parse(source);
  const redirect = redirectsOf(ast.commands[0].command)[0];
  assert.ok(redirect.type === "HereDoc");
  const before = JSON.stringify(ast);
  assert.deepEqual(
    redirect.body.parts?.map((part) => [part.type, part.pos, part.end, part.text]),
    [
      ["Literal", 8, 14, "hello "],
      ["SimpleExpansion", 14, 19, "$name"],
      ["Literal", 19, 20, "\n"],
    ],
  );
  assert.equal(JSON.stringify(ast), before);
  assert.equal(print(ast), "cat << E\nhello $name\nE");
});
