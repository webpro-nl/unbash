import assert from "node:assert/strict";
import test from "node:test";
import { Lexer } from "../src/lexer.ts";
import { parse } from "../src/parser.ts";
import { print } from "../src/printer.ts";
import type { Command, Pipeline } from "../src/types.ts";
import { computeWordParts } from "../src/parts.ts";
import { verify } from "./verify.ts";

const getCmd = (ast: ReturnType<typeof parse>, i = 0) => ast.commands[i].command as Command;
const wp = (s: string, w: import("../src/types.ts").Word) => computeWordParts(s, w);
const args = (c: Command) => c.suffix.map((s) => s.text);

function assignmentBacktickScript(source: string) {
  const ast = parse(source);
  assert.equal(ast.errors, undefined, source);
  const assignment = getCmd(ast).prefix[0];
  assert.equal(assignment.type, "Assignment", source);
  if (assignment.type !== "Assignment" || !assignment.value) throw new Error(source);
  const parts = wp(source, assignment.value);
  const expansion =
    parts?.[0]?.type === "DoubleQuoted"
      ? parts[0].parts?.find((part) => part.type === "CommandExpansion")
      : parts?.find((part) => part.type === "CommandExpansion");
  assert.equal(expansion?.type, "CommandExpansion", source);
  if (expansion?.type !== "CommandExpansion" || !expansion.script) throw new Error(source);
  return expansion.script;
}

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

test("backticks inside double quotes decode escaped double quotes (#214)", () => {
  const source = 'word="`echo \\"${2}\\" | sed -e\\"s|=.*$||\\" -e\\"s|^.*opt ||\\"`"';
  const script = assignmentBacktickScript(source);
  assert.equal(script.source, 'echo "${2}" | sed -e"s|=.*$||" -e"s|^.*opt ||"');
  assert.equal(script.errors, undefined);
  assert.equal(script.commands.length, 1);
  const pipeline = script.commands[0].command;
  assert.equal(pipeline.type, "Pipeline");
  if (pipeline.type !== "Pipeline") return;
  assert.deepEqual(pipeline.operators, ["|"]);
  assert.deepEqual(
    pipeline.commands.map((command) => command.type === "Command" && command.name?.text),
    ["echo", "sed"],
  );
  const sed = pipeline.commands[1];
  assert.equal(sed.type, "Command");
  if (sed.type !== "Command") return;
  assert.deepEqual(
    sed.suffix.map((word) => word.value),
    ["-es|=.*$||", "-es|^.*opt ||"],
  );
});

test("backtick double-quote decoding stays context-sensitive (#214)", () => {
  const unquoted = assignmentBacktickScript('word=`printf \\"x\\"`');
  assert.equal(unquoted.source, 'printf \\"x\\"');

  const layered = assignmentBacktickScript('word="`printf \\\\\\"x\\\\\\"`"');
  assert.equal(layered.source, 'printf \\"x\\"');

  const nonspecial = assignmentBacktickScript('word="`printf \\q`"');
  assert.equal(nonspecial.source, "printf \\q");
});

test("a comment inside backticks stops at the closing backtick (#116)", () => {
  const source = "echo `echo hey # comment` there";
  const ast = parse(source);
  const command = getCmd(ast);
  assert.equal(ast.errors, undefined);
  assert.deepEqual(
    command.suffix.map(({ text, pos, end }) => [text, pos, end]),
    [
      ["`echo hey # comment`", 5, 25],
      ["there", 26, 31],
    ],
  );
  const expansion = wp(source, command.suffix[0])?.[0];
  assert.equal(expansion?.type, "CommandExpansion");
  if (expansion?.type !== "CommandExpansion") return;
  assert.deepEqual([expansion.script?.pos, expansion.script?.end, expansion.script?.errors], [6, 24, undefined]);
  const inner = expansion.script!.commands[0].command as Command;
  assert.deepEqual([inner.pos, inner.end, inner.name?.text, ...args(inner)], [6, 14, "echo", "hey"]);
});

test("a comment-only backtick stays in the left side of a pipeline (#116)", () => {
  const source = "printf 'hey %s' `# comment` |\n  cat <<< 'there'";
  const ast = parse(source);
  assert.equal(ast.errors, undefined);
  const pipeline = ast.commands[0].command as Pipeline;
  assert.equal(pipeline.type, "Pipeline");
  assert.deepEqual(
    pipeline.commands.map((command) => [
      command.type,
      command.pos,
      command.end,
      command.type === "Command" && command.name?.text,
    ]),
    [
      ["Command", 0, 27, "printf"],
      ["Command", 32, 47, "cat"],
    ],
  );
  assert.deepEqual(pipeline.operators, ["|"]);
  const left = pipeline.commands[0] as Command;
  const expansion = wp(source, left.suffix[1])?.[0];
  assert.equal(expansion?.type, "CommandExpansion");
  if (expansion?.type !== "CommandExpansion") return;
  assert.deepEqual([expansion.script?.pos, expansion.script?.end, expansion.script?.commands.length], [17, 26, 0]);
  assert.equal(expansion.script?.errors, undefined);
  const right = pipeline.commands[1] as Command;
  assert.deepEqual(
    right.redirects.map(({ operator, pos, end, target }) => [operator, pos, end, target?.text]),
    [["<<<", 36, 47, "'there'"]],
  );
});

for (const [label, source, ranges] of [
  [
    "A",
    "echo 'TESTING!' 'abc'$(pwd)\"def\"",
    [
      [5, 15],
      [16, 32],
    ],
  ],
  [
    "B",
    "echo 'TESTING2!' 'abc'`pwd`\"def\"",
    [
      [5, 16],
      [17, 32],
    ],
  ],
  [
    "C",
    "echo 'TESTING3!' 'abc'\"$(pwd)\"\"def\"",
    [
      [5, 16],
      [17, 35],
    ],
  ],
  [
    "D",
    "echo 'TESTING4!' 'abc'\"`pwd`\"\"def\"",
    [
      [5, 16],
      [17, 34],
    ],
  ],
] as const) {
  test(`adjacent substitution forms exactly two arguments (#215-${label})`, () => {
    const ast = parse(source);
    const command = getCmd(ast);
    assert.equal(ast.errors, undefined);
    assert.deepEqual(
      command.suffix.map(({ pos, end }) => [pos, end]),
      ranges,
    );
    if (label !== "B") return;
    const parts = wp(source, command.suffix[1]);
    assert.deepEqual(
      parts?.map(({ type, text }) => [type, text]),
      [
        ["SingleQuoted", "'abc'"],
        ["CommandExpansion", "`pwd`"],
        ["DoubleQuoted", '"def"'],
      ],
    );
    const expansion = parts?.[1];
    assert.equal(expansion?.type, "CommandExpansion");
    if (expansion?.type !== "CommandExpansion") return;
    assert.deepEqual([expansion.script?.pos, expansion.script?.end, expansion.script?.errors], [23, 26, undefined]);
    const inner = expansion.script!.commands[0].command as Command;
    assert.deepEqual([inner.type, inner.pos, inner.end, inner.name?.text], ["Command", 23, 26, "pwd"]);
  });
}

for (const [label, source, roots, scriptRange, commandRange] of [
  [
    "control",
    'echo `echo "foo"`\n\necho `echo "bar"`',
    [
      [0, 17],
      [19, 36],
    ],
    [25, 35],
    [25, 35],
  ],
  [
    "leading space",
    'echo `echo "foo"`\n\necho ` echo "bar"`',
    [
      [0, 17],
      [19, 37],
    ],
    [25, 36],
    [26, 36],
  ],
] as const) {
  test(`backticks with ${label} keep two root commands (#278)`, () => {
    const ast = parse(source);
    assert.equal(ast.errors, undefined);
    assert.deepEqual(
      ast.commands.map(({ pos, end }) => [pos, end]),
      roots,
    );
    const expansion = wp(source, getCmd(ast, 1).suffix[0])?.[0];
    assert.equal(expansion?.type, "CommandExpansion");
    if (expansion?.type !== "CommandExpansion") return;
    assert.deepEqual([expansion.script?.pos, expansion.script?.end], scriptRange);
    assert.equal(expansion.script?.errors, undefined);
    const inner = expansion.script!.commands[0].command as Command;
    assert.deepEqual([inner.pos, inner.end, inner.name?.text], [...commandRange, "echo"]);
  });
}

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

test("nested multiline brace command substitutions stay structured (#301)", () => {
  const src = 'echo "${\n  echo "${\n    echo foo\n  }"\n}"';
  const ast = parse(src);
  assert.equal(ast.errors, undefined);
  const command = getCmd(ast);
  const outerQuoted = wp(src, command.suffix[0])?.[0];
  assert.equal(outerQuoted?.type, "DoubleQuoted");
  if (outerQuoted?.type !== "DoubleQuoted") return;
  const outer = outerQuoted.parts[0];
  assert.equal(outer.type, "CommandExpansion");
  if (outer.type !== "CommandExpansion" || !outer.script) return;
  assert.deepEqual([outer.script.pos, outer.script.end], [11, 37]);

  const outerCommand = outer.script.commands[0].command as Command;
  const innerQuoted = wp(src, outerCommand.suffix[0])?.[0];
  assert.equal(innerQuoted?.type, "DoubleQuoted");
  if (innerQuoted?.type !== "DoubleQuoted") return;
  const inner = innerQuoted.parts[0];
  assert.equal(inner.type, "CommandExpansion");
  if (inner.type !== "CommandExpansion" || !inner.script) return;
  assert.deepEqual([inner.script.pos, inner.script.end], [24, 32]);
  assert.equal((inner.script.commands[0].command as Command).name?.text, "echo");
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

function assertHashLiteralInCommandSubstitution(src: string, expected: string[]) {
  const ast = parse(src);
  assert.equal(ast.errors, undefined, src);
  const part = wp(src, getCmd(ast).suffix[0])?.[0];
  assert.equal(part?.type, "CommandExpansion", src);
  if (part?.type !== "CommandExpansion") return;
  assert.equal(part.script?.errors, undefined, src);
  const inner = part.script?.commands[0].command as Command;
  assert.equal(inner.name?.text, "echo", src);
  assert.deepEqual(args(inner), expected, src);
}

test("escaped whitespace keeps a following # literal inside $() (#68)", () => {
  assertHashLiteralInCommandSubstitution("echo $(echo \\ # hi)", ["\\ #", "hi"]);
});

test("closing substitution keeps a following # literal inside $() (#68)", () => {
  assertHashLiteralInCommandSubstitution("echo $(echo $(true)# hi)", ["$(true)#", "hi"]);
});

test("a continued command substitution stays structured inside $()", () => {
  const source = "echo $(echo $\\\n(true)# hi)";
  const ast = parse(source);
  assert.equal(ast.errors, undefined);
  assert.deepEqual(
    ast.commands.map(({ pos, end }) => [pos, end]),
    [[0, 26]],
  );

  const outerWord = getCmd(ast).suffix[0];
  assert.deepEqual(
    [outerWord.text, outerWord.value, outerWord.pos, outerWord.end],
    ["$(echo $\\\n(true)# hi)", "$(echo $\\\n(true)# hi)", 5, 26],
  );

  const outer = outerWord.parts?.[0];
  assert.equal(outer?.type, "CommandExpansion");
  if (outer?.type !== "CommandExpansion" || !outer.script) return;
  assert.deepEqual(
    [outer.text, outer.inner, outer.innerStart, outer.script.pos, outer.script.end, outer.script.errors],
    ["$(echo $\\\n(true)# hi)", undefined, undefined, 7, 25, undefined],
  );

  const innerCommand = outer.script.commands[0].command as Command;
  assert.deepEqual(
    [innerCommand.type, innerCommand.pos, innerCommand.end, innerCommand.name?.text],
    ["Command", 7, 25, "echo"],
  );
  assert.deepEqual(
    innerCommand.suffix.map(({ text, value, pos, end }) => [text, value, pos, end]),
    [
      ["$\\\n(true)#", "$(true)#", 12, 22],
      ["hi", "hi", 23, 25],
    ],
  );

  const innerWord = innerCommand.suffix[0];
  const innerLexer = new Lexer(source, innerWord.pos, innerWord.end);
  const unresolvedInner = innerLexer.buildWordParts(innerWord.pos)?.[0];
  assert.equal(unresolvedInner?.type, "CommandExpansion");
  if (unresolvedInner?.type !== "CommandExpansion") return;
  assert.deepEqual(
    [unresolvedInner.text, unresolvedInner.inner, unresolvedInner.innerStart],
    ["$\\\n(true)", "true", 16],
  );

  const innerParts = innerWord.parts;
  assert.deepEqual(
    innerParts?.map(({ type, text }) => [type, text]),
    [
      ["CommandExpansion", "$\\\n(true)"],
      ["Literal", "#"],
    ],
  );
  const nested = innerParts?.[0];
  assert.equal(nested?.type, "CommandExpansion");
  if (nested?.type !== "CommandExpansion" || !nested.script) return;
  assert.deepEqual([nested.script.pos, nested.script.end, nested.script.errors], [16, 20, undefined]);
  const nestedCommand = nested.script.commands[0].command as Command;
  assert.deepEqual(
    [nestedCommand.pos, nestedCommand.end, nestedCommand.type, nestedCommand.name?.text],
    [16, 20, "Command", "true"],
  );
  assert.equal(verify(source, ast), source);
  assert.equal(print(ast), source);
  assert.equal(print(parse(print(ast))), source);
});

test("a continued command substitution is one direct word", () => {
  const source = "echo $\\\n(true)# hi";
  const ast = parse(source);
  assert.equal(ast.errors, undefined);
  const command = getCmd(ast);
  assert.deepEqual([command.pos, command.end, command.name?.text], [0, 18, "echo"]);
  assert.deepEqual(
    command.suffix.map(({ text, value, pos, end }) => [text, value, pos, end]),
    [
      ["$\\\n(true)#", "$(true)#", 5, 15],
      ["hi", "hi", 16, 18],
    ],
  );
  const expansion = command.suffix[0].parts?.[0];
  assert.equal(expansion?.type, "CommandExpansion");
  if (expansion?.type !== "CommandExpansion" || !expansion.script) return;
  assert.deepEqual(
    [expansion.text, expansion.script.pos, expansion.script.end, expansion.script.errors],
    ["$\\\n(true)", 9, 13, undefined],
  );

  const repeatedSource = "echo $\\\n\\\n(true)";
  const repeatedAst = parse(repeatedSource);
  assert.equal(repeatedAst.errors, undefined);
  const repeatedWord = getCmd(repeatedAst).suffix[0];
  assert.deepEqual(
    [repeatedWord.text, repeatedWord.value, repeatedWord.pos, repeatedWord.end],
    ["$\\\n\\\n(true)", "$(true)", 5, 16],
  );
  const repeated = repeatedWord.parts?.[0];
  assert.equal(repeated?.type, "CommandExpansion");
  if (repeated?.type !== "CommandExpansion" || !repeated.script) return;
  assert.deepEqual(
    [repeated.text, repeated.script.pos, repeated.script.end, repeated.script.errors],
    ["$\\\n\\\n(true)", 11, 15, undefined],
  );
});

test("continued command-substitution scanning stays linear", () => {
  const value = "x=$(" + "\\\n".repeat(512) + "echo hi)";
  let reads = 0;
  const source = new Proxy(Object(value), {
    get(target, property) {
      if (property === "charCodeAt") {
        return (index: number) => {
          reads++;
          return value.charCodeAt(index);
        };
      }
      const member = Reflect.get(target, property, target);
      return typeof member === "function" ? member.bind(value) : member;
    },
  }) as unknown as string;

  const ast = parse(source);
  assert.equal(ast.errors, undefined);
  assert.equal(ast.commands.length, 1);
  assert.ok(reads > 512, `expected more than 512 character reads, received ${reads}`);
  assert.ok(reads < 10_000, `expected fewer than 10000 character reads, received ${reads}`);
});

test("an unescaped newline after $ does not join a command substitution", () => {
  const source = "echo $\n(true)";
  const ast = parse(source);
  assert.equal(ast.errors, undefined);
  assert.deepEqual(
    ast.commands.map(({ pos, end, command }) => [pos, end, command.type]),
    [
      [0, 6, "Command"],
      [7, 13, "Subshell"],
    ],
  );
  const dollar = getCmd(ast).suffix[0];
  assert.deepEqual([dollar.text, dollar.value, dollar.pos, dollar.end, dollar.parts], ["$", "$", 5, 6, undefined]);
});

test("array-like assignment keeps an adjacent # literal inside $() (#68)", () => {
  const src = "echo $(a=(x)# ) tail";
  const ast = parse(src);
  assert.equal(ast.errors, undefined);
  const outer = getCmd(ast);
  assert.deepEqual(args(outer), ["$(a=(x)# )", "tail"]);
  const part = wp(src, outer.suffix[0])?.[0];
  assert.equal(part?.type, "CommandExpansion");
  if (part?.type !== "CommandExpansion") return;
  assert.ok(part.script);
  if (!part.script) return;
  const assignment = (part.script.commands[0].command as Command).prefix[0];
  assert.equal(assignment.type, "Assignment");
  if (assignment.type !== "Assignment") return;
  assert.equal(assignment.text, "a=(x)#");
  assert.equal(assignment.value?.text, "(x)#");
  assert.equal(assignment.array, undefined);
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

test("a $(( extent ignores comments, a $( ( extent does not", () => {
  // Bash finds a `$((` construct's extent with its arithmetic scanner, where `#` is an
  // ordinary character, and keeps that extent even when the body is a command list.
  for (const source of [
    "$(($())#)",
    'echo "$((echo x)#)"',
    'echo "$((echo A)# )"',
    'echo "$((echo A) #)"',
    'echo "$(($()) #)"',
    'echo "$(($())#x)"',
  ])
    assert.equal(parse(source).errors, undefined, source);

  // With a space after `$(` the arithmetic scanner never ran, so `#` opens a comment and
  // swallows the closing paren — and a process substitution is not a `$((` extent either.
  for (const source of ['echo "$( (echo A)#)"', 'echo "$( (echo A) #)"', 'echo "$(echo A #B)"', "<((a)#)"])
    assert.ok(parse(source).errors, source);
});
