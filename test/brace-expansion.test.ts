import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "../src/parser.ts";
import type { Command } from "../src/types.ts";
import { computeWordParts } from "../src/parts.ts";

const getCmd = (ast: ReturnType<typeof parse>, i = 0) => ast.commands[i].command as Command;
const wp = (s: string, w: import("../src/types.ts").Word) => computeWordParts(s, w);

// ── Brace expansion ──────────────────────────────────────────────────

test("brace expansion {a,b,c}", () => {
  const src = "echo {a,b,c}";
  const c = getCmd(parse(src));
  const part = wp(src, c.suffix[0])![0];
  assert.equal(part.type, "BraceExpansion");
  assert.equal((part as any).text, "{a,b,c}");
});

test("brace expansion {1..10}", () => {
  const src = "echo {1..10}";
  const c = getCmd(parse(src));
  assert.equal(wp(src, c.suffix[0])![0].type, "BraceExpansion");
});

test("brace expansion with step {01..100..5}", () => {
  const src = "echo {01..100..5}";
  const c = getCmd(parse(src));
  assert.equal(wp(src, c.suffix[0])![0].type, "BraceExpansion");
});

test("brace expansion with suffix", () => {
  const src = "echo {a,b,c}.txt";
  const c = getCmd(parse(src));
  const parts = wp(src, c.suffix[0])!;
  assert.equal(parts[0].type, "BraceExpansion");
  assert.equal((parts[0] as any).text, "{a,b,c}");
  assert.equal(parts[1].type, "Literal");
  assert.equal((parts[1] as any).value, ".txt");
});

test("brace expansion with prefix", () => {
  const src = "echo file{1,2,3}";
  const c = getCmd(parse(src));
  const parts = wp(src, c.suffix[0])!;
  assert.equal(parts[0].type, "Literal");
  assert.equal((parts[0] as any).value, "file");
  assert.equal(parts[1].type, "BraceExpansion");
});

test("brace expansion text preserved", () => {
  const c = getCmd(parse("echo {a,b,c}.txt"));
  assert.equal(c.suffix[0].text, "{a,b,c}.txt");
});

test("nested brace expansion", () => {
  const src = "echo {a,{b,c}}";
  const c = getCmd(parse(src));
  assert.equal(wp(src, c.suffix[0])![0].type, "BraceExpansion");
});

test("single item brace is NOT expansion", () => {
  const c = getCmd(parse("echo {foo}"));
  assert.equal(wp("echo {foo}", c.suffix[0]), undefined);
  assert.equal(c.suffix[0].text, "{foo}");
});

test("empty brace pair is NOT expansion", () => {
  const c = getCmd(parse("echo {}"));
  assert.equal(c.suffix[0].text, "{}");
});

test("multiple brace expansions in word", () => {
  const src = "echo {a,b}{c,d}";
  const c = getCmd(parse(src));
  const parts = wp(src, c.suffix[0])!;
  assert.equal(parts.filter((p) => p.type === "BraceExpansion").length, 2);
});

test("command substitutions inside brace expansions remain structured", () => {
  const src = "echo {safe,$(danger)}";
  const c = getCmd(parse(src));
  const part = wp(src, c.suffix[0])![0];
  assert.equal(part.type, "BraceExpansion");
  if (part.type !== "BraceExpansion") return;
  const expansion = part.parts?.find((child) => child.type === "CommandExpansion");
  assert.equal(expansion?.type, "CommandExpansion");
  if (expansion?.type !== "CommandExpansion") return;
  const command = expansion.script?.commands[0].command;
  assert.equal(command?.type, "Command");
  if (command?.type === "Command") assert.equal(command.name?.value, "danger");
});

test("process substitutions inside brace expansions remain structured", () => {
  const src = "echo {safe,<(danger)}";
  const c = getCmd(parse(src));
  const part = wp(src, c.suffix[0])![0];
  assert.equal(part.type, "BraceExpansion");
  if (part.type !== "BraceExpansion") return;
  const expansion = part.parts?.find((child) => child.type === "ProcessSubstitution");
  assert.equal(expansion?.type, "ProcessSubstitution");
  if (expansion?.type !== "ProcessSubstitution") return;
  const command = expansion.script?.commands[0].command;
  assert.equal(command?.type, "Command");
  if (command?.type === "Command") assert.equal(command.name?.value, "danger");
});
