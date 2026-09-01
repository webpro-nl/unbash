import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "../src/parser.ts";
import { Token, Lexer } from "../src/lexer.ts";
import type { Command, AndOr, Pipeline } from "../src/types.ts";

// Helpers
const tokens = (src: string) => {
  const t = new Lexer(src);
  const result: { token: number; value: string }[] = [];
  while (true) {
    const tok = t.next();
    if (tok.token === Token.EOF) break;
    result.push({ token: tok.token, value: tok.value });
  }
  return result;
};

const getCmd = (ast: ReturnType<typeof parse>, i = 0) => ast.commands[i].command as Command;

// ── Operator disambiguation ─────────────────────────────────────────

test("& vs && vs &> vs &>>", () => {
  const t1 = tokens("cmd &");
  assert.equal(t1[1].token, Token.Amp);

  const t2 = tokens("a && b");
  assert.equal(t2[1].token, Token.And);

  const t3 = tokens("cmd &> file");
  assert.equal(t3[1].token, Token.Redirect);
  assert.equal(t3[1].value, "&>");

  const t4 = tokens("cmd &>> file");
  assert.equal(t4[1].token, Token.Redirect);
  assert.equal(t4[1].value, "&>>");
});

test("| vs || vs |&", () => {
  assert.equal(tokens("a | b")[1].token, Token.Pipe);
  assert.equal(tokens("a || b")[1].token, Token.Or);
  assert.equal(tokens("a |& b")[1].token, Token.Pipe);
  assert.equal(tokens("a |& b")[1].value, "|&");
});

test("; vs ;; vs ;& vs ;;&", () => {
  assert.equal(tokens("a; b")[1].token, Token.Semi);
  assert.equal(tokens("a ;; b")[1].token, Token.DoubleSemi);
  assert.equal(tokens("a ;& b")[1].token, Token.SemiAmp);
  assert.equal(tokens("a ;;& b")[1].token, Token.DoubleSemiAmp);
});

test("< vs << vs <<- vs <<< vs <& vs <> vs <(", () => {
  assert.equal(tokens("cmd < file")[1].value, "<");
  assert.equal(tokens("cmd << EOF")[1].value, "<<");
  assert.equal(tokens("cmd <<- EOF")[1].value, "<<-");
  assert.equal(tokens("cmd <<< word")[1].value, "<<<");
  assert.equal(tokens("cmd <& 3")[1].value, "<&");
  assert.equal(tokens("cmd <> file")[1].value, "<>");
});

test("> vs >> vs >& vs >| vs >(", () => {
  assert.equal(tokens("cmd > file")[1].value, ">");
  assert.equal(tokens("cmd >> file")[1].value, ">>");
  assert.equal(tokens("cmd >& 2")[1].value, ">&");
  assert.equal(tokens("cmd >| file")[1].value, ">|");
});

// ── Operators glued to words (no spaces) ────────────────────────────

test("operator splits adjacent words without whitespace", () => {
  const ast = parse("echo>file");
  const c = getCmd(ast);
  assert.equal(c.name?.text, "echo");
  assert.equal(c.redirects?.[0].operator, ">");
});

test("&& without spaces", () => {
  const ast = parse("foo&&bar");
  const expr = ast.commands[0].command as AndOr;
  assert.deepEqual(expr.operators, ["&&"]);
  assert.equal((expr.commands[0] as Command).name?.text, "foo");
  assert.equal((expr.commands[1] as Command).name?.text, "bar");
});

test("|| without spaces", () => {
  const ast = parse("foo||bar");
  const expr = ast.commands[0].command as AndOr;
  assert.deepEqual(expr.operators, ["||"]);
});

test("| without spaces", () => {
  const p = parse("foo|bar").commands[0].command as Pipeline;
  assert.equal(p.commands.length, 2);
});

test("; without spaces", () => {
  const ast = parse("foo;bar");
  assert.equal(ast.commands.length, 2);
});

// ── Comment edge cases ──────────────────────────────────────────────

test("# after word is a comment", () => {
  const ast = parse("echo hello #this is a comment");
  const c = getCmd(ast);
  assert.equal(c.suffix.length, 1);
  assert.equal(c.suffix[0].text, "hello");
});

test("# in single quotes is literal", () => {
  const c = getCmd(parse("echo '# not a comment'"));
  assert.equal(c.suffix[0].text, "'# not a comment'");
});

test("# in double quotes is literal", () => {
  const c = getCmd(parse('echo "# not a comment"'));
  assert.equal(c.suffix[0].text, '"# not a comment"');
});

test("# at start of line is a comment", () => {
  const ast = parse("# comment\necho hello");
  assert.equal(ast.commands.length, 1);
  assert.equal(getCmd(ast).name?.text, "echo");
});

test("comment between pipe and next command", () => {
  const ast = parse("foo |\n#comment\nbar");
  const p = ast.commands[0].command as Pipeline;
  assert.equal(p.commands.length, 2);
});

// ── Expansion boundary edge cases ───────────────────────────────────

test("$ at end of input is literal", () => {
  const c = getCmd(parse("echo $"));
  assert.equal(c.suffix[0].text, "$");
});

test("$var terminated by dash", () => {
  const c = getCmd(parse("echo $a-b"));
  assert.equal(c.suffix[0].text, "$a-b");
});

test("$var terminated by dot", () => {
  const c = getCmd(parse("echo $a.b"));
  assert.equal(c.suffix[0].text, "$a.b");
});

test("$var terminated by slash", () => {
  const c = getCmd(parse("echo $a/b"));
  assert.equal(c.suffix[0].text, "$a/b");
});

test("$_ and digits continue variable name", () => {
  const c = getCmd(parse("echo $a_b2c"));
  assert.equal(c.suffix[0].text, "$a_b2c");
});

test("special parameters are single-char", () => {
  for (const p of ["$@", "$*", "$#", "$$", "$?", "$!", "$-"]) {
    const c = getCmd(parse(`echo ${p}x`));
    assert.equal(c.suffix[0].text, `${p}x`, `Failed for ${p}`);
  }
});

test("positional parameter $1 is single digit", () => {
  const c = getCmd(parse("echo $11"));
  assert.equal(c.suffix[0].text, "$11");
});

test("positional expansion remains part of a preceding path (#306)", () => {
  const ast = parse("rm -f $COMMON_CONFDIR/ifaces/$1");
  const command = getCmd(ast);
  assert.equal(ast.errors, undefined);
  assert.deepEqual(
    command.suffix.map(({ text, pos, end }) => [text, pos, end]),
    [
      ["-f", 3, 5],
      ["$COMMON_CONFDIR/ifaces/$1", 6, 31],
    ],
  );
  assert.deepEqual(command.suffix[1].parts, [
    { type: "SimpleExpansion", text: "$COMMON_CONFDIR" },
    { type: "Literal", value: "/ifaces/", text: "/ifaces/" },
    { type: "SimpleExpansion", text: "$1" },
  ]);
});

// ── Gnarly tokenization from real parsers ───────────────────────────

test("empty assignment followed by semicolon", () => {
  const ast = parse("loop=; var=& here=;;");
  assert.ok(ast.commands.length >= 2);
});

test("# after quote is not a comment", () => {
  const c = getCmd(parse("echo 'word'#not-comment"));
  assert.equal(c.suffix[0].text, "'word'#not-comment");
});

test("# after command substitution is not a comment", () => {
  const c = getCmd(parse("echo $(uname)#not-comment"));
  assert.ok(c.suffix[0].text.includes("#not-comment"));
});

test("# after variable is not a comment", () => {
  const c = getCmd(parse("echo $hey#not-comment"));
  assert.ok(c.suffix[0].text.includes("#"));
});

test("var=#value is assignment with # in value", () => {
  const c = getCmd(parse("var=#not-comment"));
  assert.ok(c.prefix.some((p) => p.type === "Assignment" && p.text === "var=#not-comment"));
});

test("fi#etc is a word, not fi keyword + comment", () => {
  const ast = parse("echo fi#etc");
  const c = getCmd(ast);
  assert.equal(c.suffix[0].text, "fi#etc");
});

test("$'\\n' used as separator in replacement", () => {
  const ast = parse("A=${B//:;;/$'\\n'}");
  assert.ok(ast.commands.length > 0);
});

test("nested conditional parameter expansion with unbalanced parens", () => {
  const ast = parse('echo "${kw}? ( ${cond:+${cond}? (} ${baseuri}-${ver} ${cond:+) })"');
  assert.ok(ast.commands.length > 0);
});

test("escaped whitespace continues word", () => {
  const c = getCmd(parse("echo hello\\ world"));
  assert.equal(c.suffix[0].text, "hello\\ world");
});

test("escaped horizontal whitespace starts standalone arguments (#284)", () => {
  const ast = parse('printf "<%s>\\n" x \\  \\\t x');
  assert.equal(ast.errors, undefined);
  assert.deepEqual(
    getCmd(ast)
      .suffix.slice(2, 4)
      .map(({ text, value, pos, end }) => [text, value, pos, end]),
    [
      ["\\ ", " ", 18, 20],
      ["\\\t", "\t", 21, 23],
    ],
  );
});

test("single-bracket glob stays in one command (#214)", () => {
  const source = '[ -e "${EROOT}"/usr/lib/gtk-2.0/2.[^1]* ]';
  const ast = parse(source);
  assert.equal(ast.errors, undefined);
  assert.equal(ast.commands.length, 1);
  const command = getCmd(ast);
  assert.deepEqual(
    [command.name, ...command.suffix].map((word) => [word?.text, word?.pos, word?.end]),
    [
      ["[", 0, 1],
      ["-e", 2, 4],
      ['"${EROOT}"/usr/lib/gtk-2.0/2.[^1]*', 5, 39],
      ["]", 40, 41],
    ],
  );
});

test("escaped parentheses remain builtin arguments while unescaped controls fail (#269)", () => {
  const source = "[ \\( 'aaa' = 'bbb' \\) -o \\( 'ccc' = 'ccc' \\) ]";
  const ast = parse(source);
  assert.equal(ast.errors, undefined);
  assert.equal(ast.commands.length, 1);
  const command = getCmd(ast);
  assert.deepEqual([command.name?.text, command.pos, command.end], ["[", 0, 46]);
  assert.deepEqual(
    command.suffix.map(({ text, value, pos, end }) => [text, value, pos, end]),
    [
      ["\\(", "(", 2, 4],
      ["'aaa'", "aaa", 5, 10],
      ["=", "=", 11, 12],
      ["'bbb'", "bbb", 13, 18],
      ["\\)", ")", 19, 21],
      ["-o", "-o", 22, 24],
      ["\\(", "(", 25, 27],
      ["'ccc'", "ccc", 28, 33],
      ["=", "=", 34, 35],
      ["'ccc'", "ccc", 36, 41],
      ["\\)", ")", 42, 44],
      ["]", "]", 45, 46],
    ],
  );

  const invalid = "[ ( 'aaa' = 'bbb' ) -o ( 'ccc' = 'ccc' ) ]";
  assert.deepEqual(parse(invalid).errors, [{ message: "unexpected token ')'", pos: 18 }]);
});

test("escaped whitespace keeps a following # literal (#68)", () => {
  const ast = parse("echo \\ # hi");
  assert.equal(ast.errors, undefined);
  assert.deepEqual(
    getCmd(ast).suffix.map((word) => [word.text, word.value]),
    [
      ["\\ #", " #"],
      ["hi", "hi"],
    ],
  );
});

test("double-quoted string with nested double-quoted $() expansion", () => {
  const ast = parse('echo "x $(echo "hi")"');
  assert.ok(ast.commands.length > 0);
});

test("complex quoting: pnpm exec with nested jq escapes", () => {
  const ast = parse('pnpm exec "cat package.json | jq -r \'\\\"\\\\(.name)@\\\\(.version)\\\"\'" | sort');
  assert.ok(ast.commands.length > 0);
});

test("backtick line-join trick: `\\n` between quoted segments", () => {
  const ast = parse('echo "asd"`\n`"fgh"');
  assert.ok(ast.commands.length > 0);
});

test("${parameter:-1} vs ${parameter: -1} (space matters)", () => {
  const ast1 = parse("echo ${x:-1}");
  const ast2 = parse("echo ${x: -1}");
  assert.ok(ast1.commands.length > 0);
  assert.ok(ast2.commands.length > 0);
});

test("closing brace } in parameter expansion default", () => {
  const ast = parse("echo ${cdir:+#}");
  assert.ok(ast.commands.length > 0);
});

test("semicolon in parameter expansion default", () => {
  const ast = parse("echo ${dict_langs:+;}");
  assert.ok(ast.commands.length > 0);
});

test("complex replacement with unbalanced parens", () => {
  const ast = parse("echo ${BRANDING/(/(Gentoo ${PVR}, }");
  assert.ok(ast.commands.length > 0);
});

test("process substitution inside parameter expansion", () => {
  const ast = parse("some-command ${foo:+--arg <(printf '%s\\n' \"$foo\")}");
  assert.ok(ast.commands.length > 0);
});
