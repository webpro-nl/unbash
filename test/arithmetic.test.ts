import assert from "node:assert/strict";
import test from "node:test";
import { parseArithmeticExpression, type ArithmeticParseCollector } from "../src/arithmetic.ts";
import { Lexer } from "../src/lexer.ts";
import { parse } from "../src/parser.ts";
import { computeWordParts } from "../src/parts.ts";
import type {
  ArithmeticBinary,
  ArithmeticCommandExpansion,
  ArithmeticExpression,
  ArithmeticGroup,
  ArithmeticTernary,
  ArithmeticUnary,
  ArithmeticWord,
  ArithmeticFor,
  Command,
} from "../src/types.ts";

const getCmd = (ast: ReturnType<typeof parse>, i = 0) => ast.commands[i].command as Command;

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
const bin = (e: ArithmeticExpression) => e as ArithmeticBinary;
const unary = (e: ArithmeticExpression) => e as ArithmeticUnary;
const ternary = (e: ArithmeticExpression) => e as ArithmeticTernary;
const group = (e: ArithmeticExpression) => e as ArithmeticGroup;
const word = (e: ArithmeticExpression) => e as ArithmeticWord;

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
  const expansion = computeWordParts(src, c.suffix[0])![0];
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
    const expansion = computeWordParts(src, c.suffix[0])![0];
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
    const expansion = computeWordParts(src, c.suffix[0])![0];
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
  const expansion = computeWordParts(src, c.suffix[0])![0];
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
  const expansion = computeWordParts(src, c.suffix[0])![0];
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
  const expansion = computeWordParts(src, c.suffix[0])![0];
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
  const expansion = computeWordParts(src, c.suffix[0])![0];
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
  const expansion = computeWordParts(src, c.suffix[0])![0];
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
  const expansion = computeWordParts(src, c.suffix[0])![0];
  assert.equal(expansion.type, "ArithmeticExpansion");
  if (expansion.type !== "ArithmeticExpansion") return;
  assert.equal(expansion.expression?.type, "ArithmeticBinary");
  if (expansion.expression?.type !== "ArithmeticBinary") return;
  assert.equal(expansion.expression.left.type, "ArithmeticWord");
  if (expansion.expression.left.type !== "ArithmeticWord") return;
  const parameter = expansion.expression.left.parts?.find((part) => part.type === "ParameterExpansion");
  assert.equal(parameter?.type, "ParameterExpansion");
  if (parameter?.type !== "ParameterExpansion") return;
  assert.equal(parameter.indexParts?.[0].type, "CommandExpansion");
});

test("nested arithmetic word parsing preserves outer and inner command substitutions", () => {
  const src = "echo $(( $(outer) + a[$((1+$(inner)))] ))";
  const c = getCmd(parse(src));
  const expansion = computeWordParts(src, c.suffix[0])![0];
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
  const parts = computeWordParts(src, c.suffix[0])!;
  assert.equal(parts[0].type, "ArithmeticExpansion");
  const expr = (parts[0] as any).expression;
  assert.ok(expr);
  assert.equal(expr.type, "ArithmeticBinary");
  assert.equal(expr.operator, "+");
});

test("$((expr)) nested in double quotes", () => {
  const src = 'echo "result: $((a * b))"';
  const c = getCmd(parse(src));
  const parts = computeWordParts(src, c.suffix[0])!;
  assert.equal(parts[0].type, "DoubleQuoted");
  const inner = (parts[0] as any).parts;
  const arith = inner.find((p: any) => p.type === "ArithmeticExpansion");
  assert.ok(arith);
  assert.ok(arith.expression);
  assert.equal(arith.expression.operator, "*");
});

// --- Integration: (( expr )) ---

test("(( expr )) has parsed expr in ArithmeticCommand", () => {
  const ast = parse("(( x += 5 ))");
  const node = ast.commands[0].command as import("../src/types.ts").ArithmeticCommand;
  assert.equal(node.type, "ArithmeticCommand");
  assert.equal(node.body, " x += 5 ");
  assert.ok(node.expression);
  assert.equal(node.expression!.type, "ArithmeticBinary");
  assert.equal((node.expression as any).operator, "+=");
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
  const node = ast.commands[0].command as ArithmeticFor;
  assert.equal(node.type, "ArithmeticFor");

  assert.ok(node.initialize);
  assert.equal(node.initialize!.type, "ArithmeticBinary");
  assert.equal((node.initialize as ArithmeticBinary).operator, "=");

  assert.ok(node.test);
  assert.equal(node.test!.type, "ArithmeticBinary");
  assert.equal((node.test as ArithmeticBinary).operator, "<");

  assert.ok(node.update);
  assert.equal(node.update!.type, "ArithmeticUnary");
  assert.equal((node.update as ArithmeticUnary).operator, "++");
  assert.equal((node.update as ArithmeticUnary).prefix, false);
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
  const node = ast.commands[0].command as ArithmeticFor;
  assert.ok(node.initialize);
  assert.equal((node.initialize as ArithmeticBinary).operator, ",");
  assert.ok(node.update);
  assert.equal((node.update as ArithmeticBinary).operator, ",");
});

// --- ArithmeticCommand ---

test("(( )) produces ArithmeticCommand", () => {
  const ast = parse("(( x++ ))");
  const node = ast.commands[0].command as import("../src/types.ts").ArithmeticCommand;
  assert.equal(node.type, "ArithmeticCommand");
  assert.equal(node.body.trim(), "x++");
});

test("(( )) has parsed expr", () => {
  const ast = parse("(( 1 + 2 * 3 ))");
  const node = ast.commands[0].command as import("../src/types.ts").ArithmeticCommand;
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
  const logic = ast.commands[0].command as import("../src/types.ts").AndOr;
  assert.equal(logic.type, "AndOr");
  assert.equal(logic.commands[0].type, "ArithmeticCommand");
});

test("(( )) in pipeline", () => {
  const ast = parse("(( x++ )) | cat");
  const pipe = ast.commands[0].command as import("../src/types.ts").Pipeline;
  assert.equal(pipe.type, "Pipeline");
  assert.equal(pipe.commands[0].type, "ArithmeticCommand");
});

test("(( )) body preserved", () => {
  const ast = parse("(( a = b + c - d * e ))");
  const node = ast.commands[0].command as import("../src/types.ts").ArithmeticCommand;
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
  assert.equal(c.suffix[0].text, "$((1+2))");
});

test("arithmetic expansion keeps grouped closing parentheses", () => {
  for (const source of ["$((1 >> (3 << 2)))", "$((-(1)))", "$((a <= (1 || 2)))", "$(((1+2)))"]) {
    const word = getCmd(parse(`echo ${source}`)).suffix[0];
    assert.equal(word.parts?.[0].text, source);
  }

  for (const nested of ["$(((1 + $((2)) + 3)))", "$(((1 + $(((2 + $((3)) + 4))) + 5)))"]) {
    const command = getCmd(parse(`echo ${nested} tail`));
    assert.equal(command.suffix[0].parts?.[0].text, nested);
    assert.equal(command.suffix[1].text, "tail");
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
  const left = bin(e).left;
  assert.equal(left.type, "ArithmeticCommandExpansion");
  assert.equal((left as ArithmeticCommandExpansion).text, "$(cmd)");
  assert.equal((left as ArithmeticCommandExpansion).inner, "cmd");
  assert.equal((left as ArithmeticCommandExpansion).script, undefined);
});

test("command substitution with argument in arithmetic", () => {
  const e = parseEmbedded("$(echo hello) + x")!;
  assert.equal(e.type, "ArithmeticBinary");
  const left = bin(e).left as ArithmeticCommandExpansion;
  assert.equal(left.type, "ArithmeticCommandExpansion");
  assert.equal(left.text, "$(echo hello)");
  assert.equal(left.inner, "echo hello");
});

test("nested command substitution in arithmetic", () => {
  const e = parseEmbedded("$(echo $(inner))")!;
  assert.equal(e.type, "ArithmeticCommandExpansion");
  assert.equal((e as ArithmeticCommandExpansion).text, "$(echo $(inner))");
  assert.equal((e as ArithmeticCommandExpansion).inner, "echo $(inner)");
});

test("command substitution at start and end of expression", () => {
  const e = parseEmbedded("$(a) + $(b)")!;
  assert.equal(e.type, "ArithmeticBinary");
  const left = bin(e).left as ArithmeticCommandExpansion;
  const right = bin(e).right as ArithmeticCommandExpansion;
  assert.equal(left.type, "ArithmeticCommandExpansion");
  assert.equal(right.type, "ArithmeticCommandExpansion");
  assert.equal(left.text, "$(a)");
  assert.equal(right.text, "$(b)");
});

test("command substitution resolved in arithmetic expansion", () => {
  const ast = parse("echo $(( $(cmd) + 1 ))");
  const parts = computeWordParts("echo $(( $(cmd) + 1 ))", getCmd(ast).suffix[0])!;
  const arith = parts[0] as import("../src/types.ts").ArithmeticExpansionPart;
  assert.equal(arith.type, "ArithmeticExpansion");
  const binary = arith.expression as ArithmeticBinary;
  assert.equal(binary.type, "ArithmeticBinary");
  const left = binary.left as ArithmeticCommandExpansion;
  assert.equal(left.type, "ArithmeticCommandExpansion");
  assert.equal(left.inner, undefined); // cleared after resolution
  assert.ok(left.script); // now populated
  assert.equal(left.script!.commands[0].command.type, "Command");
});

test("command substitution in arithmetic command", () => {
  const ast = parse("(( $(cmd) ))");
  const arithCmd = ast.commands[0].command as import("../src/types.ts").ArithmeticCommand;
  const expr = arithCmd.expression!;
  assert.equal(expr.type, "ArithmeticCommandExpansion");
  assert.ok((expr as ArithmeticCommandExpansion).script);
});

test("command substitution in arithmetic for loop", () => {
  const ast = parse("for (( i = $(start); i < $(limit); i++ )); do echo $i; done");
  const forLoop = ast.commands[0].command as ArithmeticFor;
  assert.ok(forLoop.initialize);
  const initBin = forLoop.initialize as ArithmeticBinary;
  assert.equal(initBin.type, "ArithmeticBinary");
  assert.equal(initBin.operator, "=");
  const initRight = initBin.right as ArithmeticCommandExpansion;
  assert.equal(initRight.type, "ArithmeticCommandExpansion");
  assert.equal(initRight.text, "$(start)");
  assert.ok(initRight.script);

  assert.ok(forLoop.test);
  const testBin = forLoop.test as ArithmeticBinary;
  assert.equal(testBin.type, "ArithmeticBinary");
  const testRight = testBin.right as ArithmeticCommandExpansion;
  assert.equal(testRight.type, "ArithmeticCommandExpansion");
  assert.ok(testRight.script);
});

// `$[ expr ]` is bash's deprecated spelling of `$(( expr ))`. Bash scans to the matching
// `]`, so parentheses inside are part of the expansion rather than word delimiters.
test("deprecated $[ ] arithmetic expansion", () => {
  for (const source of ["echo $[1+2]", "echo $[(1+2)*3]", "echo $[((a+b)*(c-d))/e]", "echo $[ (1) ]"]) {
    const ast = parse(source);
    assert.equal(ast.errors, undefined, source);
    const word = getCmd(ast).suffix[0];
    assert.equal(word.text, source.slice(5), source);
    const part = computeWordParts(source, word)![0];
    assert.equal(part.type, "ArithmeticExpansion", source);
    assert.equal(part.type === "ArithmeticExpansion" && part.text, source.slice(5), source);
  }
});

test("deprecated $[ ] keeps nested substitutions structured", () => {
  const src = "echo $[$(one)+$(two)]";
  const part = computeWordParts(src, getCmd(parse(src)).suffix[0])![0];
  assert.equal(part.type, "ArithmeticExpansion");
  if (part.type !== "ArithmeticExpansion") return;
  const bin = part.expression as ArithmeticBinary;
  assert.equal(bin.type, "ArithmeticBinary");
  assert.equal((bin.left as ArithmeticCommandExpansion).text, "$(one)");
  assert.equal((bin.right as ArithmeticCommandExpansion).text, "$(two)");
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

  const subscript = parse("h[${x:-]}]=1").commands[0].command as Command;
  assert.equal(subscript.prefix[0].type, "Assignment");
  if (subscript.prefix[0].type === "Assignment") assert.equal(subscript.prefix[0].index, "${x:-]}");
});
