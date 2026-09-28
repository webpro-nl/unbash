import { parse } from "../src/parser.ts";
import type { Assignment, CompoundList, Redirection, Statement, Word } from "../src/types.ts";
import { bench, group, run, summary } from "mitata";
import { short, advanced, specialized, installers, large } from "./fixtures.ts";

type ListNode = Statement | Statement["command"] | CompoundList;

function visitWords(node: ListNode): number {
  let count = 0;
  switch (node.type) {
    case "Command":
      if (node.name) count += touchWord(node.name);
      for (const argument of node.suffix) {
        if (argument.type === "Word") count += touchWord(argument);
        else if (argument.type === "Assignment") count += touchAssignment(argument);
        else count += visitRedirect(argument);
      }
      for (const item of node.prefix) count += item.type === "Assignment" ? touchAssignment(item) : visitRedirect(item);
      break;
    case "Redirected":
      count += visitWords(node.command);
      for (const redirect of node.redirects) count += visitRedirect(redirect);
      break;
    case "Time":
    case "Negation":
      if (node.command) count += visitWords(node.command);
      break;
    case "Pipeline":
      for (const c of node.commands) count += visitWords(c);
      break;
    case "AndOr":
      for (const c of node.commands) count += visitWords(c);
      break;
    case "If":
      count += visitCompoundList(node.clause);
      count += visitCompoundList(node.then);
      if (node.else) {
        if (node.else.type === "If") count += visitWords(node.else);
        else count += visitCompoundList(node.else);
      }
      break;
    case "For":
      count += touchWord(node.name);
      for (const w of node.wordlist ?? []) count += touchWord(w);
      count += visitCompoundList(node.body);
      break;
    case "While":
      count += visitCompoundList(node.clause);
      count += visitCompoundList(node.body);
      break;
    case "Case":
      count += touchWord(node.word);
      for (const item of node.items) {
        for (const w of item.pattern) count += touchWord(w);
        count += visitCompoundList(item.body);
      }
      break;
    case "Function":
      count += touchWord(node.name);
      count += visitNode(node.body);
      break;
    case "Select":
      count += touchWord(node.name);
      for (const w of node.wordlist ?? []) count += touchWord(w);
      count += visitCompoundList(node.body);
      break;
    case "Subshell":
    case "BraceGroup":
      count += visitCompoundList(node.body);
      break;
    case "CompoundList":
      count += visitCompoundList(node);
      break;
    case "Statement":
      count += visitWords(node.command);
      break;
    case "Coproc":
      if (node.name) count += touchWord(node.name);
      count += visitNode(node.body);
      break;
    case "TestCommand":
      count += visitTestExpr(node.expression);
      break;
    case "ArithmeticCommand":
    case "ArithmeticFor":
      break;
  }
  return count;
}

function visitNode(node: ListNode): number {
  return visitWords(node);
}

function visitCompoundList(cl: CompoundList): number {
  let count = 0;
  for (const s of cl.commands) count += visitWords(s);
  return count;
}

function visitRedirect(r: Redirection): number {
  if (r.type === "HereDoc") {
    void r.body.parts;
    return 1;
  }
  return r.target ? touchWord(r.target) : 0;
}

function visitTestExpr(expr: import("../src/types.ts").TestExpression): number {
  let count = 0;
  switch (expr.type) {
    case "TestUnary":
      count += touchWord(expr.operand);
      break;
    case "TestBinary":
      count += touchWord(expr.left);
      count += touchWord(expr.right);
      break;
    case "TestLogical":
      count += visitTestExpr(expr.left);
      count += visitTestExpr(expr.right);
      break;
    case "TestNot":
      count += visitTestExpr(expr.operand);
      break;
    case "TestGroup":
      count += visitTestExpr(expr.expression);
      break;
  }
  return count;
}

function touchWord(w: Word): number {
  void w.parts; // trigger lazy computation
  return 1;
}

function touchAssignment(assignment: Assignment): number {
  let count = assignment.index ? touchWord(assignment.index) : 0;
  const value = assignment.value;
  if (value.type === "Word") count += touchWord(value);
  else for (const word of value.elements) count += touchWord(word);
  return count;
}

for (const [label, scripts] of [
  ["short", short],
  ["advanced", advanced],
  ...specialized,
  ["medium", installers],
  ["large", large],
] as const) {
  group(label, () => {
    summary(() => {
      bench("parse only", () => {
        for (const s of scripts) parse(s);
      }).baseline();

      bench("parse + parts", () => {
        for (const s of scripts) {
          const ast = parse(s);
          for (const stmt of ast.commands) visitWords(stmt);
        }
      });
    });
  });
}

await run();
