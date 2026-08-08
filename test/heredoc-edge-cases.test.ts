import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "../src/parser.ts";
import { verify } from "./verify.ts";
import type { Command, Redirect, Statement } from "../src/types.ts";

const roundtrip = (src: string) => {
  const ast = parse(src);
  assert.equal(verify(src, ast), src);
  return ast;
};

const getRedirects = (src: string): Redirect[] => {
  const ast = parse(src);
  const cmd = ast.commands[0].command as Command;
  return cmd.redirects;
};

// --- Multiple heredocs on one line ---

test("two heredocs on one command", () => {
  const src = "cmd <<A <<B\nfirst\nA\nsecond\nB\n";
  const ast = roundtrip(src);
  const cmd = ast.commands[0].command as Command;
  assert.equal(cmd.redirects.length, 2);
  assert.equal(cmd.redirects[0].content, "first\n");
  assert.equal(cmd.redirects[1].content, "second\n");
});

test("two heredocs on separate commands", () => {
  const src = "cat <<A; cat <<B\ncontentA\nA\ncontentB\nB\n";
  const ast = roundtrip(src);
  const r0 = (ast.commands[0].command as Command).redirects[0];
  const r1 = (ast.commands[1].command as Command).redirects[0];
  assert.equal(r0.content, "contentA\n");
  assert.equal(r1.content, "contentB\n");
});

test("heredoc after pipe with second heredoc", () => {
  const src = "cat <<A | grep x <<B\nalpha\nA\nbeta\nB\n";
  roundtrip(src);
});

// --- Heredocs in compound commands ---

test("heredoc inside if body", () => {
  const src = "if true; then cat <<EOF\nhello\nEOF\nfi\n";
  roundtrip(src);
});

test("heredoc inside while loop", () => {
  const src = "while read line; do echo $line; done <<EOF\nline1\nline2\nEOF\n";
  const ast = roundtrip(src);
  const stmt = ast.commands[0] as Statement;
  assert.equal(stmt.redirects.length, 1);
  assert.equal(stmt.redirects[0].content, "line1\nline2\n");
});

test("heredoc inside function", () => {
  const src = "f() {\ncat <<EOF\nbody text\nEOF\n}\n";
  roundtrip(src);
});

// --- Heredoc delimiter edge cases ---

test("heredoc with hyphenated delimiter", () => {
  const src = "cat <<END-OF-DATA\nstuff\nEND-OF-DATA\n";
  const r = getRedirects(src)[0];
  assert.equal(r.content, "stuff\n");
});

test("heredoc with underscore delimiter", () => {
  const src = "cat <<__EOF__\nstuff\n__EOF__\n";
  const r = getRedirects(src)[0];
  assert.equal(r.content, "stuff\n");
});

test("heredoc with numeric delimiter", () => {
  const src = "cat <<123\nstuff\n123\n";
  const r = getRedirects(src)[0];
  assert.equal(r.content, "stuff\n");
});

// --- Strip heredoc with tabs ---

test("<<- strips leading tabs from content and delimiter", () => {
  const src = "cat <<-EOF\n\t\thello\n\t\tworld\n\tEOF\n";
  const r = getRedirects(src)[0];
  assert.equal(r.operator, "<<-");
  assert.ok(r.content!.includes("hello"));
});

// --- Heredoc content edge cases ---

test("heredoc with line matching delimiter prefix", () => {
  const src = "cat <<EOF\nEOFoo is not the end\nEOF\n";
  const r = getRedirects(src)[0];
  assert.equal(r.content, "EOFoo is not the end\n");
});

test("heredoc with blank lines", () => {
  const src = "cat <<EOF\n\n\nbetween blanks\n\n\nEOF\n";
  const r = getRedirects(src)[0];
  assert.equal(r.content, "\n\nbetween blanks\n\n\n");
});

test("heredoc with only newlines", () => {
  const src = "cat <<EOF\n\n\n\nEOF\n";
  const r = getRedirects(src)[0];
  assert.equal(r.content, "\n\n\n");
});

// --- Herestring edge cases ---

test("herestring with double-quoted value", () => {
  const src = 'read x <<< "hello world"';
  const ast = roundtrip(src);
  const cmd = ast.commands[0].command as Command;
  assert.equal(cmd.redirects[0].operator, "<<<");
});

test("herestring with variable expansion", () => {
  const src = "read x <<< $var";
  roundtrip(src);
});

test("herestring with command substitution", () => {
  const src = "read x <<< $(echo hello)";
  roundtrip(src);
});

// --- Heredoc combined with other redirects ---

test("heredoc with stderr redirect on same command", () => {
  const src = "cmd <<EOF 2>/dev/null\nbody\nEOF\n";
  const ast = roundtrip(src);
  const cmd = ast.commands[0].command as Command;
  assert.equal(cmd.redirects.length, 2);
});

test("heredoc after pipe", () => {
  const src = "cat <<EOF | grep hello\nhello world\ngoodbye world\nEOF\n";
  roundtrip(src);
});

// --- Heredoc delimiter edge cases (tokenizer) ────────────────────────

test("single-quoted heredoc delimiter suppresses expansion", () => {
  const ast = parse("cat <<'END'\n$not_expanded\nEND");
  const cmd = ast.commands[0].command as Command;
  assert.equal(cmd.redirects?.[0].content, "$not_expanded\n");
});

test("double-quoted heredoc delimiter", () => {
  const ast = parse('cat <<"END"\n$not_expanded\nEND');
  const cmd = ast.commands[0].command as Command;
  assert.ok(cmd.redirects?.[0].content?.includes("$not_expanded"));
});

test("backslash-escaped heredoc delimiter", () => {
  const ast = parse("cat <<\\EOF\nbody\nEOF");
  const cmd = ast.commands[0].command as Command;
  assert.equal(cmd.redirects?.[0].content, "body\n");
});

test("heredoc delimiter with underscores", () => {
  const ast = parse("cat <<_LONG_DELIMITER_\nbody\n_LONG_DELIMITER_");
  const cmd = ast.commands[0].command as Command;
  assert.equal(cmd.redirects?.[0].content, "body\n");
});

test("heredoc delimiter partial match is not terminator", () => {
  const ast = parse("cat <<EOF\nEOF_not_end\nEOF");
  const cmd = ast.commands[0].command as Command;
  assert.equal(cmd.redirects?.[0].content, "EOF_not_end\n");
});

test("two heredocs on one line (tokenizer)", () => {
  const ast = parse("cat <<A; cat <<B\n1\nA\n2\nB");
  assert.equal(ast.commands.length, 2);
});

// --- Delimiter quote removal ---
// Bash forms the delimiter from the word after quote removal: quote and escape
// segments may appear anywhere in the word, any of them makes the body literal,
// and inside double quotes a backslash is removed only before $ ` " \.

test("escaped space inside heredoc delimiter", () => {
  const src = "cat <<E\\ OF\nbody\nE OF";
  const cmd = parse(src).commands[0].command as Command;
  assert.equal(cmd.suffix.length, 0);
  const r = cmd.redirects[0];
  assert.equal(r.target?.value, "E OF");
  assert.equal(r.heredocQuoted, true);
  assert.equal(r.content, "body\n");
});

test("mid-word escape and quotes in heredoc delimiter", () => {
  for (const [src, value] of [
    ["cat <<E\\OF\nbody\nEOF", "EOF"],
    ['cat <<E"O"F\nbody\nEOF', "EOF"],
    ["cat <<E'O F'\nbody\nEO F", "EO F"],
    ["cat <<'E'x\nbody\nEx", "Ex"],
  ] as const) {
    const r = (parse(src).commands[0].command as Command).redirects[0];
    assert.equal(r.target?.value, value, src);
    assert.equal(r.heredocQuoted, true, src);
    assert.equal(r.content, "body\n", src);
  }
});

test("double-quoted heredoc delimiter keeps non-special backslashes", () => {
  const r = (parse('cat <<"E\\OF"\nbody\nE\\OF').commands[0].command as Command).redirects[0];
  assert.equal(r.target?.value, "E\\OF");
  assert.equal(r.content, "body\n");
  const dq = (parse('cat <<"E\\\\OF"\nbody\nE\\OF').commands[0].command as Command).redirects[0];
  assert.equal(dq.target?.value, "E\\OF");
  assert.equal(dq.content, "body\n");
});

test("unquoted delimiter forms stay unquoted", () => {
  for (const [src, value] of [
    ["cat <<EOF\nbody\nEOF", "EOF"],
    ["cat <<$var\nbody\n$var", "$var"],
  ] as const) {
    const r = (parse(src).commands[0].command as Command).redirects[0];
    assert.equal(r.target?.value, value, src);
    assert.notEqual(r.heredocQuoted, true, src);
    assert.equal(r.content, "body\n", src);
  }
});

test("leading backslash heredoc delimiter still quotes", () => {
  const r = (parse("cat <<\\EOF\nbody\nEOF").commands[0].command as Command).redirects[0];
  assert.equal(r.target?.value, "EOF");
  assert.equal(r.heredocQuoted, true);
  assert.equal(r.content, "body\n");
});

test("dollar-quoted heredoc delimiters use their decoded value", () => {
  for (const src of ["cat <<$'\\x45OF'\nbody\nEOF", 'cat <<$"EOF"\nbody\nEOF']) {
    const ast = parse(src);
    assert.equal(ast.errors, undefined, src);
    const r = (ast.commands[0].command as Command).redirects[0];
    assert.equal(r.target?.value, "EOF", src);
    assert.equal(r.heredocQuoted, true, src);
    assert.equal(r.content, "body\n", src);
  }
});

test("backslash-newline joins heredoc delimiter words", () => {
  for (const [src, quoted] of [
    ["cat <<E\\\nOF\nbody\nEOF", false],
    ['cat <<"E\\\nOF"\nbody\nEOF', true],
  ] as const) {
    const ast = parse(src);
    assert.equal(ast.errors, undefined, src);
    const r = (ast.commands[0].command as Command).redirects[0];
    assert.equal(r.target?.value, "EOF", src);
    assert.equal(r.heredocQuoted === true, quoted, src);
    assert.equal(r.content, "body\n", src);
  }
});

test("substitution syntax remains literal in heredoc delimiters", () => {
  for (const delimiter of ["$(foo)", "$((1+2))"]) {
    const src = `cat <<${delimiter}\nbody\n${delimiter}`;
    const ast = parse(src);
    assert.equal(ast.errors, undefined, src);
    const r = (ast.commands[0].command as Command).redirects[0];
    assert.equal(r.target?.value, delimiter, src);
    assert.notEqual(r.heredocQuoted, true, src);
    assert.equal(r.content, "body\n", src);
  }
});

test("inside a substitution a delimiter line with a later paren ends the body", () => {
  // Bash ends the body at a line that starts with the delimiter and has a `)` anywhere on
  // the same logical line, resuming right after the delimiter text. Continuations are
  // joined first, but only when the delimiter was written unquoted.
  for (const source of [
    "<(<<a\na )",
    "<(<<a\na\\\n)!",
    "<(<<a\na\\\n[)",
    "<(<<a\na?&\\\n)",
    '"$(a<<X\nXb)"',
    'echo "$(cat <<EOF\nEOF (:)\n)"',
    'echo "$(cat <<EOF\nzz)\nEOF\n)"',
    "<(<<abc\nab\\\nc )",
  ])
    assert.equal(parse(source).errors, undefined, JSON.stringify(source));

  // Still rejected, exactly as bash rejects them.
  for (const source of [
    'echo "$(cat <<EOF\nAAA\nEOFx\nBBB)"',
    'echo "$(cat <<EOF\nEOF (\n)"',
    "<(<<'a'\na\\\n)",
    "<(<<a\na\\\\\n)",
  ])
    assert.ok(parse(source).errors, JSON.stringify(source));
});

test("a backquoted heredoc delimiter is literal, newlines and all", () => {
  // Bash never expands a delimiter: `cat <<`x`` wants the literal delimiter `` `x` ``, and
  // a backquoted run is taken whole, so it can span lines without being run as a command.
  const backtick = (parse(": <<`'\n`\n\n").commands[0].command as Command).redirects[0];
  assert.equal(backtick.target?.text, "`'\n`");
  assert.equal(backtick.target?.value, "`'\n`");
  assert.equal(backtick.target?.parts, undefined);
  assert.equal(parse(": <<`'\n`\n\n").errors, undefined);

  const command = (parse("cat <<`echo D`\nbody\n`echo D`\n").commands[0].command as Command).redirects[0];
  assert.equal(command.target?.value, "`echo D`");
  assert.equal(command.content, "body\n");

  // Quote removal still applies, and it does not make the delimiter expandable.
  const dollar = (parse("cat <<$x\nbody\n$x").commands[0].command as Command).redirects[0];
  assert.equal(dollar.target?.value, "$x");
  assert.equal(dollar.target?.parts, undefined);
});
