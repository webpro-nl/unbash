import { nodeOfType } from "./ast-helpers.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { parseArithmeticExpression, type ArithmeticParseCollector } from "../src/arithmetic.ts";
import { Lexer } from "../src/lexer.ts";
import { parse } from "../src/parser.ts";
import { computeWordParts } from "../src/parts.ts";
import type { ArithmeticExpression } from "../src/types.ts";

const getCmd = (ast: ReturnType<typeof parse>, i = 0) => nodeOfType(ast.commands[i].command, "Command");

// Expressions embedding `$(`, `${`, or `$((` require the lexer's delimiter scanners,
// wired exactly as the production callers wire them.
const collectorFor = (src: string): ArithmeticParseCollector => {
  const lexer = new Lexer(src);
  return {
    commandExpansions: [],
    embeddedWords: [],
    findClosingBracket: (start, end) => lexer.findClosingBracket(start, end),
    findClosingBrace: (start, end) => lexer.findClosingBrace(start, end),
    findClosingParenthesis: (start, end) => lexer.findClosingParenthesis(start, end),
    findArithmeticExpansionEnd: (start, end) => lexer.findArithmeticExpansionEnd(start, end),
    findArithmeticWordEnd: (start, end) => lexer.findArithmeticWordEnd(start, end),
  };
};

const parseEmbedded = (src: string) => parseArithmeticExpression(src, 0, collectorFor(src));
const bin = (e: ArithmeticExpression) => nodeOfType(e, "ArithmeticBinary");
const unary = (e: ArithmeticExpression) => nodeOfType(e, "ArithmeticUnary");
const ternary = (e: ArithmeticExpression) => nodeOfType(e, "ArithmeticTernary");
const group = (e: ArithmeticExpression) => nodeOfType(e, "ArithmeticGroup");
const word = (e: ArithmeticExpression) => nodeOfType(e, "ArithmeticWord");

// --- Direct parser tests ---

test("empty string returns null", () => {
  assert.equal(parseArithmeticExpression(""), null);
  assert.equal(parseArithmeticExpression("   "), null);
});

test("single number", () => {
  const e = parseArithmeticExpression("42")!;
  assert.equal(e.type, "ArithmeticWord");
  assert.equal(word(e).value, "42");
});

test("single variable", () => {
  const e = parseArithmeticExpression("x")!;
  assert.equal(word(e).value, "x");
});

test("addition", () => {
  const e = parseArithmeticExpression("x + y")!;
  assert.equal(bin(e).operator, "+");
  assert.equal(word(bin(e).left).value, "x");
  assert.equal(word(bin(e).right).value, "y");
});

test("subtraction", () => {
  const e = parseArithmeticExpression("x - y")!;
  assert.equal(bin(e).operator, "-");
});

test("multiplication", () => {
  const e = parseArithmeticExpression("x * y")!;
  assert.equal(bin(e).operator, "*");
});

test("division", () => {
  const e = parseArithmeticExpression("y / x")!;
  assert.equal(bin(e).operator, "/");
});

test("modulo", () => {
  const e = parseArithmeticExpression("y % x")!;
  assert.equal(bin(e).operator, "%");
});

test("exponentiation", () => {
  const e = parseArithmeticExpression("2 ** 10")!;
  assert.equal(bin(e).operator, "**");
});

test("precedence: * binds tighter than +", () => {
  const e = parseArithmeticExpression("a + b * c")!;
  assert.equal(bin(e).operator, "+");
  assert.equal(word(bin(e).left).value, "a");
  assert.equal(bin(bin(e).right).operator, "*");
});

test("precedence: () overrides", () => {
  const e = parseArithmeticExpression("(a + b) * c")!;
  assert.equal(bin(e).operator, "*");
  assert.equal(group(bin(e).left).expression.type, "ArithmeticBinary");
  assert.equal(bin(group(bin(e).left).expression).operator, "+");
});

test("** is right-associative", () => {
  const e = parseArithmeticExpression("2 ** 3 ** 4")!;
  assert.equal(bin(e).operator, "**");
  assert.equal(word(bin(e).left).value, "2");
  assert.equal(bin(bin(e).right).operator, "**");
});

test("comparison operators", () => {
  for (const op of ["<", "<=", ">", ">=", "==", "!="]) {
    const e = parseArithmeticExpression(`x ${op} y`)!;
    assert.equal(bin(e).operator, op);
  }
});

test("logical operators", () => {
  const e = parseArithmeticExpression("a && b || c")!;
  assert.equal(bin(e).operator, "||");
  assert.equal(bin(bin(e).left).operator, "&&");
});

test("bitwise operators", () => {
  const e = parseArithmeticExpression("a & b | c ^ d")!;
  // | binds loosest of the three
  assert.equal(bin(e).operator, "|");
});

test("shift operators", () => {
  const e = parseArithmeticExpression("x << 2")!;
  assert.equal(bin(e).operator, "<<");
  const e2 = parseArithmeticExpression("y >> 1")!;
  assert.equal(bin(e2).operator, ">>");
});

// --- Unary operators ---

test("unary minus", () => {
  const e = parseArithmeticExpression("-x")!;
  assert.equal(unary(e).operator, "-");
  assert.equal(unary(e).prefix, true);
  assert.equal(word(unary(e).operand).value, "x");
});

test("unary plus", () => {
  const e = parseArithmeticExpression("+x")!;
  assert.equal(unary(e).operator, "+");
  assert.equal(unary(e).prefix, true);
});

test("logical not", () => {
  const e = parseArithmeticExpression("!x")!;
  assert.equal(unary(e).operator, "!");
  assert.equal(unary(e).prefix, true);
});

test("bitwise not", () => {
  const e = parseArithmeticExpression("~x")!;
  assert.equal(unary(e).operator, "~");
  assert.equal(unary(e).prefix, true);
});

test("prefix increment", () => {
  const e = parseArithmeticExpression("++x")!;
  assert.equal(unary(e).operator, "++");
  assert.equal(unary(e).prefix, true);
});

test("prefix decrement", () => {
  const e = parseArithmeticExpression("--x")!;
  assert.equal(unary(e).operator, "--");
  assert.equal(unary(e).prefix, true);
});

test("postfix increment", () => {
  const e = parseArithmeticExpression("x++")!;
  assert.equal(unary(e).operator, "++");
  assert.equal(unary(e).prefix, false);
  assert.equal(word(unary(e).operand).value, "x");
});

test("postfix decrement", () => {
  const e = parseArithmeticExpression("x--")!;
  assert.equal(unary(e).operator, "--");
  assert.equal(unary(e).prefix, false);
});

// --- Ternary ---

test("ternary operator", () => {
  const e = parseArithmeticExpression("x > y ? x : y")!;
  assert.equal(ternary(e).test.type, "ArithmeticBinary");
  assert.equal(word(ternary(e).consequent).value, "x");
  assert.equal(word(ternary(e).alternate).value, "y");
});

test("nested ternary", () => {
  const e = parseArithmeticExpression("a ? b : c ? d : e")!;
  assert.equal(e.type, "ArithmeticTernary");
  assert.equal(ternary(e).alternate.type, "ArithmeticTernary");
});

// --- Assignment ---

test("simple assignment", () => {
  const e = parseArithmeticExpression("x = 5")!;
  assert.equal(bin(e).operator, "=");
  assert.equal(word(bin(e).left).value, "x");
  assert.equal(word(bin(e).right).value, "5");
});

test("compound assignment operators", () => {
  for (const op of ["+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<=", ">>="]) {
    const e = parseArithmeticExpression(`x ${op} 5`)!;
    assert.equal(bin(e).operator, op);
  }
});

test("assignment is right-associative", () => {
  const e = parseArithmeticExpression("a = b = c")!;
  assert.equal(bin(e).operator, "=");
  assert.equal(bin(bin(e).right).operator, "=");
});

// --- Comma ---

test("comma operator", () => {
  const e = parseArithmeticExpression("a = 1, b = 2")!;
  assert.equal(bin(e).operator, ",");
  assert.equal(bin(bin(e).left).operator, "=");
  assert.equal(bin(bin(e).right).operator, "=");
});

// --- Special values ---

test("hex literal", () => {
  const e = parseArithmeticExpression("0xFF")!;
  assert.equal(word(e).value, "0xFF");
});

test("octal literal", () => {
  const e = parseArithmeticExpression("0777")!;
  assert.equal(word(e).value, "0777");
});

test("base-N literal", () => {
  const e = parseArithmeticExpression("2#10101010")!;
  assert.equal(word(e).value, "2#10101010");
});

test("dollar variable", () => {
  const e = parseArithmeticExpression("$x + 1")!;
  assert.equal(bin(e).operator, "+");
  assert.equal(word(bin(e).left).value, "$x");
});

test("dollar brace expansion", () => {
  const e = parseEmbedded("${#arr[@]} + 1")!;
  assert.equal(bin(e).operator, "+");
  assert.equal(word(bin(e).left).value, "${#arr[@]}");
});

test("embedded dollar atoms retain their spans without a collector", () => {
  const command = parseArithmeticExpression("$(cmd) + 1")!;
  assert.equal(command.type, "ArithmeticBinary");
  assert.equal(command.left.type, "ArithmeticCommandExpansion");
  assert.equal(command.left.text, "$(cmd)");

  for (const [source, value] of [
    ["${x:-1} + 2", "${x:-1}"],
    ["$((1+2)) + 3", "$((1+2))"],
  ] as const) {
    const expression = parseArithmeticExpression(source)!;
    assert.equal(expression.type, "ArithmeticBinary");
    assert.equal(expression.left.type, "ArithmeticWord");
    assert.equal(expression.left.value, value);
  }
});

test("array subscript", () => {
  const e = parseArithmeticExpression("arr[i] + 1")!;
  assert.equal(bin(e).operator, "+");
  assert.equal(word(bin(e).left).value, "arr[i]");
});

test("array subscripts keep adjacent command substitutions structured", () => {
  const src = "echo $((arr[1+$(one)$(two)]))";
  const c = getCmd(parse(src));
  const expansion = computeWordParts(src, nodeOfType(c.suffix[0], "Word"))![0];
  assert.equal(expansion.type, "ArithmeticExpansion");
  if (expansion.type !== "ArithmeticExpansion") return;
  assert.equal(expansion.expression?.type, "ArithmeticWord");
  if (expansion.expression?.type !== "ArithmeticWord") return;
  const substitutions = expansion.expression.parts?.filter((part) => part.type === "CommandExpansion") ?? [];
  assert.deepEqual(
    substitutions.map((part) => {
      if (part.type !== "CommandExpansion") return undefined;
      const command = part.script?.commands[0].command;
      return command?.type === "Command" ? command.name?.value : undefined;
    }),
    ["one", "two"],
  );
});

test("adjacent arithmetic command substitutions remain structured", () => {
  for (const body of ["$(one)$(two)", "$(one)x$(two)", "x$(one)", "array[0]$(one)"]) {
    const src = `echo $(( ${body} ))`;
    const c = getCmd(parse(src));
    const expansion = computeWordParts(src, nodeOfType(c.suffix[0], "Word"))![0];
    assert.equal(expansion.type, "ArithmeticExpansion");
    if (expansion.type !== "ArithmeticExpansion") continue;
    assert.equal(expansion.expression?.type, "ArithmeticWord");
    if (expansion.expression?.type !== "ArithmeticWord") continue;
    const substitutions = expansion.expression.parts?.filter((part) => part.type === "CommandExpansion") ?? [];
    assert.deepEqual(
      substitutions.map((part) => {
        if (part.type !== "CommandExpansion") return undefined;
        const command = part.script?.commands[0].command;
        return command?.type === "Command" ? command.name?.value : undefined;
      }),
      body.includes("two") ? ["one", "two"] : ["one"],
      body,
    );
  }
});

test("malformed arithmetic keeps later command substitutions structured", () => {
  for (const body of ["x $(danger)", "x @ $(danger)", "1 2 $(danger)"]) {
    const src = `echo $(( ${body} ))`;
    const c = getCmd(parse(src));
    const expansion = computeWordParts(src, nodeOfType(c.suffix[0], "Word"))![0];
    assert.equal(expansion.type, "ArithmeticExpansion");
    if (expansion.type !== "ArithmeticExpansion") continue;
    assert.equal(expansion.expression?.type, "ArithmeticWord");
    if (expansion.expression?.type !== "ArithmeticWord") continue;
    const substitution = expansion.expression.parts?.find((part) => part.type === "CommandExpansion");
    assert.equal(substitution?.type, "CommandExpansion");
    if (substitution?.type !== "CommandExpansion") continue;
    const nested = substitution.script?.commands[0].command;
    assert.equal(nested?.type, "Command");
    if (nested?.type === "Command") assert.equal(nested.name?.value, "danger");
  }
});

test("quoted command substitutions in arithmetic remain structured", () => {
  const src = 'echo $(( "$(danger)" ))';
  const c = getCmd(parse(src));
  const expansion = computeWordParts(src, nodeOfType(c.suffix[0], "Word"))![0];
  assert.equal(expansion.type, "ArithmeticExpansion");
  if (expansion.type !== "ArithmeticExpansion") return;
  assert.equal(expansion.expression?.type, "ArithmeticWord");
  if (expansion.expression?.type !== "ArithmeticWord") return;
  const quoted = expansion.expression.parts?.find((part) => part.type === "DoubleQuoted");
  assert.equal(quoted?.type, "DoubleQuoted");
  if (quoted?.type !== "DoubleQuoted") return;
  const substitution = quoted.parts.find((part) => part.type === "CommandExpansion");
  assert.equal(substitution?.type, "CommandExpansion");
});

test("quoted closing pairs do not truncate nested arithmetic expansions", () => {
  const src = 'echo $(( $(( "safe))" + $(danger) )) + 1 ))';
  const c = getCmd(parse(src));
  const expansion = computeWordParts(src, nodeOfType(c.suffix[0], "Word"))![0];
  assert.equal(expansion.type, "ArithmeticExpansion");
  if (expansion.type !== "ArithmeticExpansion") return;
  assert.equal(expansion.expression?.type, "ArithmeticBinary");
  if (expansion.expression?.type !== "ArithmeticBinary") return;
  assert.equal(expansion.expression.left.type, "ArithmeticWord");
  if (expansion.expression.left.type !== "ArithmeticWord") return;
  const nested = expansion.expression.left.parts?.find((part) => part.type === "ArithmeticExpansion");
  assert.equal(nested?.type, "ArithmeticExpansion");
  if (nested?.type !== "ArithmeticExpansion") return;
  assert.equal(nested.expression?.type, "ArithmeticBinary");
  if (nested.expression?.type !== "ArithmeticBinary") return;
  assert.equal(nested.expression.right.type, "ArithmeticCommandExpansion");
});

test("legacy backticks in arithmetic remain structured", () => {
  const src = "echo $((`danger` + 1))";
  const c = getCmd(parse(src));
  const expansion = computeWordParts(src, nodeOfType(c.suffix[0], "Word"))![0];
  assert.equal(expansion.type, "ArithmeticExpansion");
  if (expansion.type !== "ArithmeticExpansion") return;
  assert.equal(expansion.expression?.type, "ArithmeticBinary");
  if (expansion.expression?.type !== "ArithmeticBinary") return;
  assert.equal(expansion.expression.left.type, "ArithmeticWord");
  if (expansion.expression.left.type !== "ArithmeticWord") return;
  const substitution = expansion.expression.left.parts?.find((part) => part.type === "CommandExpansion");
  assert.equal(substitution?.type, "CommandExpansion");
});

test("arithmetic subscripts keep quoted closing brackets inside substitutions", () => {
  const src = 'echo $((arr[$(printf "]")]))';
  const c = getCmd(parse(src));
  const expansion = computeWordParts(src, nodeOfType(c.suffix[0], "Word"))![0];
  assert.equal(expansion.type, "ArithmeticExpansion");
  if (expansion.type !== "ArithmeticExpansion") return;
  assert.equal(expansion.expression?.type, "ArithmeticWord");
  if (expansion.expression?.type !== "ArithmeticWord") return;
  assert.equal(expansion.expression.value, 'arr[$(printf "]")]');
  const substitution = expansion.expression.parts?.find((part) => part.type === "CommandExpansion");
  assert.equal(substitution?.type, "CommandExpansion");
});

test("quoted closing parentheses do not truncate arithmetic command substitutions", () => {
  const src = 'echo $(( $(printf ")") + 1 ))';
  const c = getCmd(parse(src));
  const expansion = computeWordParts(src, nodeOfType(c.suffix[0], "Word"))![0];
  assert.equal(expansion.type, "ArithmeticExpansion");
  if (expansion.type !== "ArithmeticExpansion") return;
  assert.equal(expansion.expression?.type, "ArithmeticBinary");
  if (expansion.expression?.type !== "ArithmeticBinary") return;
  const substitution = expansion.expression.left;
  assert.equal(substitution.type, "ArithmeticCommandExpansion");
  if (substitution.type !== "ArithmeticCommandExpansion") return;
  assert.equal(substitution.text, '$(printf ")")');
  const command = substitution.script?.commands[0].command;
  assert.equal(command?.type, "Command");
  if (command?.type === "Command") assert.equal(command.name?.value, "printf");
});

test("arithmetic parameter indexes keep command substitutions structured", () => {
  const src = "echo $(( ${arr[$(danger)]} + 1 ))";
  const c = getCmd(parse(src));
  const expansion = computeWordParts(src, nodeOfType(c.suffix[0], "Word"))![0];
  assert.equal(expansion.type, "ArithmeticExpansion");
  if (expansion.type !== "ArithmeticExpansion") return;
  assert.equal(expansion.expression?.type, "ArithmeticBinary");
  if (expansion.expression?.type !== "ArithmeticBinary") return;
  assert.equal(expansion.expression.left.type, "ArithmeticWord");
  if (expansion.expression.left.type !== "ArithmeticWord") return;
  const parameter = expansion.expression.left.parts?.find((part) => part.type === "ParameterExpansion");
  assert.equal(parameter?.type, "ParameterExpansion");
  if (parameter?.type !== "ParameterExpansion") return;
  assert.equal(parameter.index?.parts?.[0].type, "CommandExpansion");
});

test("nested arithmetic word parsing preserves outer and inner command substitutions", () => {
  const src = "echo $(( $(outer) + a[$((1+$(inner)))] ))";
  const c = getCmd(parse(src));
  const expansion = computeWordParts(src, nodeOfType(c.suffix[0], "Word"))![0];
  assert.equal(expansion.type, "ArithmeticExpansion");
  if (expansion.type !== "ArithmeticExpansion") return;
  assert.equal(expansion.expression?.type, "ArithmeticBinary");
  if (expansion.expression?.type !== "ArithmeticBinary") return;

  const outer = expansion.expression.left;
  assert.equal(outer.type, "ArithmeticCommandExpansion");
  if (outer.type !== "ArithmeticCommandExpansion") return;
  const outerCommand = outer.script?.commands[0].command;
  assert.equal(outerCommand?.type, "Command");
  if (outerCommand?.type === "Command") assert.equal(outerCommand.name?.value, "outer");

  const array = expansion.expression.right;
  assert.equal(array.type, "ArithmeticWord");
  if (array.type !== "ArithmeticWord") return;
  const nested = array.parts?.find((part) => part.type === "ArithmeticExpansion");
  assert.equal(nested?.type, "ArithmeticExpansion");
  if (nested?.type !== "ArithmeticExpansion") return;
  assert.equal(nested.expression?.type, "ArithmeticBinary");
  if (nested.expression?.type !== "ArithmeticBinary") return;
  const inner = nested.expression.right;
  assert.equal(inner.type, "ArithmeticCommandExpansion");
  if (inner.type !== "ArithmeticCommandExpansion") return;
  const innerCommand = inner.script?.commands[0].command;
  assert.equal(innerCommand?.type, "Command");
  if (innerCommand?.type === "Command") assert.equal(innerCommand.name?.value, "inner");
});

// --- Complex expressions ---

test("complex: (x + y) * (z - 1)", () => {
  const e = parseArithmeticExpression("(x + y) * (z - 1)")!;
  assert.equal(bin(e).operator, "*");
  assert.equal(group(bin(e).left).expression.type, "ArithmeticBinary");
  assert.equal(group(bin(e).right).expression.type, "ArithmeticBinary");
});

test("complex: n * (n + 1) / 2", () => {
  const e = parseArithmeticExpression("n * (n + 1) / 2")!;
  // * and / are same precedence, left-associative
  // (n * (n+1)) / 2
  assert.equal(bin(e).operator, "/");
  assert.equal(bin(bin(e).left).operator, "*");
});

test("complex: (1 << n) - 1", () => {
  const e = parseArithmeticExpression("(1 << n) - 1")!;
  assert.equal(bin(e).operator, "-");
  assert.equal(group(bin(e).left).expression.type, "ArithmeticBinary");
  assert.equal(bin(group(bin(e).left).expression).operator, "<<");
});

test("complex: rgb bitfield", () => {
  const e = parseArithmeticExpression("(255 << 16) | (128 << 8) | 64")!;
  assert.equal(bin(e).operator, "|");
});

test("complex: nested ternary", () => {
  const e = parseArithmeticExpression("x == 0 ? 1 : (x > 0 ? x : -x)")!;
  assert.equal(e.type, "ArithmeticTernary");
  const alt = ternary(e).alternate;
  assert.equal(alt.type, "ArithmeticGroup");
});

// --- Integration: $((expr)) ---

test("$((expr)) in word parts has expr", () => {
  const src = "echo $((x + y))";
  const c = getCmd(parse(src));
  const parts = computeWordParts(src, nodeOfType(c.suffix[0], "Word"))!;
  assert.equal(parts[0].type, "ArithmeticExpansion");
  const expr = nodeOfType(parts[0], "ArithmeticExpansion").expression;
  assert.ok(expr);
  assert.equal(expr.type, "ArithmeticBinary");
  assert.equal(expr.operator, "+");
});

test("$((expr)) nested in double quotes", () => {
  const src = 'echo "result: $((a * b))"';
  const c = getCmd(parse(src));
  const parts = computeWordParts(src, nodeOfType(c.suffix[0], "Word"))!;
  assert.equal(parts[0].type, "DoubleQuoted");
  const inner = nodeOfType(parts[0], "DoubleQuoted").parts;
  const arith = inner.find((p) => p.type === "ArithmeticExpansion");
  assert.ok(arith);
  assert.equal(nodeOfType(arith.expression, "ArithmeticBinary").operator, "*");
});

// --- Integration: (( expr )) ---

test("(( expr )) has parsed expr in ArithmeticCommand", () => {
  const ast = parse("(( x += 5 ))");
  const node = nodeOfType(ast.commands[0].command, "ArithmeticCommand");
  assert.equal(node.type, "ArithmeticCommand");
  assert.equal(node.body, " x += 5 ");
  assert.ok(node.expression);
  assert.equal(node.expression!.type, "ArithmeticBinary");
  assert.equal(nodeOfType(node.expression, "ArithmeticBinary").operator, "+=");
});

test("arithmetic commands keep nested subscript words (#272)", () => {
  const source = "((a[b[i]]))";
  const ast = parse(source);
  assert.equal(ast.errors, undefined);
  assert.deepEqual(
    ast.commands.map(({ pos, end }) => [pos, end]),
    [[0, 11]],
  );
  const node = ast.commands[0].command;
  assert.equal(node.type, "ArithmeticCommand");
  if (node.type !== "ArithmeticCommand") return;
  assert.equal(node.body, "a[b[i]]");
  const expression = node.expression;
  assert.equal(expression?.type, "ArithmeticWord");
  if (expression?.type !== "ArithmeticWord") return;
  assert.deepEqual([expression.pos, expression.end, expression.value], [2, 9, "a[b[i]]"]);
});

test("ArithmeticCommand serializes its lazy expression", () => {
  const ast: ReturnType<typeof parse> = JSON.parse(JSON.stringify(parse("(( x + 1 ))")));
  const node = ast.commands[0].command;
  assert.equal(node.type, "ArithmeticCommand");
  if (node.type !== "ArithmeticCommand") return;
  assert.equal(node.expression?.type, "ArithmeticBinary");
  if (node.expression?.type !== "ArithmeticBinary") return;
  assert.equal(node.expression.operator, "+");
});

// --- Integration: ArithmeticFor ---

test("for (( init; test; update )) has parsed exprs", () => {
  const ast = parse("for (( i = 0; i < 10; i++ )); do echo $i; done");
  const node = nodeOfType(ast.commands[0].command, "ArithmeticFor");
  assert.equal(node.type, "ArithmeticFor");

  assert.ok(node.initialize);
  assert.equal(node.initialize!.type, "ArithmeticBinary");
  assert.equal(nodeOfType(node.initialize, "ArithmeticBinary").operator, "=");

  assert.ok(node.test);
  assert.equal(node.test!.type, "ArithmeticBinary");
  assert.equal(nodeOfType(node.test, "ArithmeticBinary").operator, "<");

  assert.ok(node.update);
  assert.equal(node.update!.type, "ArithmeticUnary");
  assert.equal(nodeOfType(node.update, "ArithmeticUnary").operator, "++");
  assert.equal(nodeOfType(node.update, "ArithmeticUnary").prefix, false);
});

test("ArithmeticFor serializes all lazy expressions", () => {
  const ast: ReturnType<typeof parse> = JSON.parse(
    JSON.stringify(parse("for (( i = 0; i < 10; i++ )); do echo $i; done")),
  );
  const node = ast.commands[0].command;
  assert.equal(node.type, "ArithmeticFor");
  if (node.type !== "ArithmeticFor") return;
  assert.equal(node.initialize?.type, "ArithmeticBinary");
  assert.equal(node.test?.type, "ArithmeticBinary");
  assert.equal(node.update?.type, "ArithmeticUnary");
  if (node.initialize?.type !== "ArithmeticBinary") return;
  if (node.test?.type !== "ArithmeticBinary") return;
  if (node.update?.type !== "ArithmeticUnary") return;
  assert.equal(node.initialize.operator, "=");
  assert.equal(node.test.operator, "<");
  assert.equal(node.update.operator, "++");
});

test("for (( i=0, j=10; ... )) comma in init", () => {
  const ast = parse("for (( i = 0, j = 10; i < j; i++, j-- )); do echo; done");
  const node = nodeOfType(ast.commands[0].command, "ArithmeticFor");
  assert.ok(node.initialize);
  assert.equal(nodeOfType(node.initialize, "ArithmeticBinary").operator, ",");
  assert.ok(node.update);
  assert.equal(nodeOfType(node.update, "ArithmeticBinary").operator, ",");
});

// --- ArithmeticCommand ---

test("(( )) produces ArithmeticCommand", () => {
  const ast = parse("(( x++ ))");
  const node = nodeOfType(ast.commands[0].command, "ArithmeticCommand");
  assert.equal(node.type, "ArithmeticCommand");
  assert.equal(node.body.trim(), "x++");
});

test("(( )) has parsed expr", () => {
  const ast = parse("(( 1 + 2 * 3 ))");
  const node = nodeOfType(ast.commands[0].command, "ArithmeticCommand");
  assert.ok(node.expression);
  assert.equal(node.expression!.type, "ArithmeticBinary");
});

test("(( )) in if clause", () => {
  const ast = parse("if (( x > 0 )); then echo pos; fi");
  assert.equal(ast.commands[0].command.type, "If");
});

test("(( )) in while clause", () => {
  const ast = parse("while (( n-- > 0 )); do echo $n; done");
  assert.equal(ast.commands[0].command.type, "While");
});

test("(( )) in logical expression", () => {
  const ast = parse("(( x > 0 )) && echo yes");
  const logic = nodeOfType(ast.commands[0].command, "AndOr");
  assert.equal(logic.type, "AndOr");
  assert.equal(logic.commands[0].type, "ArithmeticCommand");
});

test("(( )) in pipeline", () => {
  const ast = parse("(( x++ )) | cat");
  const pipe = nodeOfType(ast.commands[0].command, "Pipeline");
  assert.equal(pipe.type, "Pipeline");
  assert.equal(pipe.commands[0].type, "ArithmeticCommand");
});

test("(( )) body preserved", () => {
  const ast = parse("(( a = b + c - d * e ))");
  const node = nodeOfType(ast.commands[0].command, "ArithmeticCommand");
  assert.equal(node.body, " a = b + c - d * e ");
});

test("(( )) does not interfere with C-style for", () => {
  const ast = parse("for (( i=0; i<3; i++ )); do echo $i; done");
  assert.equal(ast.commands.length, 1);
  assert.equal(ast.commands[0].command.type, "ArithmeticFor");
});

// --- (( )) vs ( ) disambiguation ---

test("(( at command position is arithmetic command", () => {
  const ast = parse("(( x++ ))");
  assert.equal(ast.commands[0].command.type, "ArithmeticCommand");
});

test("$(( )) is arithmetic expansion in word", () => {
  const c = getCmd(parse("echo $((1+2))"));
  assert.equal(nodeOfType(c.suffix[0], "Word").text, "$((1+2))");
});

test("arithmetic expansion keeps grouped closing parentheses", () => {
  for (const source of ["$((1 >> (3 << 2)))", "$((-(1)))", "$((a <= (1 || 2)))", "$(((1+2)))"]) {
    const word = nodeOfType(getCmd(parse(`echo ${source}`)).suffix[0], "Word");
    assert.equal(word.parts?.[0].text, source);
  }

  for (const nested of ["$(((1 + $((2)) + 3)))", "$(((1 + $(((2 + $((3)) + 4))) + 5)))"]) {
    const command = getCmd(parse(`echo ${nested} tail`));
    assert.equal(nodeOfType(command.suffix[0], "Word").parts?.[0].text, nested);
    assert.equal(nodeOfType(command.suffix[1], "Word").text, "tail");
  }
});

test("( is subshell", () => {
  const ast = parse("(echo hello)");
  assert.equal(ast.commands[0].command.type, "Subshell");
});

// --- Arithmetic expressions in scripts ---

test("arithmetic expressions parse without errors", () => {
  const scripts = [
    "echo $((1 + 2 - 3 * 4 / 5))",
    "a=$((6 % 7 ** 8))",
    "echo $((a>b?5:10))",
    "echo $((${j:-5} + 1))",
    "echo $(( 0x12A ))",
    "echo $((++a))",
  ];
  for (const script of scripts) {
    const ast = parse(script);
    assert.ok(ast.commands.length > 0, `Failed: ${script}`);
  }
});

// --- Command substitution in arithmetic ---

test("command substitution in arithmetic - raw parse", () => {
  const e = parseEmbedded("$(cmd) + 1")!;
  assert.equal(e.type, "ArithmeticBinary");
  assert.equal(bin(e).operator, "+");
  const left = nodeOfType(bin(e).left, "ArithmeticCommandExpansion");
  assert.equal(left.type, "ArithmeticCommandExpansion");
  assert.equal(left.text, "$(cmd)");
  assert.equal("inner" in left, false);
  assert.equal(left.script, undefined);
});

test("command substitution with argument in arithmetic", () => {
  const e = parseEmbedded("$(echo hello) + x")!;
  assert.equal(e.type, "ArithmeticBinary");
  const left = nodeOfType(bin(e).left, "ArithmeticCommandExpansion");
  assert.equal(left.type, "ArithmeticCommandExpansion");
  assert.equal(left.text, "$(echo hello)");
  assert.equal("inner" in left, false);
});

test("nested command substitution in arithmetic", () => {
  const e = nodeOfType(parseEmbedded("$(echo $(inner))")!, "ArithmeticCommandExpansion");
  assert.equal(e.type, "ArithmeticCommandExpansion");
  assert.equal(e.text, "$(echo $(inner))");
  assert.equal("inner" in e, false);
});

test("command substitution at start and end of expression", () => {
  const e = parseEmbedded("$(a) + $(b)")!;
  assert.equal(e.type, "ArithmeticBinary");
  const left = nodeOfType(bin(e).left, "ArithmeticCommandExpansion");
  const right = nodeOfType(bin(e).right, "ArithmeticCommandExpansion");
  assert.equal(left.type, "ArithmeticCommandExpansion");
  assert.equal(right.type, "ArithmeticCommandExpansion");
  assert.equal(left.text, "$(a)");
  assert.equal(right.text, "$(b)");
});

test("command substitution resolved in arithmetic expansion", () => {
  const ast = parse("echo $(( $(cmd) + 1 ))");
  const parts = computeWordParts("echo $(( $(cmd) + 1 ))", nodeOfType(getCmd(ast).suffix[0], "Word"))!;
  const arith = nodeOfType(parts[0], "ArithmeticExpansion");
  assert.equal(arith.type, "ArithmeticExpansion");
  const binary = nodeOfType(arith.expression, "ArithmeticBinary");
  assert.equal(binary.type, "ArithmeticBinary");
  const left = nodeOfType(binary.left, "ArithmeticCommandExpansion");
  assert.equal(left.type, "ArithmeticCommandExpansion");
  assert.equal("inner" in left, false);
  assert.ok(left.script); // now populated
  assert.equal(left.script!.commands[0].command.type, "Command");
});

test("command substitution in arithmetic command", () => {
  const ast = parse("(( $(cmd) ))");
  const arithCmd = nodeOfType(ast.commands[0].command, "ArithmeticCommand");
  const expr = nodeOfType(arithCmd.expression!, "ArithmeticCommandExpansion");
  assert.equal(expr.type, "ArithmeticCommandExpansion");
  assert.ok(expr.script);
});

test("command substitution in arithmetic for loop", () => {
  const ast = parse("for (( i = $(start); i < $(limit); i++ )); do echo $i; done");
  const forLoop = nodeOfType(ast.commands[0].command, "ArithmeticFor");
  assert.ok(forLoop.initialize);
  const initBin = nodeOfType(forLoop.initialize, "ArithmeticBinary");
  assert.equal(initBin.type, "ArithmeticBinary");
  assert.equal(initBin.operator, "=");
  const initRight = nodeOfType(initBin.right, "ArithmeticCommandExpansion");
  assert.equal(initRight.type, "ArithmeticCommandExpansion");
  assert.equal(initRight.text, "$(start)");
  assert.ok(initRight.script);

  assert.ok(forLoop.test);
  const testBin = nodeOfType(forLoop.test, "ArithmeticBinary");
  assert.equal(testBin.type, "ArithmeticBinary");
  const testRight = nodeOfType(testBin.right, "ArithmeticCommandExpansion");
  assert.equal(testRight.type, "ArithmeticCommandExpansion");
  assert.ok(testRight.script);
});

// `$[ expr ]` is bash's deprecated spelling of `$(( expr ))`. Bash scans to the matching
// `]`, so parentheses inside are part of the expansion rather than word delimiters.
test("deprecated $[ ] arithmetic expansion", () => {
  for (const source of ["echo $[1+2]", "echo $[(1+2)*3]", "echo $[((a+b)*(c-d))/e]", "echo $[ (1) ]"]) {
    const ast = parse(source);
    assert.equal(ast.errors, undefined, source);
    const word = nodeOfType(getCmd(ast).suffix[0], "Word");
    assert.equal(word.text, source.slice(5), source);
    const part = computeWordParts(source, word)![0];
    assert.equal(part.type, "ArithmeticExpansion", source);
    assert.equal(part.type === "ArithmeticExpansion" && part.text, source.slice(5), source);
  }
});

test("deprecated $[ ] keeps nested substitutions structured", () => {
  const src = "echo $[$(one)+$(two)]";
  const part = computeWordParts(src, nodeOfType(getCmd(parse(src)).suffix[0], "Word"))![0];
  assert.equal(part.type, "ArithmeticExpansion");
  if (part.type !== "ArithmeticExpansion") return;
  const bin = nodeOfType(part.expression, "ArithmeticBinary");
  assert.equal(bin.type, "ArithmeticBinary");
  assert.equal(nodeOfType(bin.left, "ArithmeticCommandExpansion").text, "$(one)");
  assert.equal(nodeOfType(bin.right, "ArithmeticCommandExpansion").text, "$(two)");
});

test("$[ ] closes at the first unnested bracket, even inside braces", () => {
  // Bash's `$[` matcher counts brackets and honours quotes and `$( )`, but does not
  // recurse into `${ }` — unlike an array subscript, where `h[${x:-]}]=1` keys on `]`.
  for (const source of [
    "$[${]",
    "echo $[${x-]}",
    "echo $[${x-]}${y-]}",
    "echo $[$(echo ])]",
    "echo $[${x}]",
    "echo $[${a[1]}+1]",
  ])
    assert.equal(parse(source).errors, undefined, source);

  const subscript = nodeOfType(parse("h[${x:-]}]=1").commands[0].command, "Command");
  assert.equal(subscript.prefix[0].type, "Assignment");
  if (subscript.prefix[0].type === "Assignment") assert.equal(subscript.prefix[0].index?.text, "${x:-]}");
});

test("unparsed arithmetic tokens keep the whole body as one word", () => {
  for (const [source, expected] of [
    ["(( 1 2 ))", "1 2"],
    ["(( x = 1.5 ))", "x = 1.5"],
    ["(( x = y [ 0 ] ))", "x = y [ 0 ]"],
    ["for ((i=0 1; i<2; i++)); do :; done", "i=0 1"],
  ]) {
    const command = parse(source).commands[0].command;
    const expression =
      command.type === "ArithmeticFor" ? command.initialize : nodeOfType(command, "ArithmeticCommand").expression;
    assert.equal(expression?.type, "ArithmeticWord", source);
    if (expression?.type !== "ArithmeticWord") continue;
    assert.equal(expression.value, expected, source);
    assert.equal(source.slice(expression.pos, expression.end), expected, source);
    assert.equal(expression.parts, undefined, source);
  }
});

test("unterminated arithmetic reports an error and keeps its body", () => {
  for (const [source, message, pos] of [
    ["(( 1", "unterminated arithmetic command", 0],
    ["((", "unterminated arithmetic command", 0],
    ["echo $(( 1 +", "unterminated arithmetic expansion", 5],
    ["x=$((", "unterminated arithmetic expansion", 2],
  ] as const) {
    assert.deepEqual(parse(source).errors, [{ message, pos }], source);
  }
  assert.deepEqual(parse('echo "$(( 1"').errors, [
    { message: "unterminated double quote", pos: 5 },
    { message: "unterminated arithmetic expansion", pos: 6 },
  ]);
  const command = nodeOfType(parse("(( 1").commands[0].command, "ArithmeticCommand");
  assert.equal(command.body, " 1");
  assert.equal(command.expression?.type, "ArithmeticWord");
  const word = nodeOfType(getCmd(parse("echo $(( 1 +")).suffix[0], "Word");
  assert.equal(word.text, "$(( 1 +");
  assert.equal(word.value, "$(( 1 +");
});

test("arithmetic for headers need exactly three expressions", () => {
  const message = "expected three arithmetic expressions in for header";
  assert.deepEqual(parse("for ((i=0;i<2)); do :; done").errors, [{ message, pos: 13 }]);
  const four = parse("for ((1;2;3;4)); do :; done");
  assert.deepEqual(four.errors, [{ message, pos: 11 }]);
  const loop = nodeOfType(four.commands[0].command, "ArithmeticFor");
  assert.equal(loop.update?.type, "ArithmeticWord");
  assert.equal(loop.update?.type === "ArithmeticWord" ? loop.update.value : undefined, "3");
  assert.equal(parse("for ((;;)); do :; done").errors, undefined);
  assert.equal(parse("for ((i=0;i<2;)); do :; done").errors, undefined);
  const open = parse("for ((i=0;;");
  assert.deepEqual(open.errors?.[0], { message: "unterminated arithmetic for header", pos: 5 });
  const initialize = nodeOfType(open.commands[0].command, "ArithmeticFor").initialize;
  assert.equal(initialize?.type === "ArithmeticBinary" ? initialize.operator : undefined, "=");
});
