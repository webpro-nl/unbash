import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "../src/parser.ts";
import type {
  Command,
  For,
  While,
  Case,
  If,
  Subshell,
  BraceGroup,
  Select,
  TestCommand,
  ArithmeticCommand,
  Pipeline,
  AndOr,
  Function,
  Coproc,
  CompoundList,
} from "../src/types.ts";
import type { Node } from "../src/types.ts";

function slice(source: string, node: { pos: number; end: number }) {
  return source.slice(node.pos, node.end);
}

// --- Word positions ---

test("word positions for simple command", () => {
  const src = "echo hello world";
  const ast = parse(src);
  const cmd = ast.commands[0].command as Command;
  assert.equal(slice(src, cmd.name!), "echo");
  assert.equal(slice(src, cmd.suffix[0]), "hello");
  assert.equal(slice(src, cmd.suffix[1]), "world");
});

test("word positions with quotes", () => {
  const src = `echo "hello world"`;
  const ast = parse(src);
  const cmd = ast.commands[0].command as Command;
  assert.equal(slice(src, cmd.suffix[0]), '"hello world"');
});

test("word positions with variable expansion", () => {
  const src = "echo $HOME";
  const ast = parse(src);
  const cmd = ast.commands[0].command as Command;
  assert.equal(slice(src, cmd.suffix[0]), "$HOME");
});

// --- Statement positions ---

test("statement positions for simple command", () => {
  const src = "echo hello";
  const ast = parse(src);
  const stmt = ast.commands[0];
  assert.equal(slice(src, stmt), "echo hello");
});

test("statement with background", () => {
  const src = "sleep 5 &";
  const ast = parse(src);
  const stmt = ast.commands[0];
  assert.equal(stmt.background, true);
  assert.equal(slice(src, stmt), "sleep 5 &");
});

// --- Compound command positions ---

test("if/then/fi positions", () => {
  const src = "if true; then echo yes; fi";
  const ast = parse(src);
  const if_ = ast.commands[0].command as If;
  assert.equal(slice(src, if_), src);
});

test("if branch lists group multiple commands (#212)", () => {
  const src = "if true; false; true; then echo foo; echo bar; echo then; else echo baz; echo flux; echo else; fi";
  const ast = parse(src);
  assert.equal(ast.errors, undefined);
  const if_ = ast.commands[0].command as If;
  assert.equal(if_.else?.type, "CompoundList");
  if (if_.else?.type !== "CompoundList") return;
  assert.deepEqual(
    [if_.clause, if_.then, if_.else].map(({ pos, end, commands }) => [pos, end, commands.length]),
    [
      [3, 20, 3],
      [27, 56, 3],
      [63, 93, 3],
    ],
  );
});

test("if/elif/else/fi positions", () => {
  const src = "if a; then b; elif c; then d; else e; fi";
  const ast = parse(src);
  const if_ = ast.commands[0].command as If;
  assert.equal(slice(src, if_), src);
});

test("for loop positions", () => {
  const src = "for x in a b c; do echo $x; done";
  const ast = parse(src);
  const for_ = ast.commands[0].command as For;
  assert.equal(slice(src, for_), src);
});

test("while loop positions", () => {
  const src = "while true; do echo loop; done";
  const ast = parse(src);
  const while_ = ast.commands[0].command as While;
  assert.equal(slice(src, while_), src);
});

test("until loop positions", () => {
  const src = "until false; do echo loop; done";
  const ast = parse(src);
  const until_ = ast.commands[0].command as While;
  assert.equal(slice(src, until_), src);
});

test("case positions", () => {
  const src = "case $x in a) echo a;; b) echo b;; esac";
  const ast = parse(src);
  const case_ = ast.commands[0].command as Case;
  assert.equal(slice(src, case_), src);
});

test("select positions", () => {
  const src = "select x in a b c; do echo $x; done";
  const ast = parse(src);
  const sel = ast.commands[0].command as Select;
  assert.equal(slice(src, sel), src);
});

test("subshell positions", () => {
  const src = "(echo hello; echo world)";
  const ast = parse(src);
  const sub = ast.commands[0].command as Subshell;
  assert.equal(slice(src, sub), src);
});

test("brace group positions", () => {
  const src = "{ echo hello; echo world; }";
  const ast = parse(src);
  const bg = ast.commands[0].command as BraceGroup;
  assert.equal(slice(src, bg), src);
});

test("test command positions", () => {
  const src = "[[ -f /etc/passwd ]]";
  const ast = parse(src);
  const tc = ast.commands[0].command as TestCommand;
  assert.equal(slice(src, tc), src);
});

test("arithmetic command positions", () => {
  const src = "(( x + 1 ))";
  const ast = parse(src);
  const ac = ast.commands[0].command as ArithmeticCommand;
  assert.equal(slice(src, ac), src);
});

// --- Pipeline and AndOr positions ---

test("pipeline positions", () => {
  const src = "echo hello | grep h | wc -l";
  const ast = parse(src);
  const pipe = ast.commands[0].command as Pipeline;
  assert.equal(slice(src, pipe), src);
});

test("pipeline with time", () => {
  const src = "time echo hello | cat";
  const ast = parse(src);
  const pipe = ast.commands[0].command as Pipeline;
  assert.equal(slice(src, pipe), src);
});

test("pipeline with negation", () => {
  const src = "! echo hello | cat";
  const ast = parse(src);
  const pipe = ast.commands[0].command as Pipeline;
  assert.equal(slice(src, pipe), src);
});

test("andOr positions", () => {
  const src = "true && echo yes || echo no";
  const ast = parse(src);
  const ao = ast.commands[0].command as AndOr;
  assert.equal(slice(src, ao), src);
});

// --- Function positions ---

test("function positions with keyword", () => {
  const src = "function greet { echo hi; }";
  const ast = parse(src);
  const fn = ast.commands[0].command as Function;
  assert.equal(slice(src, fn), src);
});

test("function positions with parens", () => {
  const src = "greet() { echo hi; }";
  const ast = parse(src);
  const fn = ast.commands[0].command as Function;
  assert.equal(slice(src, fn), src);
});

// --- Redirect positions ---

test("redirect positions", () => {
  const src = "echo hello > /tmp/out";
  const ast = parse(src);
  const cmd = ast.commands[0].command as Command;
  assert.equal(slice(src, cmd.redirects[0]), "> /tmp/out");
});

test("redirect with fd positions", () => {
  const src = "cmd 2>/dev/null";
  const ast = parse(src);
  const cmd = ast.commands[0].command as Command;
  assert.equal(slice(src, cmd.redirects[0]), "2>/dev/null");
});

// --- Arithmetic expression positions ---

test("arithmetic expression positions in (( ))", () => {
  const src = "(( x + 1 ))";
  const ast = parse(src);
  const ac = ast.commands[0].command as ArithmeticCommand;
  const expr = ac.expression!;
  assert.equal(expr.type, "ArithmeticBinary");
  assert.equal(slice(src, expr), "x + 1");
});

test("arithmetic word positions", () => {
  const src = "(( x ))";
  const ast = parse(src);
  const ac = ast.commands[0].command as ArithmeticCommand;
  const expr = ac.expression!;
  assert.equal(expr.type, "ArithmeticWord");
  assert.equal(slice(src, expr), "x");
});

// --- Test expression positions ---

test("test unary positions", () => {
  const src = "[[ -f file ]]";
  const ast = parse(src);
  const tc = ast.commands[0].command as TestCommand;
  assert.equal(tc.expression.type, "TestUnary");
  assert.equal(slice(src, tc.expression), "-f file");
});

test("test binary positions", () => {
  const src = "[[ a == b ]]";
  const ast = parse(src);
  const tc = ast.commands[0].command as TestCommand;
  assert.equal(tc.expression.type, "TestBinary");
  assert.equal(slice(src, tc.expression), "a == b");
});

test("test logical positions", () => {
  const src = "[[ -f a && -d b ]]";
  const ast = parse(src);
  const tc = ast.commands[0].command as TestCommand;
  assert.equal(tc.expression.type, "TestLogical");
  assert.equal(slice(src, tc.expression), "-f a && -d b");
});

test("test not positions", () => {
  const src = "[[ ! -f a ]]";
  const ast = parse(src);
  const tc = ast.commands[0].command as TestCommand;
  assert.equal(tc.expression.type, "TestNot");
  assert.equal(slice(src, tc.expression), "! -f a");
});

test("test group positions", () => {
  const src = "[[ ( -f a ) ]]";
  const ast = parse(src);
  const tc = ast.commands[0].command as TestCommand;
  assert.equal(tc.expression.type, "TestGroup");
  assert.equal(slice(src, tc.expression), "( -f a )");
});

// --- Script positions ---

test("script pos/end", () => {
  const src = "echo hello\necho world\n";
  const ast = parse(src);
  assert.equal(ast.pos, 0);
  assert.equal(ast.end, src.length);
});

// --- CompoundList positions ---

test("compound list positions in for body", () => {
  const src = "for x in a b; do echo $x; echo done; done";
  const ast = parse(src);
  const for_ = ast.commands[0].command as For;
  const body = for_.body;
  assert.equal(body.commands.length, 2);
  assert.ok(body.pos >= 0);
  assert.ok(body.end <= src.length);
});

// --- Assignment positions ---

test("assignment prefix positions", () => {
  const src = "FOO=bar cmd";
  const ast = parse(src);
  const cmd = ast.commands[0].command as Command;
  assert.equal(slice(src, cmd.prefix[0]), "FOO=bar");
});

// --- Coproc positions ---

test("coproc positions", () => {
  const src = "coproc cat";
  const ast = parse(src);
  const cop = ast.commands[0].command as Coproc;
  assert.equal(cop.pos, 0);
  assert.ok(cop.end <= src.length);
});

// --- Invariant walker ---

function walkNode(node: Node, source: string, path: string) {
  assert.ok(node.pos >= 0, `${path}: pos >= 0 (got ${node.pos})`);
  assert.ok(node.end >= node.pos, `${path}: end >= pos (got pos=${node.pos}, end=${node.end})`);
  assert.ok(node.end <= source.length, `${path}: end <= source.length (got ${node.end}, len=${source.length})`);

  switch (node.type) {
    case "Command":
      if (node.name) walkWord(node.name, source, `${path}.name`);
      for (let i = 0; i < node.prefix.length; i++) {
        const a = node.prefix[i];
        assert.ok(a.pos >= 0 && a.end >= a.pos && a.end <= source.length, `${path}.prefix[${i}]`);
      }
      for (let i = 0; i < node.suffix.length; i++) walkWord(node.suffix[i], source, `${path}.suffix[${i}]`);
      for (let i = 0; i < node.redirects.length; i++)
        walkRedirect(node.redirects[i], source, `${path}.redirects[${i}]`);
      break;
    case "Pipeline":
      for (let i = 0; i < node.commands.length; i++) walkNode(node.commands[i], source, `${path}.commands[${i}]`);
      break;
    case "AndOr":
      for (let i = 0; i < node.commands.length; i++) walkNode(node.commands[i], source, `${path}.commands[${i}]`);
      break;
    case "If":
      walkCompoundList(node.clause, source, `${path}.clause`);
      walkCompoundList(node.then, source, `${path}.then`);
      if (node.else) {
        if (node.else.type === "If") walkNode(node.else, source, `${path}.else`);
        else walkCompoundList(node.else, source, `${path}.else`);
      }
      break;
    case "For":
      walkWord(node.name, source, `${path}.name`);
      for (let i = 0; i < node.wordlist.length; i++) walkWord(node.wordlist[i], source, `${path}.wordlist[${i}]`);
      walkCompoundList(node.body, source, `${path}.body`);
      break;
    case "ArithmeticFor":
      walkCompoundList(node.body, source, `${path}.body`);
      break;
    case "While":
      walkCompoundList(node.clause, source, `${path}.clause`);
      walkCompoundList(node.body, source, `${path}.body`);
      break;
    case "Case":
      walkWord(node.word, source, `${path}.word`);
      for (let i = 0; i < node.items.length; i++) {
        const item = node.items[i];
        assert.ok(item.pos >= 0 && item.end >= item.pos && item.end <= source.length, `${path}.items[${i}]`);
        walkCompoundList(item.body, source, `${path}.items[${i}].body`);
      }
      break;
    case "Select":
      walkWord(node.name, source, `${path}.name`);
      walkCompoundList(node.body, source, `${path}.body`);
      break;
    case "Function":
      walkWord(node.name, source, `${path}.name`);
      walkNode(node.body, source, `${path}.body`);
      for (let i = 0; i < node.redirects.length; i++)
        walkRedirect(node.redirects[i], source, `${path}.redirects[${i}]`);
      break;
    case "Subshell":
      walkCompoundList(node.body, source, `${path}.body`);
      break;
    case "BraceGroup":
      walkCompoundList(node.body, source, `${path}.body`);
      break;
    case "CompoundList":
      walkCompoundList(node, source, path);
      break;
    case "Coproc":
      if (node.name) walkWord(node.name, source, `${path}.name`);
      walkNode(node.body, source, `${path}.body`);
      break;
    case "TestCommand":
      walkTestExpr(node.expression, source, `${path}.expression`);
      break;
    case "ArithmeticCommand":
      if (node.expression) walkArithExpr(node.expression, source, `${path}.expression`);
      break;
    case "Statement":
      walkNode(node.command, source, `${path}.command`);
      for (let i = 0; i < node.redirects.length; i++)
        walkRedirect(node.redirects[i], source, `${path}.redirects[${i}]`);
      break;
  }
}

function walkCompoundList(cl: CompoundList, source: string, path: string) {
  for (let i = 0; i < cl.commands.length; i++) {
    const stmt = cl.commands[i];
    assert.ok(stmt.pos >= 0 && stmt.end >= stmt.pos && stmt.end <= source.length, `${path}.commands[${i}] stmt`);
    walkNode(stmt, source, `${path}.commands[${i}]`);
  }
}

function walkWord(w: { pos: number; end: number }, source: string, path: string) {
  assert.ok(w.pos >= 0, `${path}: word pos >= 0 (got ${w.pos})`);
  assert.ok(w.end >= w.pos, `${path}: word end >= pos (got pos=${w.pos}, end=${w.end})`);
  assert.ok(w.end <= source.length, `${path}: word end <= source.length (got ${w.end})`);
}

function walkRedirect(r: { pos: number; end: number }, source: string, path: string) {
  assert.ok(r.pos >= 0, `${path}: redirect pos >= 0 (got ${r.pos})`);
  assert.ok(r.end >= r.pos, `${path}: redirect end >= pos (got pos=${r.pos}, end=${r.end})`);
  assert.ok(r.end <= source.length, `${path}: redirect end <= source.length (got ${r.end})`);
}

function walkTestExpr(te: import("../src/types.ts").TestExpression, source: string, path: string) {
  assert.ok(te.pos >= 0 && te.end >= te.pos && te.end <= source.length, `${path}: test expr bounds`);
  switch (te.type) {
    case "TestUnary":
      walkWord(te.operand, source, `${path}.operand`);
      break;
    case "TestBinary":
      walkWord(te.left, source, `${path}.left`);
      walkWord(te.right, source, `${path}.right`);
      break;
    case "TestLogical":
      walkTestExpr(te.left, source, `${path}.left`);
      walkTestExpr(te.right, source, `${path}.right`);
      break;
    case "TestNot":
      walkTestExpr(te.operand, source, `${path}.operand`);
      break;
    case "TestGroup":
      walkTestExpr(te.expression, source, `${path}.expression`);
      break;
  }
}

function walkArithExpr(ae: import("../src/types.ts").ArithmeticExpression, source: string, path: string) {
  assert.ok(ae.pos >= 0 && ae.end >= ae.pos && ae.end <= source.length, `${path}: arith expr bounds`);
  switch (ae.type) {
    case "ArithmeticBinary":
      walkArithExpr(ae.left, source, `${path}.left`);
      walkArithExpr(ae.right, source, `${path}.right`);
      break;
    case "ArithmeticUnary":
      walkArithExpr(ae.operand, source, `${path}.operand`);
      break;
    case "ArithmeticTernary":
      walkArithExpr(ae.test, source, `${path}.test`);
      walkArithExpr(ae.consequent, source, `${path}.consequent`);
      walkArithExpr(ae.alternate, source, `${path}.alternate`);
      break;
    case "ArithmeticGroup":
      walkArithExpr(ae.expression, source, `${path}.expression`);
      break;
    case "ArithmeticWord":
      break;
  }
}

function walkScript(source: string) {
  const ast = parse(source);
  assert.equal(ast.pos, 0);
  assert.equal(ast.end, source.length);
  for (let i = 0; i < ast.commands.length; i++) {
    const stmt = ast.commands[i];
    assert.ok(stmt.pos >= 0 && stmt.end >= stmt.pos && stmt.end <= source.length, `commands[${i}] stmt`);
    walkNode(stmt, source, `commands[${i}]`);
  }
}

// --- Invariant tests over diverse scripts ---

const scripts = [
  "echo hello world",
  "  echo   spaced  ",
  "echo hello; echo world",
  "echo hello & echo world",
  "echo a | grep a | wc -l",
  "true && echo yes || echo no",
  "if true; then echo yes; fi",
  "if a; then b; elif c; then d; else e; fi",
  "for x in a b c; do echo $x; done",
  "while true; do echo loop; done",
  "until false; do echo loop; done",
  "case $x in a) echo a;; b) echo b;; esac",
  "select x in a b c; do echo $x; done",
  "(echo hello; echo world)",
  "{ echo hello; echo world; }",
  "[[ -f /etc/passwd ]]",
  "[[ a == b ]]",
  "[[ -f a && -d b ]]",
  "[[ ! -f a ]]",
  "[[ ( -f a ) ]]",
  "(( x + 1 ))",
  "(( x++ ))",
  "(( x > 0 ? 1 : 0 ))",
  "function greet { echo hi; }",
  "greet() { echo hi; }",
  "echo hello > /tmp/out",
  "cmd 2>/dev/null",
  "echo hello >> /tmp/out",
  "cat < /tmp/in",
  "FOO=bar cmd",
  "FOO=bar BAZ=qux cmd",
  "coproc cat",
  "time echo hello | cat",
  "! echo hello | cat",
  'echo "hello world"',
  "echo 'hello world'",
  "echo $HOME",
  'echo "${HOME}/bin"',
  "echo $(date)",
  "echo $((1+2))",
];

for (const script of scripts) {
  test(`invariant: ${script}`, () => walkScript(script));
}
