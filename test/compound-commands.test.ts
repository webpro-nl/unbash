import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "../src/parser.ts";
import type { Command, Coproc, For, Function, If, Pipeline, Subshell, While } from "../src/types.ts";

const getCmd = (ast: ReturnType<typeof parse>, i = 0) => ast.commands[i].command as Command;

// --- Subshell and brace group ---

test("subshell", () => {
  const sub = parse("(cmd1; cmd2)").commands[0].command as Subshell;
  assert.equal(sub.type, "Subshell");
  assert.equal(sub.body.commands.length, 2);
});

test("brace group", () => {
  const bg = parse("{ echo a; echo b; }").commands[0].command as import("../src/types.ts").BraceGroup;
  assert.equal(bg.type, "BraceGroup");
  assert.equal(bg.body.commands.length, 2);
});

// Bash returns to command-start position after a compound command closes, so a reserved-word
// terminator may follow with no `;` or newline. A simple command still needs the separator.
test("reserved terminator follows a compound command without a separator", () => {
  for (const source of [
    "{ (echo a) }",
    "{ [[ x == x ]] }",
    "{ { echo a; } }",
    "{ if true; then echo a; fi }",
    "{ for i in a; do echo $i; done }",
    "{ while false; do echo a; done }",
    "{ case x in x) echo a;; esac }",
    "{ ((1 + 1)) }",
    "{ f() { echo a; } }",
    "{ echo a | (cat) }",
    "{ true && (echo a) }",
    "{ ! (echo a) }",
    "if true; then (echo a) fi",
    "while false; do (echo a) done",
  ]) {
    assert.equal(parse(source).errors, undefined, source);
  }
});

test("reserved terminator still needs a separator after a simple command", () => {
  // Bash rejects each of these, so the terminator must stay unrecognized.
  for (const source of ["{ echo a }", "{ (echo a) (echo b) }", "{ (echo a) echo b }", "{ (echo a) >/dev/null }"]) {
    assert.notEqual(parse(source).errors, undefined, source);
  }
});

test("deeply nested command substitutions", () => {
  const ast = parse("(echo $(echo $(echo deep)))");
  assert.ok(ast.commands.length > 0);
});

test("piped subshells with read", () => {
  const ast = parse('(echo start; cat file) | grep pattern | (read line; echo "Got: $line")');
  assert.ok(ast.commands.length > 0);
});

// --- If / elif / else ---

test("if/then/fi", () => {
  const if_ = parse("if test cond; then echo yes; fi").commands[0].command as If;
  assert.equal(if_.type, "If");
  assert.ok(if_.then);
  assert.equal(if_.else, undefined);
});

test("if/elif/else/fi", () => {
  const if_ = parse("if a; then b; elif c; then d; else e; fi").commands[0].command as If;
  assert.equal(if_.type, "If");
  assert.ok(if_.else);
  assert.equal((if_.else as If).type, "If");
  assert.ok((if_.else as If).else);
});

// --- For loop ---

test("for loop", () => {
  const f = parse("for x in a b c; do echo $x; done").commands[0].command as For;
  assert.equal(f.type, "For");
  assert.equal(f.name.text, "x");
  assert.equal(f.wordlist.length, 3);
  assert.equal(f.body.commands.length, 1);
});

// Bash accepts `{ list; }` in place of `do list done` for `for`, arithmetic `for` and
// `select` — and only those; `while`, `until` and `if` reject it. The tree is the same as
// the do/done form, so the brace group does not survive as a node.
test("brace group as a loop body", () => {
  const cases = [
    "for x in a b; { echo $x; }",
    "for x in a b\n{ echo $x; }",
    "for (( i=0; i<2; i++ )); { echo $i; }",
    "select x in a b; { echo $x; }",
  ];
  for (const source of cases) {
    const ast = parse(source);
    const command = ast.commands[0].command as For;
    assert.equal(ast.errors, undefined, source);
    assert.equal(command.body.commands.length, 1, source);
    assert.equal(command.end, source.length, source);
  }
});

test("brace group is not a loop body for while, until or if", () => {
  for (const source of ["while true; { break; }", "until true; { break; }", "if true; { :; }"]) {
    assert.notEqual(parse(source).errors, undefined, source);
  }
});

test("C-style for loop produces ArithmeticFor", () => {
  const ast = parse("for (( c=1; c<=5; c++ )); do echo $c; done");
  assert.equal(ast.commands.length, 1);
  const af = ast.commands[0].command as import("../src/types.ts").ArithmeticFor;
  assert.equal(af.type, "ArithmeticFor");
  assert.ok(af.initialize);
  assert.ok(af.test);
  assert.ok(af.update);
  assert.equal((af.body.commands[0].command as Command).name?.text, "echo");
});

test("C-style for infinite loop", () => {
  const af = parse("for (( ; ; )); do echo forever; done").commands[0]
    .command as import("../src/types.ts").ArithmeticFor;
  assert.equal(af.type, "ArithmeticFor");
  assert.equal(af.initialize, undefined);
  assert.equal(af.test, undefined);
  assert.equal(af.update, undefined);
});

// --- While / until ---

test("while loop", () => {
  const w = parse("while true; do echo hi; done").commands[0].command as While;
  assert.equal(w.type, "While");
  assert.equal(w.body.commands.length, 1);
});

test('while loop has kind "while"', () => {
  const w = parse("while true; do echo hi; done").commands[0].command as While;
  assert.equal(w.kind, "while");
});

test('until loop has kind "until"', () => {
  const w = parse("until false; do echo hi; done").commands[0].command as While;
  assert.equal(w.type, "While");
  assert.equal(w.kind, "until");
});

test("until loop with arithmetic", () => {
  const ast = parse('until [ "$count" -ge 10 ]; do\n    count=$((count + 1))\ndone');
  const w = ast.commands[0].command as While;
  assert.equal(w.kind, "until");
});

// --- Case ---

test("case/esac", () => {
  const ast = parse('case "$x" in\n  a) echo a ;;\n  b) echo b ;;\nesac');
  const c = ast.commands[0].command as import("../src/types.ts").Case;
  assert.equal(c.type, "Case");
  assert.equal(c.items.length, 2);
  assert.equal(c.items[0].pattern[0].text, "a");
  assert.equal((c.items[0].body.commands[0].command as Command).name?.text, "echo");
  assert.equal(c.items[1].pattern[0].text, "b");
});

test("case with ;& fallthrough captures terminator", () => {
  const ast = parse("case a in a) echo A ;& *) echo star ;; esac");
  const c = ast.commands[0].command as import("../src/types.ts").Case;
  assert.equal(c.items.length, 2);
  assert.equal(c.items[0].terminator, ";&");
  assert.equal(c.items[1].terminator, ";;");
});

test("case with ;;& conditional fallthrough captures terminator", () => {
  const ast = parse("case x in a) echo a ;;& b) echo b ;; esac");
  const c = ast.commands[0].command as import("../src/types.ts").Case;
  assert.equal(c.items.length, 2);
  assert.equal(c.items[0].terminator, ";;&");
  assert.equal(c.items[1].terminator, ";;");
});

test("case with multiple pipe-separated patterns", () => {
  const ast = parse('case "$Z" in\n  ab*|cd*) ef ;;\nesac');
  const c = ast.commands[0].command as import("../src/types.ts").Case;
  assert.equal(c.items[0].pattern.length, 2);
});

test("case with empty string pattern", () => {
  const ast = parse("case $empty in ''|foo) echo match ;; esac");
  const c = ast.commands[0].command as import("../src/types.ts").Case;
  assert.equal(c.items[0].pattern.length, 2);
});

test("case with ;;& in real-world style", () => {
  const ast = parse('case $cmd in\n  start) systemctl start app ;;&\n  *) echo "done" ;;\nesac');
  const c = ast.commands[0].command as import("../src/types.ts").Case;
  assert.equal(c.items[0].terminator, ";;&");
});

// --- Select ---

test("select produces Select node", () => {
  const ast = parse("select i in 1 2 3; do echo $i; done");
  const s = ast.commands[0].command as import("../src/types.ts").Select;
  assert.equal(s.type, "Select");
  assert.equal(s.name.text, "i");
  assert.equal(s.wordlist.length, 3);
  assert.equal(s.body.commands.length, 1);
  assert.equal((s.body.commands[0].command as Command).name?.text, "echo");
});

test("select without in", () => {
  const s = parse("select opt; do echo $opt; done").commands[0].command as import("../src/types.ts").Select;
  assert.equal(s.type, "Select");
  assert.equal(s.name.text, "opt");
});

test("select with nested case", () => {
  const ast = parse(
    'select opt in "Option 1" "Option 2" "Quit"; do\n    case $opt in\n        Quit) break;;\n        *) echo $opt;;\n    esac\ndone',
  );
  const s = ast.commands[0].command as import("../src/types.ts").Select;
  assert.equal(s.type, "Select");
});

// --- Functions ---

test("function definition", () => {
  const fn = parse("f() { echo hello; }").commands[0].command as Function;
  assert.equal(fn.type, "Function");
  assert.equal(fn.name.text, "f");
});

test("function keyword", () => {
  const fn = parse("function f { echo hello; }").commands[0].command as Function;
  assert.equal(fn.type, "Function");
  assert.equal(fn.name.text, "f");
});

test("function then call", () => {
  const ast = parse('f() { vite build "$@"; }; f');
  assert.equal(ast.commands.length, 2);
  assert.equal((ast.commands[0].command as Function).name.text, "f");
  assert.equal(getCmd(ast, 1).name?.text, "f");
});

// --- Coproc ---

test("coproc simple command", () => {
  const cp = parse("coproc cat").commands[0].command;
  assert.equal(cp.type, "Coproc");
  assert.ok(cp.type === "Coproc" && cp.body.type === "Command");
  assert.ok(cp.type === "Coproc" && cp.name === undefined);
});

test("coproc with compound command", () => {
  const cp = parse('coproc { read line; echo "$line"; }').commands[0].command;
  assert.equal(cp.type, "Coproc");
  assert.ok(cp.type === "Coproc" && cp.body.type === "BraceGroup");
});

test("coproc with name and compound command", () => {
  const cp = parse("coproc mycoproc { cat; }").commands[0].command;
  assert.equal(cp.type, "Coproc");
  assert.ok(cp.type === "Coproc" && cp.name?.text === "mycoproc");
  assert.ok(cp.type === "Coproc" && cp.body.type === "BraceGroup");
});

test("coproc with name and subshell", () => {
  const cp = parse("coproc mycoproc ( cat )").commands[0].command;
  assert.equal(cp.type, "Coproc");
  assert.ok(cp.type === "Coproc" && cp.name?.text === "mycoproc");
  assert.ok(cp.type === "Coproc" && cp.body.type === "Subshell");
});

test("coproc simple command with arguments", () => {
  const cp = parse("coproc foo bar").commands[0].command as Coproc;
  assert.equal(cp.type, "Coproc");
  assert.equal(cp.name, undefined);
  assert.equal(cp.body.type, "Command");
  const cmd = cp.body as Command;
  assert.equal(cmd.name?.text, "foo");
  assert.deepEqual(
    cmd.suffix.map((s) => s.text),
    ["bar"],
  );
});

test("coproc simple command with multiple arguments", () => {
  const cp = parse("coproc foo bar baz").commands[0].command as Coproc;
  assert.equal(cp.name, undefined);
  const cmd = cp.body as Command;
  assert.equal(cmd.name?.text, "foo");
  assert.deepEqual(
    cmd.suffix.map((s) => s.text),
    ["bar", "baz"],
  );
});

test("coproc named with pipeline body", () => {
  const cp = parse("coproc name foo | bar").commands[0].command as Coproc;
  assert.equal(cp.name?.text, "name");
  assert.equal(cp.body.type, "Pipeline");
  const pl = cp.body as Pipeline;
  assert.equal(pl.commands.length, 2);
  assert.equal((pl.commands[0] as Command).name?.text, "foo");
  assert.equal((pl.commands[1] as Command).name?.text, "bar");
});

test("coproc without name — pipe goes to outer pipeline", () => {
  const ast = parse("coproc foo | bar");
  assert.equal(ast.commands.length, 1);
  const pl = ast.commands[0].command as Pipeline;
  assert.equal(pl.type, "Pipeline");
  assert.equal(pl.commands.length, 2);
  assert.equal(pl.commands[0].type, "Coproc");
  assert.equal((pl.commands[1] as Command).name?.text, "bar");
});
