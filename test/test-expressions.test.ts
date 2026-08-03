import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "../src/parser.ts";
import { computeWordParts } from "../src/parts.ts";
import type {
  TestBinaryExpression,
  TestCommand,
  TestExpression,
  TestGroupExpression,
  TestLogicalExpression,
  TestNotExpression,
  TestUnaryExpression,
} from "../src/types.ts";

const getTest = (src: string): TestCommand => {
  const ast = parse(src);
  const node = ast.commands[0].command;
  assert.equal(node.type, "TestCommand");
  return node as TestCommand;
};

const unary = (e: TestExpression) => e as TestUnaryExpression;
const binary = (e: TestExpression) => e as TestBinaryExpression;
const logical = (e: TestExpression) => e as TestLogicalExpression;
const not = (e: TestExpression) => e as TestNotExpression;
const group = (e: TestExpression) => e as TestGroupExpression;

// --- Unary tests ---

test("unary -f", () => {
  const t = getTest("[[ -f $file ]]");
  assert.equal(t.expression.type, "TestUnary");
  assert.equal(unary(t.expression).operator, "-f");
  assert.equal(unary(t.expression).operand.text, "$file");
});

test("unary -d", () => {
  const t = getTest("[[ -d /tmp ]]");
  assert.equal(unary(t.expression).operator, "-d");
  assert.equal(unary(t.expression).operand.text, "/tmp");
});

test("unary -z", () => {
  const t = getTest("[[ -z $empty ]]");
  assert.equal(unary(t.expression).operator, "-z");
  assert.equal(unary(t.expression).operand.text, "$empty");
});

test("unary -n", () => {
  const t = getTest("[[ -n $str ]]");
  assert.equal(unary(t.expression).operator, "-n");
  assert.equal(unary(t.expression).operand.text, "$str");
});

test("unary -e", () => {
  const t = getTest("[[ -e /etc/passwd ]]");
  assert.equal(unary(t.expression).operator, "-e");
});

test("unary -r -w -x", () => {
  for (const op of ["-r", "-w", "-x"]) {
    const t = getTest(`[[ ${op} /tmp ]]`);
    assert.equal(unary(t.expression).operator, op);
  }
});

test("unary -s -L -S -b -c -p -t -v", () => {
  for (const op of ["-s", "-L", "-S", "-b", "-c", "-p", "-t", "-v"]) {
    const t = getTest(`[[ ${op} file ]]`);
    assert.equal(unary(t.expression).operator, op);
  }
});

test("unary -o shell option", () => {
  const t = getTest("[[ -o emacs && -v b ]]");
  assert.equal(logical(t.expression).operator, "&&");
  assert.equal(unary(logical(t.expression).left).operator, "-o");
  assert.equal(unary(logical(t.expression).left).operand.text, "emacs");
});

// --- Binary tests ---

test("binary ==", () => {
  const t = getTest("[[ $str == hello ]]");
  assert.equal(t.expression.type, "TestBinary");
  assert.equal(binary(t.expression).operator, "==");
  assert.equal(binary(t.expression).left.text, "$str");
  assert.equal(binary(t.expression).right.text, "hello");
});

test("binary !=", () => {
  const t = getTest("[[ $str != world ]]");
  assert.equal(binary(t.expression).operator, "!=");
});

test("binary =", () => {
  const t = getTest("[[ $str = hello ]]");
  assert.equal(binary(t.expression).operator, "=");
});

test("binary -eq -ne -lt -le -gt -ge", () => {
  for (const op of ["-eq", "-ne", "-lt", "-le", "-gt", "-ge"]) {
    const t = getTest(`[[ $num ${op} 42 ]]`);
    assert.equal(binary(t.expression).operator, op);
  }
});

test("binary -nt -ot -ef", () => {
  for (const op of ["-nt", "-ot", "-ef"]) {
    const t = getTest(`[[ $a ${op} $b ]]`);
    assert.equal(binary(t.expression).operator, op);
  }
});

test("binary < string comparison", () => {
  const t = getTest("[[ $str < world ]]");
  assert.equal(binary(t.expression).operator, "<");
  assert.equal(binary(t.expression).left.text, "$str");
  assert.equal(binary(t.expression).right.text, "world");
});

test("binary > string comparison", () => {
  const t = getTest("[[ $str > aaa ]]");
  assert.equal(binary(t.expression).operator, ">");
});

// --- Regex matching ---

test("binary =~ simple regex", () => {
  const t = getTest("[[ $str =~ ^[a-z]+$ ]]");
  assert.equal(binary(t.expression).operator, "=~");
  assert.equal(binary(t.expression).right.text, "^[a-z]+$");
});

test("binary =~ regex with parens", () => {
  const t = getTest("[[ $str =~ ^([a-z]+)([0-9]*)$ ]]");
  assert.equal(binary(t.expression).operator, "=~");
  assert.equal(binary(t.expression).right.text, "^([a-z]+)([0-9]*)$");
});

test("binary =~ regex with alternation", () => {
  const t = getTest("[[ $str =~ (hello|world) ]]");
  assert.equal(binary(t.expression).operator, "=~");
  assert.equal(binary(t.expression).right.text, "(hello|world)");
});

test("binary =~ regex with dot-star in parens", () => {
  const t = getTest("[[ $file =~ /etc/(.*) ]]");
  assert.equal(binary(t.expression).operator, "=~");
  assert.equal(binary(t.expression).right.text, "/etc/(.*)");
});

test("binary =~ regex keeps spaces inside groups", () => {
  for (const source of ["[[ a =~ [ab](c |d) ]]", "[[ a =~ ( ]]<>;&) ]]"]) {
    const ast = parse(source);
    assert.equal(ast.errors, undefined);
    const t = ast.commands[0].command;
    assert.equal(t.type, "TestCommand");
    assert.equal(binary(t.expression).right.text, source.slice(8, -3));
  }
  const t = getTest("[[ 'a b' =~ (a b) ]]");
  assert.equal(binary(t.expression).right.text, "(a b)");
  assert.equal(binary(t.expression).right.value, "(a b)");
});

test("binary =~ parameter expansion containing spaces", () => {
  for (const [source, text] of [
    ["[[ x =~ ${v/ /.} ]]", "${v/ /.}"],
    ["[[ x =~ ${v/ /.}z ]]", "${v/ /.}z"],
    ["[[ x =~ ${v:-)} ]]", "${v:-)}"],
  ] as const) {
    const ast = parse(source);
    assert.equal(ast.errors, undefined);
    const t = ast.commands[0].command as TestCommand;
    assert.equal(t.type, "TestCommand");
    assert.equal(binary(t.expression).right.text, text);
    assert.equal(binary(t.expression).right.value, text);
  }
});

test("binary =~ single-quoted backslash stays literal", () => {
  const ast = parse("[[ ab =~ 'a\\'b ]]\necho done");
  assert.equal(ast.errors, undefined);
  assert.equal(ast.commands.length, 2);
  const t = ast.commands[0].command as TestCommand;
  assert.equal(t.type, "TestCommand");
  assert.equal(binary(t.expression).right.text, "'a\\'b");
  assert.equal(binary(t.expression).right.value, "a\\b");
});

test("binary =~ splits at depth-zero && into logical AND", () => {
  const t = getTest("[[ ab =~ (a)&&(zzz) ]]");
  assert.equal(t.expression.type, "TestLogical");
  const l = logical(t.expression);
  assert.equal(l.operator, "&&");
  assert.equal(binary(l.left).operator, "=~");
  assert.equal(binary(l.left).right.text, "(a)");
  assert.equal(l.right.type, "TestGroup");
  assert.equal(unary(group(l.right).expression).operand.text, "zzz");

  const bare = getTest("[[ ab =~ a&&b ]]");
  assert.equal(bare.expression.type, "TestLogical");
  assert.equal(binary(logical(bare.expression).left).right.text, "a");
});

test("binary =~ regex ends at test group close", () => {
  for (const [source, text] of [
    ["[[ (ab =~ a) ]]", "a"],
    ["[[ ( ab =~ a) ]]", "a"],
    ["[[ ( ab =~ (a)) ]]", "(a)"],
  ] as const) {
    const ast = parse(source);
    assert.equal(ast.errors, undefined);
    const t = ast.commands[0].command as TestCommand;
    assert.equal(t.type, "TestCommand");
    assert.equal(t.expression.type, "TestGroup");
    assert.equal(binary(group(t.expression).expression).right.text, text);
  }
  const t = getTest("[[ ( abc =~ (b|c) ) && d ]]");
  assert.equal(t.expression.type, "TestLogical");
  assert.equal(binary(group(logical(t.expression).left).expression).right.text, "(b|c)");
});

test("binary =~ regex ends at depth-zero delimiters", () => {
  // bash: whitespace, `)`, `;`, `&`, `<`, `>` end the operand at paren depth
  // zero, and rejects all of these for the leftover before `]]`
  for (const [source, text] of [
    ["[[ ab =~ a) ]]", "a"],
    ["[[ ab =~ (a)b) ]]", "(a)b"],
    ["[[ 'a<b' =~ a<b ]]", "a"],
    ["[[ 'a>b' =~ (a)>b ]]", "(a)"],
    ["[[ x =~ a{b..c)d} ]]", "a{b..c"],
    ["[[ x =~ a;b ]]", "a"],
    ["[[ 'a&b' =~ (a)&(b) ]]", "(a)"],
  ] as const) {
    const ast = parse(source);
    assert.notEqual(ast.errors, undefined, source);
    const t = ast.commands[0].command as TestCommand;
    assert.equal(t.type, "TestCommand");
    assert.equal(binary(t.expression).right.text, text, source);
  }
});

test("binary =~ empty operand before group close or operator", () => {
  // bash accepts these at parse time; the empty regex fails only at run time
  const grouped = getTest("[[ ( x =~ ) ]]");
  assert.equal(grouped.expression.type, "TestGroup");
  assert.equal(binary(group(grouped.expression).expression).right.text, "");

  const logicalT = getTest("[[ x =~ && y ]]");
  assert.equal(logicalT.expression.type, "TestLogical");
  assert.equal(binary(logical(logicalT.expression).left).right.text, "");

  const ast = parse("[[ x =~ ]]");
  assert.notEqual(ast.errors, undefined);
});

test("binary =~ process substitution operands", () => {
  for (const [source, text] of [
    ["[[ x =~ <(y) ]]", "<(y)"],
    ["[[ x =~ a<(b) ]]", "a<(b)"],
    ["[[ x =~ a>(b) ]]", "a>(b)"],
  ] as const) {
    const ast = parse(source);
    assert.equal(ast.errors, undefined);
    const t = ast.commands[0].command as TestCommand;
    assert.equal(t.type, "TestCommand");
    assert.equal(binary(t.expression).right.text, text);
  }
});

test("binary =~ command substitution keeps case arms", () => {
  const ast = parse("[[ x =~ $(case y in a) echo z;; esac) ]]");
  assert.equal(ast.errors, undefined);
  const t = ast.commands[0].command as TestCommand;
  assert.equal(t.type, "TestCommand");
  assert.equal(binary(t.expression).right.text, "$(case y in a) echo z;; esac)");
});

test("binary =~ group interiors keep quotes opaque", () => {
  for (const [source, text] of [
    ["[[ x =~ ('a)b'c) ]]", "('a)b'c)"],
    ["[[ x =~ (`echo a)b`c) ]]", "(`echo a)b`c)"],
    ['[[ ")" =~ (")") ]]', '(")")'],
  ] as const) {
    const ast = parse(source);
    assert.equal(ast.errors, undefined);
    const t = ast.commands[0].command as TestCommand;
    assert.equal(t.type, "TestCommand");
    assert.equal(binary(t.expression).right.text, text);
  }
});

test("binary =~ grouped operands preserve embedded expansions", () => {
  const ast = parse("[[ x =~ (a $(danger) $HOME b) ]]");
  assert.equal(ast.errors, undefined);
  const command = ast.commands[0].command;
  assert.equal(command.type, "TestCommand");
  const right = binary(command.expression).right;
  assert.ok(right.parts?.some((part) => part.type === "SimpleExpansion"));
  const expansion = right.parts?.find((part) => part.type === "CommandExpansion");
  assert.equal(expansion?.type, "CommandExpansion");
  if (expansion?.type !== "CommandExpansion") return;
  const nested = expansion.script?.commands[0].command;
  assert.equal(nested?.type, "Command");
  if (nested?.type === "Command") assert.equal(nested.name?.value, "danger");
});

test("binary =~ grouped operands decode ANSI-C quotes", () => {
  const ast = parse(String.raw`[[ x =~ (a $'\n' b) ]]`);
  assert.equal(ast.errors, undefined);
  const command = ast.commands[0].command;
  assert.equal(command.type, "TestCommand");
  assert.equal(binary(command.expression).right.value, "(a \n b)");
});

test("binary =~ keeps escaped quotes opaque inside grouped ANSI-C strings", () => {
  const source = String.raw`[[ x =~ ($'a\')b'c) ]]`;
  const ast = parse(source);
  assert.equal(ast.errors, undefined);
  const command = ast.commands[0].command;
  assert.equal(command.type, "TestCommand");
  assert.equal(binary(command.expression).right.text, source.slice(8, -3));
});

test("binary =~ group interiors count expansion parens naively", () => {
  // bash closes the group at a `)` inside ${...} or $(...) nested in a group
  for (const [source, text] of [
    ["[[ x =~ (${v:-)}c) ]]", "(${v:-)}c"],
    ["[[ x =~ ($(case q in w) esac)b) ]]", "($(case q in w) esac)b"],
  ] as const) {
    const ast = parse(source);
    assert.notEqual(ast.errors, undefined, source);
    const t = ast.commands[0].command as TestCommand;
    assert.equal(t.type, "TestCommand");
    assert.equal(binary(t.expression).right.text, text, source);
  }
});

test("binary =~ keeps groups spanning newlines and terminators", () => {
  const nl = getTest("[[ ' a' =~ (a\n b) ]]");
  assert.equal(binary(nl.expression).right.text, "(a\n b)");

  const ast = parse("[[ x =~ (a ]] b) ]] && echo y");
  assert.equal(ast.errors, undefined);
  const andOr = ast.commands[0].command;
  assert.equal(andOr.type, "AndOr");
  const t = (andOr as import("../src/types.ts").AndOr).commands[0] as TestCommand;
  assert.equal(t.type, "TestCommand");
  assert.equal(binary(t.expression).right.text, "(a ]] b)");
});

test("binary =~ unbalanced group reports an error", () => {
  const ast = parse("[[ x =~ a(b ]]\necho done");
  assert.notEqual(ast.errors, undefined);
});

// --- Logical operators ---

test("logical && (AND)", () => {
  const t = getTest("[[ -f $file && -r $file ]]");
  assert.equal(t.expression.type, "TestLogical");
  assert.equal(logical(t.expression).operator, "&&");
  assert.equal(unary(logical(t.expression).left).operator, "-f");
  assert.equal(unary(logical(t.expression).right).operator, "-r");
});

test("logical || (OR)", () => {
  const t = getTest("[[ -d $dir || -f $dir ]]");
  assert.equal(logical(t.expression).operator, "||");
});

test("&& chains", () => {
  const t = getTest("[[ -f $file && -r $file && -s $file ]]");
  assert.equal(logical(t.expression).operator, "&&");
  // Left-associative: ((-f && -r) && -s)
  assert.equal(logical(logical(t.expression).left).operator, "&&");
  assert.equal(unary(logical(t.expression).right).operator, "-s");
});

test("|| has lower precedence than &&", () => {
  const t = getTest('[[ $str == hello && $num -eq 42 || $empty == "" ]]');
  // (str == hello && num -eq 42) || (empty == "")
  assert.equal(logical(t.expression).operator, "||");
  assert.equal(logical(logical(t.expression).left).operator, "&&");
});

// --- Negation ---

test("negation !", () => {
  const t = getTest("[[ ! -z $str ]]");
  assert.equal(t.expression.type, "TestNot");
  assert.equal(unary(not(t.expression).operand).operator, "-z");
});

test("double negation", () => {
  const t = getTest("[[ ! ! -f $file ]]");
  assert.equal(t.expression.type, "TestNot");
  assert.equal(not(t.expression).operand.type, "TestNot");
  assert.equal(unary(not(not(t.expression).operand).operand).operator, "-f");
});

test("negation with logical", () => {
  const t = getTest("[[ ! ( -z $str || -z $file ) ]]");
  assert.equal(t.expression.type, "TestNot");
  assert.equal(not(t.expression).operand.type, "TestGroup");
});

// --- Grouping ---

test("grouped expression", () => {
  const t = getTest("[[ ( -f $file || -d $file ) && -r $file ]]");
  assert.equal(logical(t.expression).operator, "&&");
  assert.equal(logical(t.expression).left.type, "TestGroup");
  const inner = group(logical(t.expression).left).expression;
  assert.equal(logical(inner).operator, "||");
});

test("nested grouping", () => {
  const t = getTest("[[ -d $dir && ( -w $dir || -x $dir ) ]]");
  assert.equal(logical(t.expression).operator, "&&");
  assert.equal(logical(t.expression).right.type, "TestGroup");
});

// --- Standalone word ---

test("standalone word is implicit -n", () => {
  const t = getTest("[[ $str ]]");
  assert.equal(t.expression.type, "TestUnary");
  assert.equal(unary(t.expression).operator, "-n");
  assert.equal(unary(t.expression).operand.text, "$str");
});

// --- Pattern matching ---

test("glob pattern on right side of ==", () => {
  const t = getTest("[[ $str == h* ]]");
  assert.equal(binary(t.expression).operator, "==");
  assert.equal(binary(t.expression).right.text, "h*");
});

test("bracket pattern", () => {
  const t = getTest("[[ $str == [Hh]ello ]]");
  assert.equal(binary(t.expression).operator, "==");
  assert.equal(binary(t.expression).right.text, "[Hh]ello");
});

// --- Integration with other constructs ---

test("[[ ]] in if clause", () => {
  const ast = parse("if [[ -f $file ]]; then echo found; fi");
  assert.equal(ast.commands[0].command.type, "If");
});

test("[[ ]] in while clause", () => {
  const ast = parse("while [[ $n -gt 0 ]]; do echo $n; done");
  assert.equal(ast.commands[0].command.type, "While");
});

test("[[ ]] with && pipeline", () => {
  const ast = parse("[[ -f $file ]] && echo exists");
  assert.equal(ast.commands[0].command.type, "AndOr");
});

test("[[ ]] with redirects", () => {
  const ast = parse("[[ -f $file ]] 2>/dev/null");
  const stmt = ast.commands[0];
  assert.equal(stmt.command.type, "TestCommand");
  assert.equal(stmt.redirects.length, 1);
  assert.equal(stmt.redirects[0].operator, ">");
});

// --- Word parts preserved ---

test("word parts in test operands", () => {
  const src = "[[ -f $file ]]";
  const t = getTest(src);
  const operand = unary(t.expression).operand;
  assert.ok(computeWordParts(src, operand));
  assert.equal(computeWordParts(src, operand)![0].type, "SimpleExpansion");
});

test("word parts in binary left/right", () => {
  const src = "[[ $str == hello ]]";
  const t = getTest(src);
  const left = binary(t.expression).left;
  assert.ok(computeWordParts(src, left));
  assert.equal(computeWordParts(src, left)![0].type, "SimpleExpansion");
});

// --- Edge cases ---

test("unary op at end (bare -f) is standalone word", () => {
  const t = getTest("[[ -f ]]");
  // -f with no operand → treated as implicit -n of the string "-f"
  assert.equal(t.expression.type, "TestUnary");
  assert.equal(unary(t.expression).operator, "-n");
  assert.equal(unary(t.expression).operand.text, "-f");
});

test("regex with complex pattern", () => {
  const t = getTest("[[ $ip =~ ^[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}$ ]]");
  assert.equal(binary(t.expression).operator, "=~");
});

test("multiple [[ ]] in script", () => {
  const ast = parse("[[ -f a ]]\n[[ -d b ]]");
  assert.equal(ast.commands.length, 2);
  assert.equal(ast.commands[0].command.type, "TestCommand");
  assert.equal(ast.commands[1].command.type, "TestCommand");
});

// --- [[ ]] integration with other constructs ---

test("[[ ]] does not eat < as redirection", () => {
  const ast = parse('[[ "$a" < "$b" ]] && echo less');
  const expr = ast.commands[0].command as import("../src/types.ts").AndOr;
  assert.deepEqual(expr.operators, ["&&"]);
  assert.equal(expr.commands[0].type, "TestCommand");
  assert.equal((expr.commands[1] as import("../src/types.ts").Command).name?.text, "echo");
});

test("[[ ]] with =~ regex", () => {
  const ast = parse("[[ ${1} =~ \\.(lisp|lsp|cl)$ ]]");
  const tc = ast.commands[0].command as import("../src/types.ts").TestCommand;
  assert.equal(tc.type, "TestCommand");
  assert.equal(tc.expression.type, "TestBinary");
  assert.equal((tc.expression as import("../src/types.ts").TestBinaryExpression).operator, "=~");
});

test("[[ ]] in if condition", () => {
  const ast = parse("if [[ $(cat $file) =~ $regex ]]; then\n    echo match\nfi");
  const if_ = ast.commands[0].command as import("../src/types.ts").If;
  assert.equal(if_.type, "If");
});

test("[[ ]] with or and string comparison", () => {
  const ast = parse('[[ "$lsb_dist" != "Ubuntu" || "$ver" < "14.04" ]]');
  assert.equal(ast.commands[0].command.type, "TestCommand");
});

test("[[ ]] with extglob pattern", () => {
  const ast = parse("[[ ${f} != */@(default).vim ]]");
  assert.equal(ast.commands[0].command.type, "TestCommand");
});

test("mixed test and [ with logical ops", () => {
  const ast = parse("test -d /tmp && [ -f /tmp/lock ] && echo locked");
  assert.ok(ast.commands.length > 0);
});
