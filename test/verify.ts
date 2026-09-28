// Round-trip AST verifier: verify(src, parse(src)) === src
// Walks AST, fills gaps from source, validates content fields against source.
// Also verifies word parts: parts.map(p => p.text).join('') === source span.

import type { ArithmeticExpression, SyntaxNode, WordPart, DoubleQuotedChild } from "../src/types.ts";

type AnyNode = { type: string; pos: number; end: number; [k: string]: any };

const CHILDREN: Record<string, string[]> = {
  Script: ["commands"],
  Statement: ["command"],
  Command: ["prefix", "name", "suffix"],
  Redirected: ["command", "redirects"],
  Redirect: ["descriptor", "target"],
  HereString: ["descriptor", "target"],
  HereDoc: ["descriptor", "delimiter"],
  Assignment: ["index", "value"],
  ArrayValue: ["elements"],
  Pipeline: ["commands"],
  Time: ["command"],
  Negation: ["command"],
  AndOr: ["commands"],
  If: ["clause", "then", "else"],
  For: ["name", "wordlist", "body"],
  ArithmeticFor: ["body"],
  ArithmeticCommand: ["expression"],
  While: ["clause", "body"],
  Case: ["word", "items"],
  CaseItem: ["pattern", "body"],
  Select: ["name", "wordlist", "body"],
  Function: ["name", "body"],
  Subshell: ["body"],
  BraceGroup: ["body"],
  CompoundList: ["commands"],
  Coproc: ["name", "body"],
  TestCommand: ["expression"],
  TestUnary: ["operand"],
  TestBinary: ["left", "right"],
  TestLogical: ["left", "right"],
  TestNot: ["operand"],
  TestGroup: ["expression"],
  ArithmeticBinary: ["left", "right"],
  ArithmeticUnary: ["operand"],
  ArithmeticTernary: ["test", "consequent", "alternate"],
  ArithmeticGroup: ["expression"],
};

function getChildren(node: AnyNode): AnyNode[] {
  const fields = CHILDREN[node.type];
  if (!fields) return [];
  const children: AnyNode[] = [];
  for (const field of fields) {
    const value = node[field];
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item.pos === "number" && item.pos >= node.pos && item.end <= node.end) {
          children.push(item);
        }
      }
    } else if (typeof value.pos === "number" && value.pos >= node.pos && value.end <= node.end) {
      children.push(value);
    }
  }
  // Sort needed: Command nodes can have redirects interleaved with args
  children.sort((a, b) => a.pos - b.pos);
  return children;
}

function fail(node: AnyNode, field: string, expected: string, got: string): never {
  throw new Error(
    `${node.type}.${field} mismatch at ${node.pos}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`,
  );
}

function checkContent(src: string, node: AnyNode) {
  const span = src.slice(node.pos, node.end);
  switch (node.type) {
    case "Word":
    case "HereDocDelimiter":
    case "HereDocBody":
      if (node.text !== span) fail(node, "text", span, node.text);
      break;
    case "HereDoc":
      _verify(src, node.body);
      break;
    case "Assignment":
      if (node.text !== span) fail(node, "text", span, node.text);
      break;
    case "ArithmeticWord":
      if (node.value !== span) fail(node, "value", span, node.value);
      break;
    case "ArithmeticCommandExpansion":
      if (node.text !== span) fail(node, "text", span, node.text);
      break;
    case "ArithmeticCommand":
      // body is text between (( and )), source span starts with ((
      if (span.startsWith("((") && span.endsWith("))")) {
        const expected = span.slice(2, -2);
        if (node.body !== expected) fail(node, "body", expected, node.body);
      }
      break;
    case "While":
      if (!span.startsWith(node.kind)) fail(node, "kind", span.slice(0, 5), node.kind);
      break;
  }
}

export function verify(source: string, node: SyntaxNode): string {
  return _verify(source, node);
}

function _verify(source: string, node: AnyNode): string {
  if (node.type === "Script" && node.source !== undefined) source = node.source;
  checkContent(source, node);
  const children = getChildren(node);
  if (children.length === 0) {
    if (node.type === "Word" || node.type === "HereDocBody") {
      verifyParts(source, node);
    }
    return source.slice(node.pos, node.end);
  }
  let result = "";
  let cursor = node.pos;
  for (const child of children) {
    result += source.slice(cursor, child.pos);
    result += _verify(source, child);
    cursor = child.end;
  }
  result += source.slice(cursor, node.end);
  return result;
}

function verifyParts(source: string, word: AnyNode) {
  // Use the public getter: nested-substitution words resolve their parts in
  // their bounded inner context (and cache them), so re-lexing the original
  // here would overrun word boundaries adjacent to substitution delimiters.
  const parts = (word as { parts?: readonly WordPart[] }).parts;
  if (!parts) return;

  const span = source.slice(word.pos, word.end);
  const concat = parts.map((p: any) => p.text).join("");
  if (concat !== span) {
    throw new Error(
      `Parts text concat mismatch at ${word.pos}: expected ${JSON.stringify(span)}, got ${JSON.stringify(concat)}`,
    );
  }

  for (const part of parts) {
    verifyPartChildren(source, part);
  }
}

// oxlint-disable-next-line only-used-in-recursion
function verifyPartChildren(source: string, part: WordPart | DoubleQuotedChild) {
  if (part.pos < 0 || part.end < part.pos || part.end > source.length) {
    throw new Error(`${part.type} range [${part.pos}, ${part.end}) falls outside its source`);
  }
  if (part.text !== source.slice(part.pos, part.end)) {
    throw new Error(`${part.type} text does not match its source range [${part.pos}, ${part.end})`);
  }
  if (part.type === "ParameterExpansion") {
    if (part.parameter !== source.slice(part.parameterPos, part.parameterEnd)) {
      throw new Error(`ParameterExpansion parameter does not match its source range`);
    }
    if (part.index) _verify(source, part.index);
    const operation = part.operation;
    if (operation) {
      if (operation.operator !== source.slice(operation.pos, operation.operatorEnd)) {
        throw new Error(`${operation.type} parameter operator does not match its source range`);
      }
      if (operation.pos < part.parameterEnd || operation.end > part.end || operation.operatorEnd > operation.end) {
        throw new Error(`${operation.type} parameter operation falls outside its containing expansion`);
      }
      if ("operand" in operation && operation.operand) _verify(source, operation.operand);
      else if (operation.type === "Slice") {
        _verify(source, operation.offset);
        if (operation.length) _verify(source, operation.length);
      } else if (operation.type === "Replace") {
        _verify(source, operation.pattern);
        _verify(source, operation.replacement);
      }
    }
  }
  if (part.type === "DoubleQuoted" || part.type === "LocaleString") {
    const prefix = part.type === "LocaleString" ? 2 : 1; // $" vs "
    const inner = part.text.slice(prefix, -1);
    const childConcat = part.parts.map((c: any) => c.text).join("");
    if (childConcat !== inner) {
      throw new Error(
        `${part.type} children text concat mismatch: expected ${JSON.stringify(inner)}, got ${JSON.stringify(childConcat)}`,
      );
    }
    for (const child of part.parts) {
      verifyPartChildren(source, child);
    }
  }

  if ((part.type === "CommandExpansion" || part.type === "ProcessSubstitution") && part.script) {
    // Nested script spans are absolute in the original source, so the inner
    // command text slices straight out of it.
    const expected = (part.script.source ?? source).slice(part.script.pos, part.script.end);
    const rebuilt = _verify(source, part.script as any);
    if (rebuilt !== expected) {
      throw new Error(
        `${part.type} inner script verify failed: expected ${JSON.stringify(expected)}, got ${JSON.stringify(rebuilt)}`,
      );
    }
  }

  if (part.type === "ArithmeticExpansion" && part.expression) {
    verifyArithExpansions(source, part.expression);
  }
}

function verifyArithExpansions(source: string, e: ArithmeticExpression): void {
  switch (e.type) {
    case "ArithmeticCommandExpansion":
      if (e.script) {
        const innerSrc = source.slice(e.script.pos, e.script.end);
        const rebuilt = _verify(source, e.script as any);
        if (rebuilt !== innerSrc) {
          throw new Error(
            `ArithmeticCommandExpansion inner script verify failed: expected ${JSON.stringify(innerSrc)}, got ${JSON.stringify(rebuilt)}`,
          );
        }
      }
      break;
    case "ArithmeticBinary":
      verifyArithExpansions(source, e.left);
      verifyArithExpansions(source, e.right);
      break;
    case "ArithmeticUnary":
      verifyArithExpansions(source, e.operand);
      break;
    case "ArithmeticTernary":
      verifyArithExpansions(source, e.test);
      verifyArithExpansions(source, e.consequent);
      verifyArithExpansions(source, e.alternate);
      break;
    case "ArithmeticGroup":
      verifyArithExpansions(source, e.expression);
      break;
  }
}
