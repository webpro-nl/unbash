import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "../src/parser.ts";
import type { Command } from "../src/types.ts";
import { computeWordParts } from "../src/parts.ts";

const getCmd = (ast: ReturnType<typeof parse>, i = 0) => ast.commands[i].command as Command;
const wp = (s: string, w: import("../src/types.ts").Word) => computeWordParts(s, w);

// ── Extglob operators ────────────────────────────────────────────────

test("extglob !(pattern)", () => {
  const src = "echo !(*.txt)";
  const c = getCmd(parse(src));
  const part = wp(src, c.suffix[0])![0];
  assert.equal(part.type, "ExtendedGlob");
  assert.equal((part as any).operator, "!");
  assert.equal((part as any).pattern, "*.txt");
});

test("extglob @(a|b|c)", () => {
  const src = "echo @(foo|bar|baz)";
  const c = getCmd(parse(src));
  const part = wp(src, c.suffix[0])![0];
  assert.equal(part.type, "ExtendedGlob");
  assert.equal((part as any).operator, "@");
  assert.equal((part as any).pattern, "foo|bar|baz");
});

test("extglob ?(pattern)", () => {
  const src = "echo ?(pre)fix";
  const c = getCmd(parse(src));
  const parts = wp(src, c.suffix[0])!;
  assert.equal(parts[0].type, "ExtendedGlob");
  assert.equal((parts[0] as any).operator, "?");
  assert.equal(parts[1].type, "Literal");
  assert.equal((parts[1] as any).value, "fix");
});

test("extglob +(pattern)", () => {
  const src = "echo +(digit)";
  const c = getCmd(parse(src));
  assert.equal(wp(src, c.suffix[0])![0].type, "ExtendedGlob");
  assert.equal((wp(src, c.suffix[0])![0] as any).operator, "+");
});

test("extglob *(pattern)", () => {
  const src = "echo *(any)thing";
  const c = getCmd(parse(src));
  assert.equal(wp(src, c.suffix[0])![0].type, "ExtendedGlob");
  assert.equal((wp(src, c.suffix[0])![0] as any).operator, "*");
});

test("extglob text preserved", () => {
  const c = getCmd(parse("echo !(*.log|*.tmp)"));
  assert.equal(c.suffix[0].text, "!(*.log|*.tmp)");
});

test("extglob with literal prefix", () => {
  const src = "echo file_!(*.bak)";
  const c = getCmd(parse(src));
  const parts = wp(src, c.suffix[0])!;
  assert.equal(parts[0].type, "Literal");
  assert.equal((parts[0] as any).value, "file_");
  assert.equal(parts[1].type, "ExtendedGlob");
});

test("pathname-prefixed extglob stays inside nested rm command (#313; Bash -O extglob)", () => {
  const source = `function check_pools() { (
    shopt -s nullglob extglob
    rm -fv /etc/php/*/fpm/pool.d/!(*.conf|*.orig|*.dpkg-dist)
); }`;
  const ast = parse(source);
  assert.equal(ast.errors, undefined);
  const fn = ast.commands[0].command;
  assert.deepEqual([fn.type, fn.pos, fn.end], ["Function", 0, 123]);
  if (fn.type !== "Function") return;
  assert.equal(fn.body.type, "BraceGroup");
  if (fn.body.type !== "BraceGroup") return;
  const subshell = fn.body.body.commands[0].command;
  assert.deepEqual([subshell.type, subshell.pos, subshell.end], ["Subshell", 25, 120]);
  if (subshell.type !== "Subshell") return;
  assert.equal(subshell.body.commands.length, 2);
  const rm = subshell.body.commands[1].command;
  assert.deepEqual([rm.type, rm.pos, rm.end, rm.type === "Command" && rm.name?.text], ["Command", 61, 118, "rm"]);
  if (rm.type !== "Command") return;
  const path = rm.suffix[1];
  assert.deepEqual([path.text, path.pos, path.end], ["/etc/php/*/fpm/pool.d/!(*.conf|*.orig|*.dpkg-dist)", 68, 118]);
  assert.deepEqual(wp(source, path), [
    { type: "Literal", value: "/etc/php/*/fpm/pool.d/", text: "/etc/php/*/fpm/pool.d/" },
    {
      type: "ExtendedGlob",
      text: "!(*.conf|*.orig|*.dpkg-dist)",
      operator: "!",
      pattern: "*.conf|*.orig|*.dpkg-dist",
      parts: undefined,
    },
  ]);
});

test("=(pattern) is NOT extglob (used for array assignment)", () => {
  const c = getCmd(parse("x=(a b c)"));
  assert.equal(c.prefix.length, 1);
  assert.equal(c.prefix[0].type, "Assignment");
});

// ── Text preservation ────────────────────────────────────────────────

test("extglob ?() preserved in word", () => {
  const c = getCmd(parse("ls ?(foo|bar)"));
  assert.deepEqual(
    c.suffix.map((s) => s.text),
    ["?(foo|bar)"],
  );
});

test("extglob @() preserved in word", () => {
  const c = getCmd(parse("ls @(a|b|c)"));
  assert.deepEqual(
    c.suffix.map((s) => s.text),
    ["@(a|b|c)"],
  );
});

test("extglob *() preserved in word", () => {
  const c = getCmd(parse("ls *(pat)"));
  assert.deepEqual(
    c.suffix.map((s) => s.text),
    ["*(pat)"],
  );
});

test("extglob +() preserved in word", () => {
  const c = getCmd(parse("ls +(x|y)"));
  assert.deepEqual(
    c.suffix.map((s) => s.text),
    ["+(x|y)"],
  );
});

test("extglob !() preserved in word", () => {
  const c = getCmd(parse("ls !(bad)"));
  assert.deepEqual(
    c.suffix.map((s) => s.text),
    ["!(bad)"],
  );
});

test("nested extglob preserved", () => {
  const c = getCmd(parse("ls @(a|+(b|c))"));
  assert.deepEqual(
    c.suffix.map((s) => s.text),
    ["@(a|+(b|c))"],
  );
});

test("case is literal inside an extended glob", () => {
  const src = "echo @(case|foo) tail";
  const c = getCmd(parse(src));
  assert.deepEqual(
    c.suffix.map((word) => word.text),
    ["@(case|foo)", "tail"],
  );
});

// ── Tokenizer disambiguation ─────────────────────────────────────────

test("extglob @() not confused with subshell", () => {
  const c = getCmd(parse("ls @(a|b)"));
  assert.deepEqual(
    c.suffix.map((s) => s.text),
    ["@(a|b)"],
  );
});

test("extglob !() not confused with negation", () => {
  const c = getCmd(parse("ls !(bad)"));
  assert.deepEqual(
    c.suffix.map((s) => s.text),
    ["!(bad)"],
  );
});

test("nested extglob in tokenizer", () => {
  const c = getCmd(parse("ls @(a|+(b|c))"));
  assert.deepEqual(
    c.suffix.map((s) => s.text),
    ["@(a|+(b|c))"],
  );
});

test("extglob in [[ ]] condition", () => {
  const ast = parse("[[ ${f} != */@(default).vim ]]");
  assert.ok(ast.commands.length > 0);
});

test("command substitutions inside extended globs remain structured", () => {
  const src = "echo @($(one)|safe$(two))";
  const c = getCmd(parse(src));
  const part = wp(src, c.suffix[0])![0];
  assert.equal(part.type, "ExtendedGlob");
  if (part.type !== "ExtendedGlob") return;
  const expansions = part.parts?.filter((child) => child.type === "CommandExpansion") ?? [];
  assert.deepEqual(
    expansions.map((expansion) => {
      if (expansion.type !== "CommandExpansion") return undefined;
      const command = expansion.script?.commands[0].command;
      return command?.type === "Command" ? command.name?.value : undefined;
    }),
    ["one", "two"],
  );
});

test("process substitutions inside extended globs remain structured", () => {
  const src = "echo @(<(danger)|safe)";
  const c = getCmd(parse(src));
  const part = wp(src, c.suffix[0])![0];
  assert.equal(part.type, "ExtendedGlob");
  if (part.type !== "ExtendedGlob") return;
  const expansion = part.parts?.find((child) => child.type === "ProcessSubstitution");
  assert.equal(expansion?.type, "ProcessSubstitution");
  if (expansion?.type !== "ProcessSubstitution") return;
  const command = expansion.script?.commands[0].command;
  assert.equal(command?.type, "Command");
  if (command?.type === "Command") assert.equal(command.name?.value, "danger");
});

test("closing parentheses inside substitutions do not truncate extended globs", () => {
  const src = 'echo @($(printf ")")|safe)';
  const c = getCmd(parse(src));
  const part = wp(src, c.suffix[0])![0];
  assert.equal(part.type, "ExtendedGlob");
  if (part.type !== "ExtendedGlob") return;
  assert.equal(part.pattern, '$(printf ")")|safe');
  const expansion = part.parts?.find((child) => child.type === "CommandExpansion");
  assert.equal(expansion?.type, "CommandExpansion");
  if (expansion?.type !== "CommandExpansion") return;
  const command = expansion.script?.commands[0].command;
  assert.equal(command?.type, "Command");
  if (command?.type === "Command") assert.equal(command.name?.value, "printf");
});

test("unterminated extended globs report an error without truncating nested substitutions", () => {
  const src = "echo @(safe|$(danger)";
  const ast = parse(src);
  const c = getCmd(ast);
  const part = wp(src, c.suffix[0])![0];
  assert.equal(part.type, "ExtendedGlob");
  if (part.type !== "ExtendedGlob") return;
  const expansion = part.parts?.find((child) => child.type === "CommandExpansion");
  assert.equal(expansion?.type, "CommandExpansion");
  if (expansion?.type !== "CommandExpansion") return;
  const command = expansion.script?.commands[0].command;
  assert.equal(command?.type, "Command");
  if (command?.type === "Command") assert.equal(command.name?.value, "danger");
  assert.ok(ast.errors?.some((error) => error.message === "unterminated extended glob"));
});
