import assert from "node:assert/strict";
import test from "node:test";
import { forEachChild, parse } from "../src/parser.ts";
import { print } from "../src/printer.ts";
import type { SyntaxNode } from "../src/types.ts";
import { nodeOfType } from "./ast-helpers.ts";

function collect(source: string, root: SyntaxNode): SyntaxNode[] {
  const nodes: SyntaxNode[] = [];
  function visit(node: SyntaxNode): void {
    nodes.push(node);
    if ("text" in node) assert.equal(source.slice(node.pos, node.end), node.text);
    forEachChild(node, visit);
  }
  visit(root);
  return nodes;
}

for (const operator of ["&>", "&>>"] as const) {
  for (const target of ["<(cat input)", ">(tee -a log)"]) {
    test(`${operator} keeps ${target} as a structured redirect target`, () => {
      for (const separator of [" ", "\t", " \\\n"]) {
        const source = `cmd before ${operator}${separator}${target} after 2>errors; next`;
        const ast = parse(source);
        assert.equal(ast.errors, undefined);
        assert.equal(ast.commands.length, 2);
        assert.equal(ast.commands[0].background, undefined);
        const command = nodeOfType(ast.commands[0].command, "Command");
        assert.deepEqual(
          command.args.map((word) => word.text),
          ["before", "after"],
        );
        assert.equal(command.redirects.length, 2);
        const redirect = nodeOfType(command.redirects[0], "Redirect");
        assert.equal(redirect.operator, operator);
        assert.equal(redirect.descriptor, undefined);
        assert.equal(redirect.pos, source.indexOf(operator));
        assert.equal(redirect.end, source.indexOf(target) + target.length);
        assert.equal(redirect.target?.text, target);
        assert.equal(redirect.target?.value, target);
        assert.equal(redirect.target?.pos, source.indexOf(target));
        assert.equal(redirect.target?.end, redirect.end);
        const substitution = nodeOfType(redirect.target?.parts?.[0], "ProcessSubstitution");
        assert.equal(redirect.target?.parts?.length, 1);
        assert.equal(substitution.operator, target[0]);
        assert.equal(substitution.text, target);
        assert.equal(substitution.script?.errors, undefined);
        const inner = nodeOfType(substitution.script?.commands[0].command, "Command");
        assert.equal(inner.name?.text, target[0] === "<" ? "cat" : "tee");
        assert.deepEqual(
          inner.args.map((word) => word.text),
          target[0] === "<" ? ["input"] : ["-a", "log"],
        );
        assert.equal(nodeOfType(command.redirects[1], "Redirect").target?.text, "errors");
        assert.equal(nodeOfType(ast.commands[1].command, "Command").name?.text, "next");
        const nodes = collect(source, ast);
        assert.deepEqual(
          nodes.flatMap((node) => (node.type === "Command" ? [node.name?.text] : [])),
          ["cmd", inner.name?.text, "next"],
        );
        const printed = `cmd before ${operator} ${target} after 2> errors\nnext`;
        assert.equal(print(ast), printed);
        assert.equal(print(JSON.parse(JSON.stringify(ast))), printed);
        const reparsed = parse(printed);
        assert.equal(reparsed.errors, undefined);
        assert.equal(print(reparsed), printed);
        const reparsedCommand = nodeOfType(reparsed.commands[0].command, "Command");
        assert.deepEqual(
          reparsedCommand.args.map((word) => word.text),
          ["before", "after"],
        );
        assert.equal(nodeOfType(reparsedCommand.redirects[0], "Redirect").target?.text, target);
      }
    });
  }

  test(`${operator} reports one unterminated process substitution at the target offset`, () => {
    for (const target of ["<(cat input", ">(tee log"]) {
      const source = `cmd ${operator} ${target}`;
      const ast = parse(source);
      const expected = [{ message: "unterminated process substitution", pos: source.indexOf(target) }];
      assert.deepEqual(ast.errors, expected);
      const command = nodeOfType(ast.commands[0].command, "Command");
      assert.equal(command.args.length, 0);
      const redirect = nodeOfType(command.redirects[0], "Redirect");
      assert.equal(redirect.target?.text, target);
      assert.equal(redirect.end, source.length);
      const substitution = nodeOfType(redirect.target?.parts?.[0], "ProcessSubstitution");
      assert.equal(
        nodeOfType(substitution.script?.commands[0].command, "Command").name?.text,
        target[0] === "<" ? "cat" : "tee",
      );
      collect(source, ast);
      assert.deepEqual(ast.errors, expected);
    }
  });

  test(`${operator} preserves lazy errors inside the target and the following command`, () => {
    const source = `cmd ${operator} >(echo >); next`;
    const ast = parse(source);
    assert.equal(ast.errors, undefined);
    const command = nodeOfType(ast.commands[0].command, "Command");
    const redirect = nodeOfType(command.redirects[0], "Redirect");
    const substitution = nodeOfType(redirect.target?.parts?.[0], "ProcessSubstitution");
    assert.deepEqual(substitution.script?.errors, [{ message: "expected redirect target", pos: source.indexOf(")") }]);
    assert.equal(ast.errors, undefined);
    assert.equal(nodeOfType(ast.commands[1].command, "Command").name?.text, "next");
  });
}

for (const [source, operator, target, names] of [
  ["cmd &><(cat input)", "&>", "<(cat input)", ["cmd", "cat"]],
  ["cmd &>><(cat input)", "&>>", "<(cat input)", ["cmd", "cat"]],
  ["cmd &>>>(tee log)", "&>>", ">(tee log)", ["cmd", "tee"]],
  ["&> >(tee log) cmd arg", "&>", ">(tee log)", ["cmd", "tee"]],
  ["{ cmd arg; } &>> >(tee log)", "&>>", ">(tee log)", ["cmd", "tee"]],
  ['echo $(cmd &> >(tee "$(date)") arg); next', "&>", '>(tee "$(date)")', ["echo", "cmd", "tee", "date", "next"]],
  ["cmd &>> >(tee log) | next", "&>>", ">(tee log)", ["cmd", "tee", "next"]],
] as const) {
  test(`combined process redirect boundaries and consumers: ${source}`, () => {
    const ast = parse(source);
    assert.equal(ast.errors, undefined);
    const nodes = collect(source, ast);
    assert.deepEqual(
      nodes.flatMap((node) => (node.type === "Command" ? [node.name?.text] : [])),
      names,
    );
    const redirect = nodeOfType(
      nodes.find((node) => node.type === "Redirect"),
      "Redirect",
    );
    assert.equal(redirect.operator, operator);
    assert.equal(redirect.target?.text, target);
    assert.equal(redirect.target?.pos, source.indexOf(target));
    assert.equal(redirect.target?.end, source.indexOf(target) + target.length);
    const printed = print(ast);
    const reparsed = parse(printed);
    assert.equal(reparsed.errors, undefined);
    assert.deepEqual(
      collect(printed, reparsed).flatMap((node) => (node.type === "Command" ? [node.name?.text] : [])),
      names,
    );
    assert.equal(print(reparsed), printed);
  });
}
