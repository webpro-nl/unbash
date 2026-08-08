import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "../src/parser.ts";
import { print } from "../src/printer.ts";
import type { Command } from "../src/types.ts";
import { computeWordParts } from "../src/parts.ts";
import { verify } from "./verify.ts";

const getCmd = (ast: ReturnType<typeof parse>, i = 0) => ast.commands[i].command as Command;
const wp = (s: string, w: import("../src/types.ts").Word) => computeWordParts(s, w);
const args = (c: Command) => c.suffix.map((s) => s.text);

// ── $() command substitution ─────────────────────────────────────────

test("$() inner script is parsed via CommandExpansion part", () => {
  const src = "var=$(node ./script.js)";
  const c = getCmd(parse(src));
  const assign = c.prefix[0];
  assert.equal(assign.type, "Assignment");
  const part = assign.value ? wp(src, assign.value)?.[0] : undefined;
  assert.equal(part?.type, "CommandExpansion");
  if (part?.type === "CommandExpansion") {
    const inner = part.script!.commands[0].command as Command;
    assert.equal(inner.name?.text, "node");
    assert.deepEqual(args(inner), ["./script.js"]);
  }
});

test("nested $() in double quotes", () => {
  const ast = parse("node --maxWorkers=\"$(node -e 'process.stdout.write(os.cpus().length.toString())')\"");
  assert.ok(ast.commands.length >= 1);
  assert.equal(ast.errors, undefined);
});

test("eval with $() in double quotes", () => {
  const ast = parse('eval "$(ssh-agent -s)"');
  assert.ok(ast.commands.length > 0);
});

test("$() with sed in variable assignment", () => {
  const ast = parse('version=$(echo "$tag" | sed "s/^v//")');
  assert.ok(ast.commands.length > 0);
});

test("adjacent $() substitutions as command name", () => {
  const ast = parse("$(echo ec)$(echo ho) split builtin");
  assert.ok(ast.commands.length > 0);
});

// ── Backticks ────────────────────────────────────────────────────────

test("backtick inner script is parsed via CommandExpansion part", () => {
  const src = "var=`node ./script.js`";
  const c = getCmd(parse(src));
  const assign = c.prefix[0];
  assert.equal(assign.type, "Assignment");
  assert.equal(assign.value ? wp(src, assign.value)?.[0].type : undefined, "CommandExpansion");
});

test("adjacent backtick substitutions", () => {
  const ast = parse("echo `echo hi`bar`echo hi`");
  assert.ok(ast.commands.length > 0);
});

test("backtick escaping: \\$ becomes $ inside backticks", () => {
  const ast = parse("echo `echo \\$HOME`");
  assert.ok(ast.commands.length > 0);
});

test("backtick escaping: \\\\ becomes \\ inside backticks", () => {
  const ast = parse("echo `echo \\\\`");
  assert.ok(ast.commands.length > 0);
});

test("backtick escaping: \\` is nested backtick", () => {
  const ast = parse("echo `echo \\`echo hi\\``");
  assert.ok(ast.commands.length > 0);
});

test("adjacent backtick substitutions form one word", () => {
  const ast = parse("echo `echo a``echo b`");
  const c = getCmd(ast);
  assert.equal(c.name?.text, "echo");
});

test("backtick in double quotes", () => {
  const ast = parse('echo "`echo hello`"');
  assert.ok(ast.commands.length > 0);
});

// ── $"..." locale strings ────────────────────────────────────────────

test('$"..." locale string', () => {
  const c = getCmd(parse('echo $"hello world"'));
  assert.equal(c.name?.text, "echo");
  assert.equal(c.suffix[0].text, '$"hello world"');
});

test('$"..." with variable interpolation', () => {
  const ast = parse('echo $"Error: $file not found"');
  assert.ok(ast.commands.length > 0);
});

test('$"..." in assignment', () => {
  const ast = parse('msg=$"can\'t open"');
  assert.ok(ast.commands.length > 0);
});

// ── ${ cmd; } bash 5.3 command substitution ─────────────────────────

test("${ cmd; } recursively parsed", () => {
  const src = "echo ${ echo hello; }";
  const c = getCmd(parse(src));
  assert.equal(c.suffix[0].text, "${ echo hello; }");
  const part = wp(src, c.suffix[0])?.[0];
  assert.equal(part?.type, "CommandExpansion");
  if (part?.type === "CommandExpansion") {
    assert.equal(part.script!.commands.length, 1);
    assert.equal((part.script!.commands[0].command as Command).name?.text, "echo");
  }
});

test("${ } does not interfere with ${var}", () => {
  const src = "echo ${var}";
  const c = getCmd(parse(src));
  assert.equal(c.suffix[0].text, "${var}");
  assert.equal(wp(src, c.suffix[0])?.[0].type, "ParameterExpansion");
});

test("${| cmd; } recursively parsed", () => {
  const src = "echo ${| REPLY=hello; }";
  const c = getCmd(parse(src));
  assert.equal(c.suffix[0].text, "${| REPLY=hello; }");
  const part = wp(src, c.suffix[0])?.[0];
  assert.equal(part?.type, "CommandExpansion");
  if (part?.type === "CommandExpansion") {
    assert.equal(part.script!.commands.length, 1);
  }
});

test("${| } does not interfere with ${var}", () => {
  const src = "echo ${var}";
  const c = getCmd(parse(src));
  assert.equal(c.suffix[0].text, "${var}");
  assert.equal(wp(src, c.suffix[0])?.[0].type, "ParameterExpansion");
});

test("multiline brace command substitutions preserve their source text", () => {
  for (const src of ["echo ${\n  foo\n  bar\n}", "echo ${|\n  foo\n  bar\n}"]) {
    const ast = parse(src);
    const word = getCmd(ast).suffix[0];
    const part = wp(src, word)?.[0];
    assert.equal(part?.type, "CommandExpansion");
    assert.equal(part?.text, src.slice(5));
    assert.equal(word.value, src.slice(5));
    assert.equal(print(ast), src);
  }
});

// ── case inside $() ─────────────────────────────────────────────────

test("case pattern ) inside $() does not close substitution", () => {
  const ast = parse("echo $(case $x in a) echo A;; esac)");
  assert.equal(ast.commands.length, 1);
  const c = getCmd(ast);
  assert.equal(c.name?.text, "echo");
  const src1 = "echo $(case $x in a) echo A;; esac)";
  const part = wp(src1, c.suffix[0])?.[0];
  assert.equal(part?.type, "CommandExpansion");
  if (part?.type === "CommandExpansion") {
    const inner = part.script!;
    assert.equal(inner.commands.length, 1);
    const cs = inner.commands[0].command as import("../src/types.ts").Case;
    assert.equal(cs.type, "Case");
    assert.equal((cs.items[0].body.commands[0].command as Command).name?.text, "echo");
  }
});

test("nested case in $() with multiple patterns", () => {
  const src = "echo $(foo=a; case $foo in [0-9]) echo number;; [a-z]) echo letter;; esac)";
  const ast = parse(src);
  assert.equal(ast.commands.length, 1);
  const c = getCmd(ast);
  assert.equal(c.name?.text, "echo");
  assert.equal(wp(src, c.suffix[0])?.[0].type, "CommandExpansion");
});

// ── heredocs inside $() ──────────────────────────────────────────────

test('apostrophe in quoted-delimiter heredoc inside "$()" (#4)', () => {
  const src = `echo "$(cat <<'E'\nit's\nE\n)"`;
  const ast = parse(src);
  assert.equal(ast.errors, undefined);
  assert.equal(verify(src, ast), src);
});

test('heredoc inside "$()" resolves inner script and body', () => {
  const src = `echo "$(cat <<'E'\nit's\nE\n)"`;
  const dq = wp(src, getCmd(parse(src)).suffix[0])?.[0];
  assert.equal(dq?.type, "DoubleQuoted");
  if (dq?.type === "DoubleQuoted") {
    const part = dq.parts[0];
    assert.equal(part.type, "CommandExpansion");
    if (part.type === "CommandExpansion") {
      const inner = part.script!.commands[0].command as Command;
      assert.equal(inner.name?.text, "cat");
      assert.equal(inner.redirects[0].content, "it's\n");
      assert.equal(inner.redirects[0].heredocQuoted, true);
    }
  }
});

test('apostrophe in unquoted-delimiter heredoc inside "$()"', () => {
  const src = `echo "$(cat <<E\nit's\nE\n)"`;
  assert.equal(parse(src).errors, undefined);
});

test("$() with heredoc ends at closing paren", () => {
  const src = `echo $(cat <<'E'\nit's\nE\n) after`;
  const ast = parse(src);
  assert.equal(ast.errors, undefined);
  const c = getCmd(ast);
  assert.equal(c.suffix.length, 2);
  assert.equal(c.suffix[1].text, "after");
});

test('double quote in heredoc body inside "$()"', () => {
  const src = `echo "$(cat <<'E'\nsay "hi\nE\n)"`;
  assert.equal(parse(src).errors, undefined);
});

test('backtick in heredoc body inside "$()"', () => {
  const src = "echo \"$(cat <<'E'\nback ` tick\nE\n)\"";
  assert.equal(parse(src).errors, undefined);
});

test('<<- heredoc with tab-indented delimiter inside "$()"', () => {
  const src = `echo "$(cat <<-'E'\n\tit's\n\tE\n)"`;
  assert.equal(parse(src).errors, undefined);
});

test('two heredocs inside "$()"', () => {
  const src = `echo "$(cat <<A <<B\nit's a\nA\nit's b\nB\n)"`;
  assert.equal(parse(src).errors, undefined);
});

test("unterminated heredoc before bare ) errors like bash", () => {
  // bash: only a `delimiter)` line rescues an unterminated heredoc; a bare `)`
  // line does not (unexpected EOF while looking for matching `)')
  assert.ok(parse(`echo "$(cat <<B\n) after"`).errors);
  assert.ok(parse(`echo "$(cat <<A <<B\nA\n) after"`).errors);
});

test("heredoc inside <() process substitution", () => {
  const src = `cat <(cat <<'E'\nit's\nE\n)`;
  assert.equal(parse(src).errors, undefined);
});

test('herestring inside "$()" is not a heredoc', () => {
  const src = `echo "$(cat <<< word\necho done)"`;
  const ast = parse(src);
  assert.equal(ast.errors, undefined);
  assert.equal(verify(src, ast), src);
});

test('arithmetic shift inside multi-line "$()" is not a heredoc', () => {
  const src = `echo "$(x=$((1<<2))\necho $x)"`;
  const ast = parse(src);
  assert.equal(ast.errors, undefined);
  assert.equal(verify(src, ast), src);
});

test('arithmetic command shift inside multi-line "$()" is not a heredoc', () => {
  const src = `echo "$( ((x<<=2))\necho $x )"`;
  const ast = parse(src);
  assert.equal(ast.errors, undefined);
  assert.equal(verify(src, ast), src);
});

test('adjacent (( as nested subshells inside "$()"', () => {
  // bash retries failed arithmetic as a subshell — the extent scan must not
  // assume (( is arithmetic
  const src = 'echo "$( ((echo a); echo b) )"';
  const ast = parse(src);
  assert.equal(ast.errors, undefined);
  assert.equal(verify(src, ast), src);
});

test("quoted << in case pattern inside $()", () => {
  const src = `echo "$(case "a<<b" in\n"a<<b") echo hi;;\nesac)"`;
  const ast = parse(src);
  assert.equal(ast.errors, undefined);
  assert.equal(verify(src, ast), src);
});

test("unquoted << in case pattern errors like bash", () => {
  // bash: syntax error near unexpected token `<<' — << is a heredoc operator
  // even in pattern position
  const src = `echo "$(case x in\nfoo<<bar)\necho hi\n;;\nesac)"`;
  assert.ok(parse(src).errors);
});

test("<< inside a comment in $() is inert", () => {
  const src = `echo "$(# <<E\n)"`;
  const ast = parse(src);
  assert.equal(ast.errors, undefined);
  assert.equal(verify(src, ast), src);
});

test("quotes inside a comment in $() are inert", () => {
  const src = `echo "$(# it's\nls)"`;
  assert.equal(parse(src).errors, undefined);
});

test("comment after command in $() hides <<", () => {
  const src = `echo "$(echo x; # <<E\necho y)"`;
  const ast = parse(src);
  assert.equal(ast.errors, undefined);
  assert.equal(verify(src, ast), src);
});

test("heredoc with trailing comment inside $()", () => {
  const src = `echo "$(cat <<E # it's\nbody\nE\n)"`;
  assert.equal(parse(src).errors, undefined);
});

test("mid-word # in $() is not a comment", () => {
  const src = `echo "$(echo a#')\n')"`;
  assert.equal(parse(src).errors, undefined);
});

test("comment in single-line $() swallows the paren like bash", () => {
  // bash: the comment runs to a newline, so `)` inside it does not close
  const src = `echo "$(# c)"`;
  assert.ok(parse(src).errors);
});

test("heredoc delimiter directly before closing paren", () => {
  // bash accepts `E)` with a warning: the substitution's closing paren acts
  // as end-of-file for the heredoc
  const src = `echo "$(cat <<E\nhi\nE)"`;
  const ast = parse(src);
  assert.equal(ast.errors, undefined);
  assert.equal(verify(src, ast), src);
  const dq = wp(src, getCmd(ast).suffix[0])?.[0];
  assert.equal(dq?.type, "DoubleQuoted");
  if (dq?.type === "DoubleQuoted") {
    assert.equal(dq.parts[0].type, "CommandExpansion");
    if (dq.parts[0].type === "CommandExpansion") {
      const inner = dq.parts[0].script!.commands[0].command as Command;
      assert.equal(inner.redirects[0].content, "hi\n");
    }
  }
});

test("delimiter+paren line ends heredoc even with exact line later", () => {
  // bash: empty body, substitution closes at the first `)`, remainder is
  // literal text inside the double quotes
  const src = `echo "$(cat <<E\nE) oops\nE\n)"`;
  const ast = parse(src);
  assert.equal(ast.errors, undefined);
  assert.equal(verify(src, ast), src);
});

test("delimiter-prefixed body line does not end heredoc", () => {
  const src = `echo "$(cat <<E\nError: x\nE\n)"`;
  const ast = parse(src);
  assert.equal(ast.errors, undefined);
  const dq = wp(src, getCmd(ast).suffix[0])?.[0];
  assert.equal(dq?.type, "DoubleQuoted");
  if (dq?.type === "DoubleQuoted") {
    assert.equal(dq.parts[0].type, "CommandExpansion");
    if (dq.parts[0].type === "CommandExpansion") {
      const inner = dq.parts[0].script!.commands[0].command as Command;
      assert.equal(inner.redirects[0].content, "Error: x\n");
    }
  }
});

// The substitution extent scanner treats `)` as a case-pattern terminator while a `case` is
// open, so it must also account for parentheses that genuinely pair up inside one: the
// optional leading `(` on a pattern, an extglob group, and any subshell in a case body.
test("parentheses inside a case inside $() stay balanced", () => {
  const cases = [
    "x=$(case y in (a) z;; esac)",
    "x=$(case y in a) (echo 1);; esac)",
    "x=$(case y in a) z;; esac)",
    "x=$(case y in a) case z in (b) :;; esac;; esac)",
    'x="$(case y in (a) z;; esac)"',
    "x=$(case $(f) in a) :;; esac)",
    "x=$( (echo 1); case y in a) :;; esac )",
    "x=$(case y in a) :;; esac; (echo 1))",
    "x=$(case esac in (esac) echo esac;; esac)",
  ];
  for (const source of cases) {
    const ast = parse(source);
    assert.equal(ast.errors, undefined, source);
    assert.equal(ast.commands.length, 1, source);
    assert.equal(ast.commands[0].end, source.length, source);
    verify(source, ast);
  }
});

// `$((` opens an arithmetic expansion only when the inner parenthesis pair is immediately
// followed by `)`, the same lexical rule bash uses for a `((` command. Otherwise it is a
// command substitution whose body happens to start with a subshell: `$((echo hi) 2>/dev/null)`
// prints hi.
test("$(( is a command substitution unless the inner pair closes it", () => {
  const arithmetic = ["echo $((1+2))", "echo $(((1)))", "echo $(( (1) ))", "echo $((16#ff))"];
  for (const source of arithmetic) {
    const ast = parse(source);
    assert.equal(ast.errors, undefined, source);
    assert.deepEqual(
      wp(source, getCmd(ast).suffix[0])?.map((p) => p.type),
      ["ArithmeticExpansion"],
      source,
    );
  }

  const substitutions: [string, string][] = [
    ["echo $((echo hi) 2>/dev/null)", "Subshell"],
    ["echo $((a) || (b))", "AndOr"],
    ["echo $((a); b)", "Subshell"],
  ];
  for (const [source, inner] of substitutions) {
    const ast = parse(source);
    assert.equal(ast.errors, undefined, source);
    const part = wp(source, getCmd(ast).suffix[0])?.[0];
    assert.equal(part?.type, "CommandExpansion", source);
    assert.equal(part?.type === "CommandExpansion" && part.script?.commands[0].command.type, inner, source);
  }
});

test("case is a keyword in a substitution only at a real word boundary", () => {
  // Only a metacharacter ends a word, so `{case`, `"x"case` and `$xcase` are single words
  // and bash reports them as command-not-found rather than opening a case statement.
  for (const source of ['"$({case x in)"', "$({case x in)", "$(x{case x in)", "$($case x in)", '$("x"case x in)'])
    assert.equal(parse(source).errors, undefined, source);

  // A genuine case statement still tracks, so its `)` does not close the substitution.
  for (const source of ["$(case x in a) :;; esac)", "x=$(case v in (a) b;; esac)"])
    assert.equal(parse(source).errors, undefined, source);

  // And an unterminated one is still an error, as it is in bash.
  assert.ok(parse("$(a\ncase x in)").errors);
});
