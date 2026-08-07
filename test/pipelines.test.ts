import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "../src/parser.ts";
import type { Command, AndOr, Pipeline } from "../src/types.ts";

const names = (nodes: unknown[]) => nodes.map((n) => (n as Command).name?.text);
const args = (c: Command) => c.suffix.map((s) => s.text);

// ── Logical expressions ───────────────────────────────────────────────

test("logical AND", () => {
  const expr = parse("cmd1 && cmd2").commands[0].command as AndOr;
  assert.deepEqual(expr.operators, ["&&"]);
  assert.equal((expr.commands[0] as Command).name?.text, "cmd1");
  assert.equal((expr.commands[1] as Command).name?.text, "cmd2");
});

test("logical OR", () => {
  const expr = parse("cmd1 || cmd2").commands[0].command as AndOr;
  assert.deepEqual(expr.operators, ["||"]);
});

test("chained: a && b || c", () => {
  const expr = parse("a && b || c").commands[0].command as AndOr;
  assert.deepEqual(expr.operators, ["&&", "||"]);
  assert.equal(expr.commands.length, 3);
});

// ── Pipelines ─────────────────────────────────────────────────────────

test("pipeline preserves all commands and args", () => {
  const p = parse("cat file | grep pattern | sort -u").commands[0].command as Pipeline;
  assert.equal(p.commands.length, 3);
  assert.deepEqual(names(p.commands), ["cat", "grep", "sort"]);
  assert.deepEqual(args(p.commands[2] as Command), ["-u"]);
});

test("pipeline in logical expression", () => {
  const expr = parse("cmd1 | cmd2 && cmd3").commands[0].command as AndOr;
  assert.equal(expr.commands[0].type, "Pipeline");
});

test("negated pipeline", () => {
  const p = parse("! cmd1 | cmd2").commands[0].command as Pipeline;
  assert.equal(p.negated, true);
});

test("|& pipes both stdout and stderr", () => {
  const p = parse("cmd1 |& cmd2").commands[0].command as Pipeline;
  assert.equal(p.type, "Pipeline");
  assert.equal(p.commands.length, 2);
  assert.deepEqual(p.operators, ["|&"]);
});

test("plain | pipeline has no ops", () => {
  const p = parse("cmd1 | cmd2 | cmd3").commands[0].command as Pipeline;
  assert.deepEqual(p.operators, ["|", "|"]);
});

test("mixed | and |& captures ops", () => {
  const p = parse("cmd1 | cmd2 |& cmd3").commands[0].command as Pipeline;
  assert.deepEqual(p.operators, ["|", "|&"]);
});

// ── Background (&) ───────────────────────────────────────────────────

test("background command", () => {
  const ast = parse("sleep 10 &");
  assert.equal(ast.commands[0].background, true);
});

test("background first command in list", () => {
  const ast = parse("cmd1 & cmd2");
  assert.equal(ast.commands[0].background, true);
  assert.equal(ast.commands[1].background, undefined);
});

test("background pipeline", () => {
  const ast = parse("cmd1 | cmd2 &");
  assert.equal(ast.commands[0].background, true);
});

test("no background on semicolon", () => {
  const ast = parse("cmd1; cmd2");
  assert.equal(ast.commands[0].background, undefined);
  assert.equal(ast.commands[1].background, undefined);
});

test("negated compound with redirect and background", () => {
  const ast = parse("! if foo; then bar; fi >/dev/null &");
  assert.ok(ast.commands.length > 0);
});

test("background in logical expression", () => {
  const ast = parse("a && b & c");
  assert.ok(ast.commands.length >= 2);
});

// ── Time prefix ──────────────────────────────────────────────────────

test("time simple command", () => {
  const p = parse("time sleep 1").commands[0].command as Pipeline;
  assert.equal(p.time, true);
  assert.equal(p.commands.length, 1);
  assert.equal((p.commands[0] as Command).name?.text, "sleep");
});

test("time pipeline", () => {
  const p = parse("time cmd1 | cmd2").commands[0].command as Pipeline;
  assert.equal(p.time, true);
  assert.equal(p.commands.length, 2);
});

test("time -p flag consumed", () => {
  const p = parse("time -p cmd").commands[0].command as Pipeline;
  assert.equal(p.time, true);
  assert.equal((p.commands[0] as Command).name?.text, "cmd");
});

test("time with negation", () => {
  const p = parse("time ! cmd").commands[0].command as Pipeline;
  assert.equal(p.time, true);
  assert.equal(p.negated, true);
});

test("time allows unquoted backslash-newline continuations", () => {
  const cases: [string, boolean | undefined, number][] = [
    ["ti\\" + "\nme echo", undefined, 1],
    ["time\\" + "\n -p echo", undefined, 1],
    ["ti\\" + "\nme ! echo", true, 1],
    ["ti\\" + "\nme echo | cat", undefined, 2],
  ];
  for (const [source, negated, commandCount] of cases) {
    const ast = parse(source);
    const pipeline = ast.commands[0].command;

    assert.equal(pipeline.type, "Pipeline", source);
    assert.equal(pipeline.type === "Pipeline" && pipeline.time, true, source);
    assert.equal(pipeline.type === "Pipeline" && pipeline.negated, negated, source);
    assert.equal(pipeline.type === "Pipeline" && pipeline.commands.length, commandCount, source);
    assert.equal(ast.errors, undefined, source);
  }
});

test("quoted and escaped time spellings remain command names", () => {
  for (const source of [
    "'time' echo",
    '"time" echo',
    "$'time' echo",
    '$"time" echo',
    "ti$''me echo",
    "\\time echo",
    "t\\ime echo",
    "ti'me' echo",
    'ti"me" echo',
  ]) {
    const ast = parse(source);
    const command = ast.commands[0].command;

    assert.equal(command.type, "Command", source);
    assert.equal(command.type === "Command" && command.name?.value, "time", source);
    assert.deepEqual(command.type === "Command" && command.suffix.map((word) => word.value), ["echo"], source);
    assert.equal(ast.errors, undefined, source);
  }
});

test("time alone produces a node", () => {
  const ast = parse("time");
  assert.equal(ast.commands.length, 1);
  const p = ast.commands[0].command as Pipeline;
  assert.equal(p.type, "Pipeline");
  assert.equal(p.time, true);
  assert.equal(p.commands.length, 0);
});

test("time -p alone produces a node", () => {
  const ast = parse("time -p");
  assert.equal(ast.commands.length, 1);
  const p = ast.commands[0].command as Pipeline;
  assert.equal(p.time, true);
  assert.equal(p.commands.length, 0);
});

test("time on its own line followed by command", () => {
  const ast = parse("time\nfoo");
  assert.equal(ast.commands.length, 2);
  assert.equal((ast.commands[0].command as Pipeline).time, true);
  assert.equal((ast.commands[1].command as Command).name?.text, "foo");
});

test("quoted time flags stay operands", () => {
  // Bash runs `time '-p' echo hi` as a command named -p, so the quoted flag is not the
  // POSIX option. The `-p` must survive as the timed pipeline's command name.
  for (const source of ["time '-p' echo hi", 'time "-p" echo hi', "time \\-p echo hi"]) {
    const pipeline = parse(source).commands[0].command;
    assert.equal(pipeline.type, "Pipeline", source);
    assert.equal(pipeline.type === "Pipeline" && pipeline.time, true, source);
    const inner = pipeline.type === "Pipeline" ? pipeline.commands[0] : undefined;
    assert.equal(inner?.type === "Command" && inner.name?.value, "-p", source);
  }
});

test("unquoted time -p is still the POSIX flag", () => {
  const pipeline = parse("time -p echo hi").commands[0].command;
  assert.equal(pipeline.type === "Pipeline" && pipeline.time, true);
  const inner = pipeline.type === "Pipeline" ? pipeline.commands[0] : undefined;
  assert.equal(inner?.type === "Command" && inner.name?.value, "echo");
});
