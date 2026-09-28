import assert from "node:assert/strict";
import type { Assignment, Command, CommandArgument, SyntaxNode, Redirection, Word } from "../src/types.ts";

function hasType<T extends SyntaxNode["type"]>(
  node: SyntaxNode | null | undefined,
  types: readonly T[],
): node is Extract<SyntaxNode, { type: T }> {
  return types.some((type) => node?.type === type);
}

export function nodeOfType<T extends SyntaxNode["type"]>(
  node: SyntaxNode | null | undefined,
  ...types: T[]
): Extract<SyntaxNode, { type: T }> {
  assert.ok(hasType(node, types), `expected ${types.join(" or ")}, got ${node?.type}`);
  return node;
}

export function redirectsOf(node: SyntaxNode): readonly Redirection[] {
  switch (node.type) {
    case "Command":
    case "Redirected":
      return node.redirects;
    case "Statement":
      return redirectsOf(node.command);
    case "Function":
    case "Coproc":
      return redirectsOf(node.body);
    default:
      return [];
  }
}

export function argumentsOf(command: Command): readonly CommandArgument[] {
  return command.args;
}

export function arrayElements(assignment: Assignment): readonly Word[] | undefined {
  return assignment.value.type === "ArrayValue" ? assignment.value.elements : undefined;
}
