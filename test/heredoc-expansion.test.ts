import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "../src/parser.ts";
import type { Command, Redirect } from "../src/types.ts";
import { computeHereDocBodyParts } from "../src/parts.ts";

const wp = (s: string, w: import("../src/types.ts").Word) => computeHereDocBodyParts(s, w);

const getRedirect = (src: string, i = 0, ri = 0): Redirect => {
  const ast = parse(src);
  const cmd = ast.commands[i].command as Command;
  assert.ok(cmd.redirects, "expected redirects");
  return cmd.redirects![ri];
};

// --- Unquoted heredocs: expansions parsed ---

test("unquoted heredoc has body with parts", () => {
  const src = "cat <<EOF\nHello $name\nEOF\n";
  const r = getRedirect(src);
  assert.equal(r.operator, "<<");
  assert.equal(r.content, "Hello $name\n");
  assert.ok(r.body);
  assert.ok(wp(src, r.body!));
  assert.equal(r.body!.text, "Hello $name\n");
});

test("unquoted heredoc body has SimpleExpansion parts", () => {
  const src = "cat <<EOF\nHello $name world\nEOF\n";
  const r = getRedirect(src);
  assert.ok(wp(src, r.body!));
  const parts = wp(src, r.body!)!;
  assert.equal(parts[0].type, "Literal");
  assert.equal((parts[0] as any).value, "Hello ");
  assert.equal(parts[1].type, "SimpleExpansion");
  assert.equal((parts[1] as any).text, "$name");
  assert.equal(parts[2].type, "Literal");
  assert.equal((parts[2] as any).value, " world\n");
});

test("unquoted heredoc with ${...} param expansion", () => {
  const src = "cat <<EOF\n${var:-default}\nEOF\n";
  const r = getRedirect(src);
  assert.ok(wp(src, r.body!));
  const pe = wp(src, r.body!)!.find((p) => p.type === "ParameterExpansion");
  assert.ok(pe);
  assert.equal((pe as any).parameter, "var");
});

test("unquoted heredoc with $(...) command substitution", () => {
  const src = "cat <<EOF\ndir: $(pwd)\nEOF\n";
  const r = getRedirect(src);
  assert.ok(wp(src, r.body!));
  const cs = wp(src, r.body!)!.find((p) => p.type === "CommandExpansion");
  assert.ok(cs);
  assert.ok((cs as any).script);
});

test("unquoted heredoc with $((...)) arithmetic", () => {
  const src = "cat <<EOF\nresult: $((1+2))\nEOF\n";
  const r = getRedirect(src);
  assert.ok(wp(src, r.body!));
  const ae = wp(src, r.body!)!.find((p) => p.type === "ArithmeticExpansion");
  assert.ok(ae);
  assert.ok((ae as any).expression);
});

test("unquoted heredoc with backtick expansion", () => {
  const src = "cat <<EOF\nhost: `hostname`\nEOF\n";
  const r = getRedirect(src);
  assert.ok(wp(src, r.body!));
  const cs = wp(src, r.body!)!.find((p) => p.type === "CommandExpansion");
  assert.ok(cs);
});

test("unquoted heredoc with multiple expansions", () => {
  const src = "cat <<EOF\n$name has $count items\nEOF\n";
  const r = getRedirect(src);
  assert.ok(wp(src, r.body!));
  const expansions = wp(src, r.body!)!.filter((p) => p.type === "SimpleExpansion");
  assert.equal(expansions.length, 2);
});

test("unquoted heredoc with escaped dollar", () => {
  const src = "cat <<EOF\n\\$literal and $real\nEOF\n";
  const r = getRedirect(src);
  assert.ok(wp(src, r.body!));
  // The \\$ should be literal $, and $real should be SimpleExpansion
  const se = wp(src, r.body!)!.filter((p) => p.type === "SimpleExpansion");
  assert.equal(se.length, 1);
  assert.equal((se[0] as any).text, "$real");
});

test("unquoted heredoc preserves content field", () => {
  const r = getRedirect("cat <<EOF\nHello $name\nEOF\n");
  assert.equal(r.content, "Hello $name\n");
  assert.ok(r.body);
});

test("unquoted heredoc no heredocQuoted", () => {
  const r = getRedirect("cat <<EOF\ntext\nEOF\n");
  assert.equal(r.heredocQuoted, undefined);
});

// --- Quoted heredocs: no expansion ---

test("single-quoted delimiter suppresses expansion", () => {
  const r = getRedirect("cat <<'EOF'\n$name ${var}\nEOF\n");
  assert.equal(r.heredocQuoted, true);
  assert.equal(r.body, undefined);
  assert.equal(r.content, "$name ${var}\n");
});

test("double-quoted delimiter suppresses expansion", () => {
  const r = getRedirect('cat <<"EOF"\n$name\nEOF\n');
  assert.equal(r.heredocQuoted, true);
  assert.equal(r.body, undefined);
});

test("backslash-escaped delimiter suppresses expansion", () => {
  const r = getRedirect("cat <<\\EOF\n$name\nEOF\n");
  assert.equal(r.heredocQuoted, true);
  assert.equal(r.body, undefined);
});

// --- Strip heredoc (<<-) ---

test("<<- with unquoted delimiter has body", () => {
  const src = "cat <<-EOF\n\tHello $name\nEOF\n";
  const r = getRedirect(src);
  assert.equal(r.operator, "<<-");
  assert.ok(wp(src, r.body!));
  const se = wp(src, r.body!)!.find((p) => p.type === "SimpleExpansion");
  assert.ok(se);
});

test("<<- with quoted delimiter has no body", () => {
  const r = getRedirect("cat <<-'EOF'\n\t$name\nEOF\n");
  assert.equal(r.heredocQuoted, true);
  assert.equal(r.body, undefined);
});

// --- Plain text heredocs ---

test("unquoted heredoc with no expansions has no body", () => {
  const r = getRedirect("cat <<EOF\njust plain text\nEOF\n");
  // No $, no `, so no expansion parts needed
  assert.equal(r.body, undefined);
  assert.equal(r.content, "just plain text\n");
});

// --- Heredoc body has expansion field ---

test("unquoted heredoc body has CommandExpansion in parts", () => {
  const src = "cat <<EOF\ndir: $(pwd)\nEOF\n";
  const r = getRedirect(src);
  assert.ok(wp(src, r.body!));
  const cmdParts = wp(src, r.body!)!.filter((p) => p.type === "CommandExpansion");
  assert.equal(cmdParts.length, 1);
  assert.ok((cmdParts[0] as any).script);
});

// --- Edge cases ---

test("empty heredoc body", () => {
  const r = getRedirect("cat <<EOF\nEOF\n");
  assert.equal(r.content, "");
  assert.equal(r.body, undefined);
});

test("heredoc with only whitespace", () => {
  const r = getRedirect("cat <<EOF\n   \nEOF\n");
  assert.equal(r.body, undefined);
});

test("heredoc with bare dollar at end of line", () => {
  const r = getRedirect("cat <<EOF\nprice: $\nEOF\n");
  // bare $ is literal
  assert.equal(r.body, undefined);
});
