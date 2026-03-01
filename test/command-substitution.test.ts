import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "../src/parser.ts";
import type { Command } from "../src/types.ts";
import { computeWordParts } from "../src/parts.ts";

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
