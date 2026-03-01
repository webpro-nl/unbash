// Round-trip AST verifier: verify(src, parse(src)) === src
// Walks AST, fills gaps from source, validates content fields against source.
// Also verifies word parts: parts.map(p => p.text).join('') === source span.

import type { Node, Script, WordPart, DoubleQuotedChild } from "../src/types.ts";
import { computeWordParts } from "../src/parts.ts";

type AnyNode = { type: string; pos: number; end: number; [k: string]: any };

const CHILDREN: Record<string, string[]> = {
  Script: ["commands"],
  Statement: ["command", "redirects"],
  Command: ["prefix", "name", "suffix", "redirects"],
  Pipeline: ["commands"],
  AndOr: ["commands"],
  If: ["clause", "then", "else"],
  For: ["name", "wordlist", "body"],
  ArithmeticFor: ["body"],
  ArithmeticCommand: ["expression"],
  While: ["clause", "body"],
  Case: ["word", "items"],
  CaseItem: ["pattern", "body"],
  Select: ["name", "wordlist", "body"],
  Function: ["name", "body", "redirects"],
  Subshell: ["body"],
  BraceGroup: ["body"],
  CompoundList: ["commands"],
  Coproc: ["name", "body", "redirects"],
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
    case "Assignment":
      // .text is de-quoted, so only check .name (always unquoted)
      if (node.name && !span.startsWith(node.name)) fail(node, "name", span.slice(0, node.name.length), node.name);
      break;
    case "ArithmeticWord":
      if (node.value !== span) fail(node, "value", span, node.value);
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

export function verify(source: string, node: Node | Script): string {
  return _verify(source, node);
}

function _verify(source: string, node: AnyNode): string {
  checkContent(source, node);
  const children = getChildren(node);
  if (children.length === 0) {
    if (typeof node.text === "string" && !node.type) {
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
  const parts = computeWordParts(source, word as any);
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

function verifyPartChildren(source: string, part: WordPart | DoubleQuotedChild) {
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
    const prefix = part.type === "ProcessSubstitution" ? 2 : part.text.startsWith("$(") ? 2 : 1;
    const suffix = part.text.startsWith("`") ? 1 : 1;
    const innerSrc = part.text.slice(prefix, -suffix);
    const rebuilt = _verify(innerSrc, part.script as any);
    if (rebuilt !== innerSrc) {
      throw new Error(
        `${part.type} inner script verify failed: expected ${JSON.stringify(innerSrc)}, got ${JSON.stringify(rebuilt)}`,
      );
    }
  }
}
