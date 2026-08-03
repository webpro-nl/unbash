import { test } from "node:test";
import assert from "node:assert";
import { parse } from "../src/parser.ts";

// Walk the whole AST and assert every word's span indexes the original source.
// Accessing the lazy `parts` getter resolves nested substitutions in place, so this
// exercises the absolute-offset invariant at every nesting depth.
function check(source: string, value: unknown, path: string): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => check(source, item, `${path}[${i}]`));
    return;
  }
  const node = value as Record<string, any>;
  const isWord = typeof node.text === "string" && typeof node.pos === "number" && typeof node.end === "number";
  if (isWord) {
    // Every word — including parameter-expansion sub-fields — has text equal to its source
    // span. value carries the interpreted form (quotes resolved).
    assert.strictEqual(
      source.slice(node.pos, node.end),
      node.text,
      `word span mismatch at ${path} (pos=${node.pos}, end=${node.end})`,
    );
    const parts = node.parts; // getter → lazy resolve of nested substitutions
    if (parts) check(source, parts, `${path}.parts`);
    return;
  }
  for (const key of Object.keys(node)) check(source, node[key], `${path}.${key}`);
}

// NB: single-quoted — these contain ${...} which a backtick template literal would
// interpret as JS interpolation.
const CORPUS = [
  'echo hello',
  'echo "hi $(rm -rf /tmp/z)"',
  'a $(b $(c "deep"))',
  'diff <(sort x) <(sort y)',
  'diff <(sort <(gen a)) <(sort y)',
  'echo "$(date) and $(whoami)"',
  'for f in $(ls /etc); do cat "$f"; done',
  'x=$(foo bar); echo "$x"',
  'cat "prefix $(inner /a/b) suffix"',
  'result=$(echo "$(nested cmd)")',
  'grep -r "$(cat patterns.txt)" .',
  'echo $(a) $(b) $(c)',
  'if test -f "$(which node)"; then echo ok; fi',
  'echo ${ ls -la; }',
  'cat <(echo $(date))tail',
  // arithmetic, including a command sub inside arithmetic, nested in a command sub
  'echo $((1 + 2))',
  'x=$(echo $((1 + 2)))',
  'echo $(( $(id -u) + 1 ))',
  // command subs inside parameter-expansion sub-fields (operand, replacement, slice)
  'echo ${x:-$(date)}',
  'echo ${x/foo/$(repl)}',
  'echo ${x:$(off):$(len)}',
  'echo ${a:-${b:-$(deep)}}',
  'echo {safe,$(brace)}',
  'echo @($(extglob)|<(process))',
  'echo ${array[$(parameter)]}',
  'array[$(assignment)]=value true',
  'echo $((array[$(arithmetic)]))',
];

for (const command of CORPUS) {
  test(`every word span maps to source: ${command}`, () => {
    check(command, parse(command), "script");
  });
}

// Direct check: a nested command's source slices straight out of the original.
test("nested command source slices from the original string", () => {
  const command = `echo $(rm -rf /tmp/z)`;
  const script = parse(command);
  const word = (script.commands[0].command as any).suffix[0];
  const sub = word.parts.find((p: any) => p.type === "CommandExpansion");
  const rm = sub.script.commands[0].command;
  assert.strictEqual(command.slice(rm.pos, rm.end), "rm -rf /tmp/z");
  assert.strictEqual(command.slice(rm.name.pos, rm.name.end), "rm");
  // Ordinary scripts index the caller's string directly and carry no `source` of their own.
  assert.strictEqual(Object.hasOwn(sub.script, "source"), false);
  assert.strictEqual(sub.script.source, undefined);
});

function suffixPart(command: string, type: string): any {
  const word = (parse(command).commands[0].command as any).suffix[0];
  const parts: any[] = word.parts;
  return parts.find((p) => p.type === type);
}

// Arithmetic expression offsets are absolute in the original source (at top level and when
// nested in a command substitution — the latter regressed when offsets were re-based via a
// generic tree-walk that shifted the body-relative arithmetic nodes).
test("arithmetic expression offsets are absolute", () => {
  for (const command of [`echo $((1 + 2))`, `x=$(echo $((1 + 2)))`]) {
    const at = command.indexOf("1 + 2");
    const arith = command.startsWith("echo")
      ? suffixPart(command, "ArithmeticExpansion")
      : (parse(command).commands[0].command as any).prefix[0].value.parts.find(
          (p: any) => p.type === "CommandExpansion",
        ).script.commands[0].command.suffix[0].parts.find((p: any) => p.type === "ArithmeticExpansion");
    const bin = arith.expression; // ArithmeticBinary(left "1", "+", right "2")
    assert.strictEqual(bin.left.pos, at, command);
    assert.strictEqual(command.slice(bin.right.pos, bin.right.end), "2", command);
  }
});

// A command substitution inside arithmetic ($(...) within $((...))) resolves to an absolute
// script.
test("arithmetic-command substitution offsets are absolute", () => {
  const command = `echo $(( $(id -u) + 1 ))`;
  const arith = suffixPart(command, "ArithmeticExpansion");
  // find the ArithmeticCommandExpansion node in the expression tree
  let ace: any;
  (function walk(n: any) {
    if (!n || typeof n !== "object") return;
    if (n.type === "ArithmeticCommandExpansion") ace = n;
    for (const k of Object.keys(n)) walk(n[k]);
  })(arith.expression);
  const cmd = ace.script.commands[0].command;
  assert.strictEqual(command.slice(cmd.pos, cmd.end), "id -u");
  assert.strictEqual(command.slice(cmd.name.pos, cmd.name.end), "id");
});

test("arithmetic expansion does not consume a command substitution's closing parenthesis", () => {
  const command = `echo $((1 + $(danger)))`;
  const word = (parse(command).commands[0].command as any).suffix[0];
  assert.strictEqual(word.text, "$((1 + $(danger)))");

  const arith = word.parts.find((part: any) => part.type === "ArithmeticExpansion");
  const substitution = arith.expression.right;
  assert.strictEqual(substitution.text, "$(danger)");
  const nested = substitution.script.commands[0].command;
  assert.strictEqual(command.slice(nested.pos, nested.end), "danger");
});

test("arithmetic command and for substitutions have absolute script offsets", () => {
  const cases = [
    [`((x=$(danger)))`, ["danger"]],
    [`for (( i = $(init); i < $(limit); i++ )); do echo "$i"; done`, ["init", "limit"]],
  ] as const;

  for (const [command, expected] of cases) {
    const script = parse(command);
    const root = script.commands[0].command as any;
    const expressions =
      root.type === "ArithmeticCommand" ? [root.expression] : [root.initialize, root.test, root.update];
    const actual: string[] = [];

    for (const expression of expressions) {
      (function walk(node: any) {
        if (!node || typeof node !== "object") return;
        if (node.type === "ArithmeticCommandExpansion") {
          const nested = node.script.commands[0].command;
          actual.push(command.slice(nested.pos, nested.end));
        }
        for (const value of Object.values(node)) walk(value);
      })(expression);
    }

    assert.deepStrictEqual(actual, expected);
  }
});

// A command substitution inside a parameter-expansion sub-field resolves to an absolute
// script — including across a nested ${...}.
test("command substitution inside parameter-expansion operand is absolute", () => {
  for (const [command, expected] of [
    ['echo ${x:-$(date)}', "date"],
    ['echo ${x/foo/$(repl args)}', "repl args"],
    ['echo ${a:-${b:-$(deep cmd)}}', "deep cmd"],
  ] as const) {
    let cmd: any;
    (function walk(n: any) {
      if (!n || typeof n !== "object") return;
      if (n.type === "Command" && n.name && command.slice(n.name.pos, n.name.end) !== "echo") cmd = n;
      if (typeof n.text === "string" && "parts" in n) {
        const p = n.parts;
        if (p) walk(p);
      }
      for (const k of Object.keys(n)) if (k !== "parts") walk(n[k]);
    })(parse(command));
    assert.ok(cmd, command);
    assert.strictEqual(command.slice(cmd.pos, cmd.end), expected, command);
  }
});

test("escaped backtick scripts retain their decoded source context", () => {
  const command = "echo `outer \\`inner cmd\\` tail`";
  const sub = suffixPart(command, "CommandExpansion");
  assert.ok(sub.script);
  assert.equal(sub.script.source.slice(sub.script.pos, sub.script.end), "outer `inner cmd` tail");
  assert.equal(Object.getPrototypeOf(sub.script), Object.prototype);
  assert.equal(Object.hasOwn(sub.script, "source"), true);
  assert.equal(Object.keys(sub.script).includes("source"), false);
  assert.equal("source" in structuredClone(sub.script), false);
  const outer = sub.script.commands[0].command;
  assert.equal(outer.type, "Command");
  if (outer.type !== "Command") return;
  const nested = outer.suffix[0].parts?.[0];
  assert.equal(nested?.type, "CommandExpansion");
  if (nested?.type !== "CommandExpansion" || !nested.script) return;
  const inner = nested.script.commands[0].command;
  assert.equal(inner.type, "Command");
  // The nested script is parsed in place from the decoded string, so it has no
  // `source` of its own — its positions index the owning script's `source`.
  assert.equal(Object.hasOwn(nested.script, "source"), false);
  assert.equal(sub.script.source.slice(inner.pos, inner.end), "inner cmd");
});

test("escaped backtick scripts decode removed escapes", () => {
  const command = "echo `printf \\$HOME`";
  const sub = suffixPart(command, "CommandExpansion");
  assert.ok(sub.script);
  const nested = sub.script.commands[0].command;
  assert.equal(nested.type, "Command");
  if (nested.type !== "Command") return;
  const argument = nested.suffix[0];
  assert.equal(sub.script.source, "printf $HOME");
  assert.equal(sub.script.source.slice(argument.pos, argument.end), "$HOME");
});

test("expansion depth bookkeeping stays out of the public AST", () => {
  const expansion = suffixPart("echo $(nested)", "CommandExpansion");
  assert.equal(Object.hasOwn(expansion, "innerDepth"), false);
});
