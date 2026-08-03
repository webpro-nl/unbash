import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "../src/parser.ts";
import type { AssignmentPrefix, Command } from "../src/types.ts";
import { computeWordParts } from "../src/parts.ts";

const getAssign = (src: string, i = 0): AssignmentPrefix => {
  const ast = parse(src);
  const cmd = ast.commands[0].command as Command;
  const assigns = cmd.prefix.filter((p) => p.type === "Assignment");
  return assigns[i] as AssignmentPrefix;
};

// --- Basic scalar assignments ---

test("simple scalar assignment", () => {
  const a = getAssign("x=hello");
  assert.equal(a.name, "x");
  assert.equal(a.value?.text, "hello");
  assert.equal(a.append, undefined);
  assert.equal(a.index, undefined);
  assert.equal(a.array, undefined);
});

test("empty value assignment", () => {
  const a = getAssign("IFS=");
  assert.equal(a.name, "IFS");
  assert.equal(a.value?.text, "");
});

test("value with = sign", () => {
  const a = getAssign("a=b=c");
  assert.equal(a.name, "a");
  assert.equal(a.value?.text, "b=c");
});

test("path value", () => {
  const a = getAssign("PATH=/usr/local/bin");
  assert.equal(a.name, "PATH");
  assert.equal(a.value?.text, "/usr/local/bin");
});

test("numeric value", () => {
  const a = getAssign("n=42");
  assert.equal(a.name, "n");
  assert.equal(a.value?.text, "42");
});

// --- Append assignments ---

test("append scalar", () => {
  const a = getAssign("x+=more");
  assert.equal(a.name, "x");
  assert.equal(a.append, true);
  assert.equal(a.value?.text, "more");
});

test("append empty", () => {
  const a = getAssign("x+=");
  assert.equal(a.name, "x");
  assert.equal(a.append, true);
  assert.equal(a.value?.text, "");
});

// --- Indexed assignments ---

test("indexed assignment", () => {
  const a = getAssign("x[0]=val");
  assert.equal(a.name, "x");
  assert.equal(a.index, "0");
  assert.equal(a.value?.text, "val");
});

test("indexed assignment with variable index", () => {
  const a = getAssign("x[idx]=val");
  assert.equal(a.name, "x");
  assert.equal(a.index, "idx");
  assert.equal(a.value?.text, "val");
});

test("indexed append assignment", () => {
  const a = getAssign("x[0]+=val");
  assert.equal(a.name, "x");
  assert.equal(a.index, "0");
  assert.equal(a.append, true);
  assert.equal(a.value?.text, "val");
});

// --- Array assignments ---

test("simple array assignment", () => {
  const a = getAssign("x=(a b c)");
  assert.equal(a.name, "x");
  assert.ok(a.array);
  assert.equal(a.array!.length, 3);
  assert.equal(a.array![0].text, "a");
  assert.equal(a.array![1].text, "b");
  assert.equal(a.array![2].text, "c");
});

test("array append", () => {
  const a = getAssign("x+=(d e)");
  assert.equal(a.name, "x");
  assert.equal(a.append, true);
  assert.ok(a.array);
  assert.equal(a.array!.length, 2);
});

test("empty array", () => {
  const a = getAssign("x=()");
  assert.equal(a.name, "x");
  assert.ok(a.array);
  assert.equal(a.array!.length, 0);
});

test("array with quoted elements", () => {
  const a = getAssign("x=(\"hello world\" 'literal')");
  assert.equal(a.name, "x");
  assert.ok(a.array);
  assert.equal(a.array!.length, 2);
  assert.equal(a.array![0].text, '"hello world"');
  assert.equal(a.array![1].text, "'literal'");
});

test("array with command substitution", () => {
  const input = "x=($(seq 1 5))";
  const a = getAssign(input);
  assert.equal(a.name, "x");
  assert.ok(a.array);
  assert.equal(a.array!.length, 1);
  assert.equal(computeWordParts(input, a.array![0])![0].type, "CommandExpansion");
});

test("associative array with index elements", () => {
  const a = getAssign("x=([a]=1 [b]=2)");
  assert.equal(a.name, "x");
  assert.ok(a.array);
  assert.equal(a.array!.length, 2);
});

// --- Value with expansions ---

test("value with simple expansion", () => {
  const input = "x=$HOME/bin";
  const a = getAssign(input);
  assert.equal(a.name, "x");
  assert.equal(a.value?.text, "$HOME/bin");
  assert.ok(computeWordParts(input, a.value!));
  assert.equal(computeWordParts(input, a.value!)![0].type, "SimpleExpansion");
});

test("value with command substitution", () => {
  const input = "y=$(echo hi)";
  const a = getAssign(input);
  assert.equal(a.name, "y");
  assert.equal(computeWordParts(input, a.value!)![0].type, "CommandExpansion");
  assert.ok((computeWordParts(input, a.value!)![0] as any).script);
});

test("value with double-quoted expansion", () => {
  const input = 'z="hello $name"';
  const a = getAssign(input);
  assert.equal(a.name, "z");
  assert.equal(a.value?.text, '"hello $name"');
  assert.ok(computeWordParts(input, a.value!));
  assert.equal(computeWordParts(input, a.value!)![0].type, "DoubleQuoted");
});

test("value with param expansion", () => {
  const input = "x=${var:-default}";
  const a = getAssign(input);
  assert.equal(a.name, "x");
  assert.ok(computeWordParts(input, a.value!));
  assert.equal(computeWordParts(input, a.value!)![0].type, "ParameterExpansion");
});

// --- Multiple assignments ---

test("multiple assignments", () => {
  const a0 = getAssign("A=1 B=2 cmd", 0);
  const a1 = getAssign("A=1 B=2 cmd", 1);
  assert.equal(a0.name, "A");
  assert.equal(a0.value?.text, "1");
  assert.equal(a1.name, "B");
  assert.equal(a1.value?.text, "2");
});

test("env var prefix with command", () => {
  const ast = parse("NODE_ENV=production node app.js");
  const cmd = ast.commands[0].command as Command;
  const a = cmd.prefix[0] as AssignmentPrefix;
  assert.equal(a.name, "NODE_ENV");
  assert.equal(a.value?.text, "production");
  assert.equal(cmd.name?.text, "node");
});

// --- Text field preserved ---

test("text field always present", () => {
  const a = getAssign("x=hello");
  assert.equal(a.text, "x=hello");
});

test("text field for array", () => {
  const a = getAssign("x=(a b c)");
  assert.equal(a.text, "x=(a b c)");
});

test("text field for append", () => {
  const a = getAssign("x+=more");
  assert.equal(a.text, "x+=more");
});

test("text field for indexed", () => {
  const a = getAssign("x[0]=val");
  assert.equal(a.text, "x[0]=val");
});

// --- Assignment as prefix ---

test("assignment prefix on command", () => {
  const ast = parse("NODE_ENV=production program");
  const c = ast.commands[0].command as Command;
  assert.equal(c.name?.text, "program");
  const p = c.prefix[0];
  assert.equal(p.type, "Assignment");
  if (p.type === "Assignment") assert.equal(p.text, "NODE_ENV=production");
});

test("assignment-only (no command)", () => {
  const ast = parse("FOO=bar");
  const c = ast.commands[0].command as Command;
  assert.equal(c.name, undefined);
  const p = c.prefix[0];
  assert.equal(p.type, "Assignment");
  if (p.type === "Assignment") assert.equal(p.text, "FOO=bar");
});

// --- Array assignments ---

test("array assignment in prefix", () => {
  const ast = parse("x=(a b c)");
  const c = ast.commands[0].command as Command;
  assert.equal(c.prefix.length, 1);
  const p = c.prefix[0] as import("../src/types.ts").AssignmentPrefix;
  assert.equal(p.type, "Assignment");
  assert.equal(p.text, "x=(a b c)");
});

test("declare with array assignment", () => {
  const ast = parse("declare -a arr=(one two three)");
  const c = ast.commands[0].command as Command;
  assert.equal(c.name?.text, "declare");
  assert.deepEqual(
    c.suffix.map((s) => s.text),
    ["-a", "arr=(one two three)"],
  );
});

test("associative array assignment", () => {
  const ast = parse("declare -A map=([a]=1 [b]=2)");
  const c = ast.commands[0].command as Command;
  assert.deepEqual(
    c.suffix.map((s) => s.text),
    ["-A", "map=([a]=1 [b]=2)"],
  );
});

test("array append with mixed elements", () => {
  const ast = parse('a+=(foo "bar" $(baz))');
  assert.ok(ast.commands.length > 0);
});

// --- Assignment edge cases (tokenizer) ───────────────────────────────

test("assignment in suffix is a regular word", () => {
  const c = parse("echo FOO=bar").commands[0].command as Command;
  assert.equal(c.name?.text, "echo");
  assert.equal(c.suffix[0].text, "FOO=bar");
});

test("empty assignment before command", () => {
  const c = parse("IFS= read -r line").commands[0].command as Command;
  assert.ok(c.prefix.some((p) => p.type === "Assignment" && p.text === "IFS="));
  assert.equal(c.name?.text, "read");
});

test("a=b=c is single assignment (value is b=c)", () => {
  const c = parse("a=b=c").commands[0].command as Command;
  assert.ok(c.prefix.some((p) => p.type === "Assignment" && p.text === "a=b=c"));
});

test("=a is a regular word (not assignment)", () => {
  const c = parse("echo =a").commands[0].command as Command;
  assert.equal(c.suffix[0].text, "=a");
});

test("multiple assignments before command", () => {
  const c = parse("A=1 B=2 cmd").commands[0].command as Command;
  assert.equal(c.prefix.filter((p) => p.type === "Assignment").length, 2);
  assert.equal(c.name?.text, "cmd");
});

test("quoted assignment name or equals is a command word", () => {
  for (const [source, raw, value] of [
    [String.raw`X\=1 true`, String.raw`X\=1`, "X=1"],
    ['X"="1 true', 'X"="1', "X=1"],
    ['"X"=1 true', '"X"=1', "X=1"],
    ['"array"[key]=value true', '"array"[key]=value', "array[key]=value"],
    [String.raw`array\[key]=value true`, String.raw`array\[key]=value`, "array[key]=value"],
  ]) {
    const c = parse(source).commands[0].command as Command;
    assert.equal(c.prefix.length, 0, source);
    assert.equal(c.name?.text, raw, source);
    assert.equal(c.name?.value, value, source);
    assert.deepEqual(
      c.suffix.map((word) => word.text),
      ["true"],
      source,
    );
  }
});

test("quotes and escapes after an unquoted assignment operator remain assignment syntax", () => {
  for (const source of [String.raw`X=a\ b true`, 'X="a b" true', 'array["key"]=value true', 'X\\\n="v" true']) {
    const c = parse(source).commands[0].command as Command;
    assert.equal(c.prefix.length, 1, source);
    assert.equal(c.prefix[0].type, "Assignment", source);
    assert.equal(c.name?.text, "true", source);
  }
});

test("nested and expanded array indexes remain assignment syntax", () => {
  for (const [source, index] of [
    ["array[nested[0]]=value true", "nested[0]"],
    ["array[i=0]=value true", "i=0"],
    ["array[$((nested[0]))]=value true", "$((nested[0]))"],
    ["array[`echo ]`]=value true", "`echo ]`"],
    ["array[$(echo ] >/dev/null; printf 0)]=value true", "$(echo ] >/dev/null; printf 0)"],
  ]) {
    const c = parse(source).commands[0].command as Command;
    assert.equal(c.prefix.length, 1, source);
    assert.equal(c.prefix[0].type, "Assignment", source);
    if (c.prefix[0].type === "Assignment") {
      assert.equal(c.prefix[0].name, "array", source);
      assert.equal(c.prefix[0].index, index, source);
      assert.equal(c.prefix[0].value?.text, "value", source);
    }
    assert.equal(c.name?.text, "true", source);
  }
});

test("indexed assignments keep command substitutions in the index structured", () => {
  const assignment = getAssign("array[1+$(danger)]=value true");
  assert.equal(Object.getPrototypeOf(assignment), Object.prototype);
  assert.equal(assignment.index, "1+$(danger)");
  const expansion = assignment.indexParts?.find((part) => part.type === "CommandExpansion");
  assert.equal(expansion?.type, "CommandExpansion");
  if (expansion?.type !== "CommandExpansion") return;
  const command = expansion.script?.commands[0].command;
  assert.equal(command?.type, "Command");
  if (command?.type === "Command") assert.equal(command.name?.value, "danger");
  const serialized = JSON.parse(JSON.stringify(assignment));
  assert.ok(serialized.indexParts.some((part: { type: string }) => part.type === "CommandExpansion"));
});

test("line continuations around append assignment operators are ignored", () => {
  for (const [source, index] of [
    ["X\\\n+=value true", undefined],
    ["X+\\\n=value true", undefined],
    ["array[nested[0]]+\\\n=value true", "nested[0]"],
  ]) {
    const c = parse(source).commands[0].command as Command;
    assert.equal(c.prefix[0].type, "Assignment", source);
    if (c.prefix[0].type === "Assignment") {
      assert.equal(c.prefix[0].name, index === undefined ? "X" : "array", source);
      assert.equal(c.prefix[0].index, index, source);
      assert.equal(c.prefix[0].append, true, source);
      assert.equal(c.prefix[0].value?.text, "value", source);
    }
    assert.equal(c.name?.text, "true", source);
  }
});
