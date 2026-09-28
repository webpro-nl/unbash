import { nodeOfType, argumentsOf, redirectsOf } from "./ast-helpers.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "../src/parser.ts";
import type { Command } from "../src/types.ts";
import { computeWordParts } from "../src/parts.ts";

const getCmd = (ast: ReturnType<typeof parse>, i = 0) => nodeOfType(ast.commands[i].command, "Command");
const wp = (s: string, w: import("../src/types.ts").Word) => computeWordParts(s, w);
const args = (c: Command) => argumentsOf(c).map((s) => s.text);

// ── <() and >() as word parts ────────────────────────────────────────

test("process substitution <() as word part", () => {
  const src = "diff <(sort a) <(sort b)";
  const c = getCmd(parse(src));
  assert.equal(c.suffix.length, 2);
  assert.ok(wp(src, nodeOfType(c.suffix[0], "Word")));
  assert.equal(wp(src, nodeOfType(c.suffix[0], "Word"))![0].type, "ProcessSubstitution");
  assert.equal(nodeOfType(wp(src, nodeOfType(c.suffix[0], "Word"))![0], "ProcessSubstitution").operator, "<");
  assert.ok(nodeOfType(wp(src, nodeOfType(c.suffix[0], "Word"))![0], "ProcessSubstitution").script);
});

test("process substitution >() as word part", () => {
  const src = "tee >(grep err)";
  const c = getCmd(parse(src));
  assert.ok(wp(src, nodeOfType(c.suffix[0], "Word")));
  assert.equal(wp(src, nodeOfType(c.suffix[0], "Word"))![0].type, "ProcessSubstitution");
  assert.equal(nodeOfType(wp(src, nodeOfType(c.suffix[0], "Word"))![0], "ProcessSubstitution").operator, ">");
});

test("process substitution text preserved", () => {
  const c = getCmd(parse("cat <(echo hello)"));
  assert.equal(nodeOfType(c.suffix[0], "Word").text, "<(echo hello)");
});

test("process substitution script parsed", () => {
  const src = "cat <(echo hello)";
  const c = getCmd(parse(src));
  const ps = nodeOfType(wp(src, nodeOfType(c.suffix[0], "Word"))![0], "ProcessSubstitution");
  assert.equal(nodeOfType(ps.script?.commands[0].command, "Command").name?.text, "echo");
});

test("multiple process substitutions", () => {
  const src = "paste <(cut -f1 a) <(cut -f2 a)";
  const c = getCmd(parse(src));
  assert.equal(c.suffix.length, 2);
  assert.equal(wp(src, nodeOfType(c.suffix[0], "Word"))![0].type, "ProcessSubstitution");
  assert.equal(wp(src, nodeOfType(c.suffix[1], "Word"))![0].type, "ProcessSubstitution");
});

test("redirect to process substitution", () => {
  const c = getCmd(parse("cmd > >(tee log)"));
  assert.ok(redirectsOf(c));
  assert.equal(redirectsOf(c)![0].operator, ">");
});

// ── Inner script structure ───────────────────────────────────────────

test(">(cmd) inner scripts have correct commands", () => {
  const src = "tee >(grep pattern > matches.txt) >(wc -l > count.txt)";
  const c = getCmd(parse(src));
  const ps1 = wp(src, nodeOfType(c.suffix[0], "Word"))?.[0];
  const ps2 = wp(src, nodeOfType(c.suffix[1], "Word"))?.[0];
  assert.equal(ps1?.type, "ProcessSubstitution");
  assert.equal(ps2?.type, "ProcessSubstitution");
  if (ps1?.type === "ProcessSubstitution" && ps2?.type === "ProcessSubstitution") {
    assert.equal(nodeOfType(ps1.script!.commands[0].command, "Command").name?.text, "grep");
    assert.deepEqual(args(nodeOfType(ps1.script!.commands[0].command, "Command")), ["pattern"]);
    assert.equal(nodeOfType(ps2.script!.commands[0].command, "Command").name?.text, "wc");
  }
});

test("<(cmd) inner scripts have correct commands", () => {
  const src = "diff <(sort file1) <(sort file2)";
  const c = getCmd(parse(src));
  const ps1 = wp(src, nodeOfType(c.suffix[0], "Word"))?.[0];
  const ps2 = wp(src, nodeOfType(c.suffix[1], "Word"))?.[0];
  assert.equal(ps1?.type, "ProcessSubstitution");
  assert.equal(ps2?.type, "ProcessSubstitution");
  if (ps1?.type === "ProcessSubstitution" && ps2?.type === "ProcessSubstitution") {
    assert.equal(nodeOfType(ps1.script!.commands[0].command, "Command").name?.text, "sort");
    assert.equal(nodeOfType(ps2.script!.commands[0].command, "Command").name?.text, "sort");
  }
});

test("<(cmd) inner script preserves structure", () => {
  const src = "wc -c <(echo abc && echo def)";
  const c = getCmd(parse(src));
  const ps = wp(src, nodeOfType(c.suffix[1], "Word"))?.[0];
  assert.equal(ps?.type, "ProcessSubstitution");
  if (ps?.type === "ProcessSubstitution") {
    const inner = nodeOfType(ps.script!.commands[0].command, "AndOr");
    assert.equal(inner.type, "AndOr");
    assert.deepEqual(inner.operators, ["&&"]);
  }
});

// ── Process substitution with redirects ──────────────────────────────

test("< <(cmd) in while loop", () => {
  const src = "while read line; do echo $line; done < <(cat file)";
  const ast = parse(src);
  const stmt = ast.commands[0];
  assert.equal(stmt.command.type, "Redirected");
  assert.equal(stmt.command.type === "Redirected" && stmt.command.command.type, "While");
  const target = nodeOfType(nodeOfType(redirectsOf(stmt)[0], "Redirect").target, "Word");
  const ps = wp(src, target)?.[0];
  assert.equal(ps?.type, "ProcessSubstitution");
  if (ps?.type === "ProcessSubstitution") {
    assert.equal(nodeOfType(ps.script!.commands[0].command, "Command").name?.text, "cat");
  }
});

test("tee with multiple process substitutions and redirect", () => {
  const ast = parse("echo data | tee >(grep pattern > matches.txt) >(wc -l > count.txt) > /dev/null");
  assert.ok(ast.commands.length > 0);
});

test("mapfile with process substitution", () => {
  const ast = parse("mapfile -t ITEMS < <(echo \"$URL\" | tr '/' '\\n')");
  assert.ok(ast.commands.length > 0);
});

// ── Disambiguation: < <() vs <() ─────────────────────────────────────

test("< <(...) is redirect + process substitution (space between)", () => {
  const ast = parse("cmd < <(echo data)");
  assert.ok(ast.commands.length > 0);
  const c = getCmd(ast);
  const src1 = "cmd < <(echo data)";
  const procSub = computeWordParts(src1, nodeOfType(redirectsOf(c)[0], "HereString", "Redirect").target!)?.find(
    (p) => p.type === "ProcessSubstitution",
  );
  assert.ok(procSub);
});

test("<(...) is process substitution", () => {
  const ast = parse("diff <(sort a) <(sort b)");
  const c = getCmd(ast);
  const src2 = "diff <(sort a) <(sort b)";
  const procParts = c.suffix.filter((s) => computeWordParts(src2, s)?.some((p) => p.type === "ProcessSubstitution"));
  assert.equal(procParts.length, 2);
});

test("> >(...) is redirect + process substitution", () => {
  const ast = parse("cmd > >(tee log)");
  assert.ok(ast.commands.length > 0);
});
