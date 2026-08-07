import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "../src/parser.ts";
import { verify } from "./verify.ts";
import type {
  Command,
  CommandExpansionPart,
  DoubleQuotedPart,
  If,
  For,
  ParameterExpansionPart,
  ParsedScript,
  While,
} from "../src/types.ts";

const roundtrip = (src: string) => {
  const ast = parse(src);
  assert.equal(verify(src, ast), src);
  return ast;
};

const nestedSubshells = (depth: number, body: string) => "( ".repeat(depth) + body + " )".repeat(depth);
const nestedBraceGroups = (depth: number, body: string) => "{ ".repeat(depth) + body + "; }".repeat(depth);
const nestedIfClauses = (depth: number, body: string) => "if :; then ".repeat(depth) + body + "; fi".repeat(depth);
const nestedElifClauses = (depth: number, body: string) =>
  "if false; then :; " + "elif false; then :; ".repeat(depth - 1) + `else ${body}; fi`;
const nestedForClauses = (depth: number, body: string) => "for x; do ".repeat(depth) + body + "; done".repeat(depth);
const nestedCStyleForClauses = (depth: number, body: string) =>
  "for ((;;)); do ".repeat(depth) + body + "; done".repeat(depth);
const nestedWhileClauses = (depth: number, body: string) =>
  "while :; do ".repeat(depth) + body + "; done".repeat(depth);
const nestedUntilClauses = (depth: number, body: string) =>
  "until :; do ".repeat(depth) + body + "; done".repeat(depth);
const nestedSelectClauses = (depth: number, body: string) =>
  "select x; do ".repeat(depth) + body + "; done".repeat(depth);
const nestedCaseClauses = (depth: number, body: string) =>
  "case x in x) ".repeat(depth) + body + ";; esac".repeat(depth);
const nestedTestGroups = (depth: number, body: string) =>
  "[[ " + "( ".repeat(depth) + body + " )".repeat(depth) + " ]]";
const nestedParamIndexes = (depth: number) => "${a[".repeat(depth) + "0" + "]}".repeat(depth);
const nestedParamDefaults = (depth: number) => "${a:-".repeat(depth) + "x" + "}".repeat(depth);
const nestedArithIndexes = (depth: number) => "$((a[".repeat(depth) + "0" + "]))".repeat(depth);
const nestedAssignSubscripts = (depth: number) => "a[$(".repeat(depth) + ":" + ")]=".repeat(depth);

// --- Nested parameter expansions ---

test("4-level nested ${...:-${...}} default chain", () => {
  const src = 'echo "${a:-${b:-${c:-${d}}}}"';
  roundtrip(src);
});

test("nested ${...} in replacement pattern", () => {
  const src = 'echo "${path//${prefix}/}"';
  roundtrip(src);
});

test("param expansion with nested command substitution", () => {
  const src = 'echo "${var:-$(echo ${fallback:-default})}"';
  roundtrip(src);
});

test("normal expansion nesting keeps full nested structure without errors", () => {
  const ast = parse('echo "${a:-${b:-$(x)}}"');
  assert.equal(ast.errors, undefined);
  const dq = (ast.commands[0].command as Command).suffix[0].parts?.[0] as DoubleQuotedPart;
  const outer = dq.parts[0] as ParameterExpansionPart;
  assert.equal(outer.parameter, "a");
  const inner = outer.operand?.parts?.[0] as ParameterExpansionPart;
  assert.equal(inner.parameter, "b");
  const sub = inner.operand?.parts?.[0] as CommandExpansionPart;
  assert.equal(sub.type, "CommandExpansion");
  assert.ok(sub.script);
  const subCommand = sub.script.commands[0].command as Command;
  assert.equal(subCommand.type, "Command");
  assert.equal(subCommand.name?.value, "x");
  assert.equal(ast.errors, undefined);
});

test("parameter expansion nesting at the parser limit remains lossless", () => {
  const src = nestedParamDefaults(256);
  const ast = roundtrip(src);
  assert.equal(ast.errors, undefined);
  JSON.stringify(ast);
  assert.equal(ast.errors, undefined);
  let part = (ast.commands[0].command as Command).name?.parts?.[0] as ParameterExpansionPart;
  let levels = 1;
  while (part.operand?.parts) {
    part = part.operand.parts[0] as ParameterExpansionPart;
    levels++;
  }
  assert.equal(levels, 256);
  assert.equal(part.operand?.text, "x");
});

test("excessive parameter expansion nesting degrades without stack overflow", () => {
  for (const src of [nestedParamIndexes(2_000), nestedParamDefaults(2_000)]) {
    const ast = parse(src);
    JSON.stringify(ast);
    assert.ok(
      ast.errors?.some((e) => e.message === "maximum parameter expansion nesting depth exceeded"),
      src.slice(0, 8),
    );
  }
});

test("excessive arithmetic expansion nesting degrades without stack overflow", () => {
  const ast = parse(nestedArithIndexes(2_000));
  JSON.stringify(ast);
  assert.ok(ast.errors?.some((e) => e.message === "maximum arithmetic expansion nesting depth exceeded"));
});

test("excessive assignment subscript substitution nesting degrades without stack overflow", () => {
  const ast = parse(nestedAssignSubscripts(2_000));
  JSON.stringify(ast);
  assert.ok(ast.errors?.some((e) => e.message === "maximum command substitution nesting depth exceeded"));
});

test("nested substitution scripts stop at a flagged boundary script", () => {
  const ast = parse(nestedAssignSubscripts(2_000));
  JSON.stringify(ast);
  let script: ParsedScript = ast;
  let depth = 0;
  let boundary: ParsedScript | undefined;
  for (;;) {
    const command = script.commands[0]?.command;
    const assignment = command?.type === "Command" ? command.prefix[0] : undefined;
    const sub = assignment?.indexParts?.find((p) => p.type === "CommandExpansion");
    if (!sub) break;
    depth++;
    if (sub.script === undefined) {
      boundary = script;
      break;
    }
    script = sub.script;
  }
  assert.ok(boundary, `expected an unresolved substitution boundary (walked ${depth} scripts)`);
  assert.ok(depth > 250 && depth < 300, `boundary at depth ${depth}`);
  assert.ok(boundary.errors?.some((e) => e.message === "maximum substitution nesting depth exceeded"));
});

// --- Nested command substitutions ---

test("3-level nested $(...) command substitution", () => {
  const src = "echo $(cat $(dirname $(readlink -f $0))/file)";
  roundtrip(src);
});

test("nested $() inside double quotes inside $()", () => {
  const src = 'result=$(echo "prefix_$(basename "$file")_suffix")';
  roundtrip(src);
});

test("nested backtick inside $()", () => {
  const src = "echo $(echo `hostname`)";
  roundtrip(src);
});

// --- Nested compound commands ---

test("nested if inside if", () => {
  const src = "if true; then if false; then echo a; else echo b; fi; fi";
  const ast = roundtrip(src);
  const outer = ast.commands[0].command as If;
  const inner = outer.then.commands[0].command as If;
  assert.equal(inner.type, "If");
  assert.ok(inner.else);
});

test("3-level nested if", () => {
  const src = "if a; then if b; then if c; then echo deep; fi; fi; fi";
  roundtrip(src);
});

test("nested for inside while", () => {
  const src = "while true; do for x in a b; do echo $x; done; done";
  const ast = roundtrip(src);
  const wh = ast.commands[0].command as While;
  const fr = (wh.body.commands[0] as Statement).command as For;
  assert.equal(fr.type, "For");
});

test("nested subshell inside subshell inside pipeline", () => {
  const src = "( ( echo inner ) | cat ) | grep x";
  roundtrip(src);
});

test("subshell nesting at the parser limit remains lossless", () => {
  const src = nestedSubshells(256, "echo inner");
  const ast = roundtrip(src);
  assert.equal(ast.errors, undefined);
});

test("excessive subshell nesting reports an error and preserves following commands", () => {
  const src = `${nestedSubshells(2_000, "case x in a) echo ')';; esac")}; echo after`;
  const ast = parse(src);

  assert.equal(ast.errors?.length, 1);
  assert.match(ast.errors[0].message, /maximum subshell nesting depth exceeded/);
  assert.equal(ast.commands.length, 2);
  assert.equal(ast.commands[1].command.type, "Command");
  assert.equal(ast.commands[1].command.name?.value, "echo");
  assert.equal(ast.commands[1].command.suffix[0].value, "after");
});

test("brace, if, and test nesting at the parser limit remains lossless", () => {
  for (const src of [
    nestedBraceGroups(256, "echo inner"),
    nestedIfClauses(256, "echo inner"),
    nestedElifClauses(256, "echo inner"),
    nestedTestGroups(256, "inner"),
  ]) {
    const ast = roundtrip(src);
    assert.equal(ast.errors, undefined);
  }
});

test("mixed compound nesting at the shared parser limit remains lossless", () => {
  const src = nestedBraceGroups(86, nestedIfClauses(85, nestedTestGroups(85, "inner")));
  const ast = roundtrip(src);

  assert.equal(ast.errors, undefined);
});

test("mixed compound nesting shares one parser depth budget", () => {
  const nested = nestedBraceGroups(100, nestedIfClauses(100, nestedTestGroups(100, "inner")));
  const ast = parse(`${nested}; echo after`);

  assert.deepEqual(
    ast.errors?.map((error) => error.message),
    ["maximum test group nesting depth exceeded"],
  );
  assert.equal(ast.commands.length, 2);
  assert.equal(ast.commands[1].command.type, "Command");
  assert.equal(ast.commands[1].command.suffix[0].value, "after");
});

test("loop, select, and case nesting at the parser limit remains lossless", () => {
  for (const src of [
    nestedForClauses(256, "echo inner"),
    nestedCStyleForClauses(256, "echo inner"),
    nestedWhileClauses(256, "echo inner"),
    nestedUntilClauses(256, "echo inner"),
    nestedSelectClauses(256, "echo inner"),
    nestedCaseClauses(256, "echo inner"),
  ]) {
    const ast = roundtrip(src);
    assert.equal(ast.errors, undefined);
  }
});

test("excessive loop, select, and case nesting preserves following commands", () => {
  for (const [src, message] of [
    [nestedForClauses(2_000, "echo done"), "maximum for nesting depth exceeded"],
    [nestedCStyleForClauses(2_000, "echo done"), "maximum for nesting depth exceeded"],
    [nestedWhileClauses(2_000, "echo done"), "maximum while nesting depth exceeded"],
    [nestedUntilClauses(2_000, "echo done"), "maximum until nesting depth exceeded"],
    [nestedSelectClauses(2_000, "echo done"), "maximum select nesting depth exceeded"],
    [nestedCaseClauses(2_000, "echo esac"), "maximum case nesting depth exceeded"],
  ]) {
    const ast = parse(`${src}; echo after`);
    assert.deepEqual(
      ast.errors?.map((error) => error.message),
      [message],
      message,
    );
    assert.equal(ast.commands.length, 2, message);
    assert.equal(ast.commands[1].command.type, "Command", message);
    assert.equal(ast.commands[1].command.suffix[0].value, "after", message);
  }
});

test("excessive brace nesting recovers past inert braces and preserves following commands", () => {
  const src = `${nestedBraceGroups(2_000, "echo '}'")}; echo after`;
  const ast = parse(src);

  assert.deepEqual(
    ast.errors?.map((error) => error.message),
    ["maximum brace group nesting depth exceeded"],
  );
  assert.equal(ast.commands.length, 2);
  assert.equal(ast.commands[1].command.type, "Command");
  assert.equal(ast.commands[1].command.suffix[0].value, "after");
});

test("compound recovery handles C-style for loops with brace bodies", () => {
  const body = 'for ((i = 0; i < 1; i++)); { echo "}"; }';
  const ast = parse(`${nestedBraceGroups(2_000, body)}; echo after`);

  assert.deepEqual(
    ast.errors?.map((error) => error.message),
    ["maximum brace group nesting depth exceeded"],
  );
  assert.equal(ast.commands.length, 2);
  assert.equal(ast.commands[1].command.type, "Command");
  assert.equal(ast.commands[1].command.suffix[0].value, "after");
});

test("compound recovery tracks command prefixes before compound bodies", () => {
  for (const body of [
    "function worker { echo function; }",
    "function worker () { echo function; }",
    "function worker ( echo function )",
    "coproc worker { echo coproc; }",
    "coproc worker ( echo coproc )",
    "time -p { echo timed; }",
    "time -p ( echo timed )",
    "time -p -- { echo timed; }",
    "time coproc worker { echo coproc; }",
    "ti\\" + "\nme -p { echo timed; }",
    "coproc worker ti\\" + "\nme -p { echo timed; }",
  ]) {
    const ast = parse(`${nestedBraceGroups(2_000, body)}; echo after`);

    assert.deepEqual(
      ast.errors?.map((error) => error.message),
      ["maximum brace group nesting depth exceeded"],
      body,
    );
    assert.equal(ast.commands.length, 2, body);
    assert.equal(ast.commands[1].command.type, "Command", body);
    assert.equal(ast.commands[1].command.suffix[0].value, "after", body);
  }
});

test("compound recovery treats reserved case patterns as data", () => {
  const body = 'case x in\nif) echo fi;;\n{) echo "}";;\nesac';
  const ast = parse(`${nestedBraceGroups(2_000, body)}; echo after`);

  assert.deepEqual(
    ast.errors?.map((error) => error.message),
    ["maximum brace group nesting depth exceeded"],
  );
  assert.equal(ast.commands.length, 2);
  assert.equal(ast.commands[1].command.type, "Command");
  assert.equal(ast.commands[1].command.suffix[0].value, "after");
});

test("compound recovery tracks ordinary separators inside case item bodies", () => {
  for (const body of [
    "case x in x) echo one; echo two;; esac",
    "case x in x) echo one\necho two;; esac",
    "case x in x) echo one | cat;; esac",
    "case x in x) true && echo two;; esac",
    "case x in x) false || echo two;; esac",
    "case x in x) echo one & wait;; esac",
  ]) {
    const ast = parse(`${nestedBraceGroups(2_000, body)}; echo after`);

    assert.deepEqual(
      ast.errors?.map((error) => error.message),
      ["maximum brace group nesting depth exceeded"],
      body,
    );
    assert.equal(ast.commands.length, 2, body);
    assert.equal(ast.commands[1].command.type, "Command", body);
    assert.equal(ast.commands[1].command.suffix[0].value, "after", body);
  }
});

test("compound recovery tracks separators after bare assignments", () => {
  for (const body of ["a=1", "a=(1 2 3)", "x=$(case y in b) echo hi;; esac)", "arr[i+1]=5"]) {
    const ast = parse(`${nestedBraceGroups(2_000, body)}; echo after`);

    assert.deepEqual(
      ast.errors?.map((error) => error.message),
      ["maximum brace group nesting depth exceeded"],
      body,
    );
    assert.equal(ast.commands.length, 2, body);
    assert.equal(ast.commands[1].command.type, "Command", body);
    assert.equal(ast.commands[1].command.suffix[0].value, "after", body);
  }
});

test("compound recovery tracks newline separators after bare assignments", () => {
  const src = `${"{ ".repeat(2_000)}a=1${"\n}".repeat(2_000)}; echo after`;
  const ast = parse(src);

  assert.deepEqual(
    ast.errors?.map((error) => error.message),
    ["maximum brace group nesting depth exceeded"],
  );
  assert.equal(ast.commands.length, 2);
  assert.equal(ast.commands[1].command.type, "Command");
  assert.equal(ast.commands[1].command.suffix[0].value, "after");
});

test("excessive if nesting recovers past inert fi words and preserves following commands", () => {
  const src = `${nestedIfClauses(2_000, "echo fi")}; echo after`;
  const ast = parse(src);

  assert.deepEqual(
    ast.errors?.map((error) => error.message),
    ["maximum if nesting depth exceeded"],
  );
  assert.equal(ast.commands.length, 2);
  assert.equal(ast.commands[1].command.type, "Command");
  assert.equal(ast.commands[1].command.suffix[0].value, "after");
});

test("deep elif chains remain lossless and preserve following commands", () => {
  const ast = parse(`${nestedElifClauses(2_000, "echo fi")}; echo after`);

  assert.equal(ast.errors, undefined);
  let branch = ast.commands[0].command as If;
  let branchCount = 1;
  while (branch.else?.type === "If") {
    branch = branch.else;
    branchCount++;
  }
  assert.equal(branchCount, 2_000);
  assert.equal(ast.commands.length, 2);
  assert.equal(ast.commands[1].command.type, "Command");
  assert.equal(ast.commands[1].command.suffix[0].value, "after");
});

test("flat elif chains consume one shared syntax depth level", () => {
  const ast = parse(nestedBraceGroups(255, nestedElifClauses(2_000, "echo inner")));

  assert.equal(ast.errors, undefined);
});

test("excessive test grouping recovers past inert parens and preserves following commands", () => {
  const src = `${nestedTestGroups(4_000, '")"')}; echo after`;
  const ast = parse(src);

  assert.deepEqual(
    ast.errors?.map((error) => error.message),
    ["maximum test group nesting depth exceeded"],
  );
  assert.equal(ast.commands.length, 2);
  assert.equal(ast.commands[1].command.type, "Command");
  assert.equal(ast.commands[1].command.suffix[0].value, "after");
});

test("deep test negation remains lossless and preserves following commands", () => {
  const src = `[[ ${"! ".repeat(4_000)}inner ]]; echo after`;
  const ast = parse(src);

  assert.equal(ast.errors, undefined);
  assert.equal(ast.commands[0].command.type, "TestCommand");
  let expression = ast.commands[0].command.expression;
  let depth = 0;
  while (expression.type === "TestNot") {
    depth++;
    expression = expression.operand;
  }
  assert.equal(depth, 4_000);
  assert.equal(ast.commands.length, 2);
  assert.equal(ast.commands[1].command.type, "Command");
  assert.equal(ast.commands[1].command.suffix[0].value, "after");
});

test("case inside if inside function", () => {
  const src = "f() { if true; then case $x in a) echo a;; b) echo b;; esac; fi; }";
  roundtrip(src);
});

// --- Nested arithmetic ---

test("deeply nested arithmetic groups", () => {
  const src = "echo $(( ((a + b) * (c - d)) / ((e + f) * (g - h)) ))";
  roundtrip(src);
});

test("nested ternary in arithmetic", () => {
  const src = "(( x = a > 0 ? (b > 0 ? 1 : 2) : (c > 0 ? 3 : 4) ))";
  roundtrip(src);
});

// --- Nested test expressions ---

test("deeply nested [[ ]] with grouping and logic", () => {
  const src = '[[ ( -f a && ( -d b || -L c ) ) && ! ( -z "$x" ) ]]';
  roundtrip(src);
});

// --- Mixed deep nesting ---

test("$() inside ${} inside double quotes inside $()", () => {
  const src = 'x=$(echo "${path:-$(dirname "$0")}/config")';
  roundtrip(src);
});

test("heredoc with deeply nested expansions", () => {
  const src = "cat <<EOF\n${a:-${b:-$(echo ${c})}}\nEOF\n";
  roundtrip(src);
});

test("pipeline of compound commands", () => {
  const src = "for x in a b; do echo $x; done | while read line; do echo $line; done | sort";
  roundtrip(src);
});

test("function containing nested redirected pipelines", () => {
  const src = 'f() { { echo a; echo b; } | sort | { while read x; do echo "$x"; done; }; }';
  roundtrip(src);
});
