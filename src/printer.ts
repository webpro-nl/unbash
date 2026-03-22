import type {
  AndOr,
  ArithmeticCommand,
  ArithmeticExpression,
  ArithmeticFor,
  AssignmentPrefix,
  BraceGroup,
  Case,
  Command,
  CompoundList,
  Coproc,
  For,
  Function,
  If,
  Node,
  Pipeline,
  Redirect,
  Script,
  Select,
  Statement,
  Subshell,
  TestCommand,
  TestExpression,
  While,
  Word,
} from "./types.ts";

export function print(script: Script): string {
  let out = "";
  if (script.shebang) out += script.shebang + "\n\n";
  out += stmts(script.commands, 0);
  return out;
}

function isFunc(s: Statement): boolean {
  return s.command.type === "Function";
}

function stmts(list: Statement[], indent: number): string {
  let out = "";
  for (let i = 0; i < list.length; i++) {
    if (i > 0) out += isFunc(list[i - 1]) || isFunc(list[i]) ? "\n\n" : "\n";
    out += stmt(list[i], indent);
  }
  return out;
}

function stmt(s: Statement, indent: number): string {
  const pad = "  ".repeat(indent);
  let out = pad + printNode(s.command, indent);
  for (const r of s.redirects) out += " " + redir(r);
  if (s.background) out += " &";
  out += heredocBodies(s);
  return out;
}

function heredocBodies(s: Statement): string {
  let out = "";
  if (s.command.type === "Command") {
    for (const r of s.command.redirects) out += heredocBody(r);
  }
  for (const r of s.redirects) out += heredocBody(r);
  return out;
}

function heredocBody(r: Redirect): string {
  if (r.operator !== "<<" && r.operator !== "<<-") return "";
  if (r.content == null) return "";
  return "\n" + r.content + delimName(r);
}

function delimName(r: Redirect): string {
  if (!r.target) return "";
  const text = wd(r.target);
  if ((text[0] === "'" && text[text.length - 1] === "'") || (text[0] === '"' && text[text.length - 1] === '"')) {
    return text.slice(1, -1);
  }
  if (text.includes("\\")) return text.replaceAll("\\", "");
  return text;
}

function printNode(n: Node, indent: number): string {
  switch (n.type) {
    case "Command":
      return cmd(n);
    case "Pipeline":
      return pipe(n, indent);
    case "AndOr":
      return andOr(n, indent);
    case "If":
      return ifNode(n, indent, false);
    case "For":
      return forNode(n, indent);
    case "While":
      return whileNode(n, indent);
    case "Case":
      return caseNode(n, indent);
    case "Function":
      return funcNode(n, indent);
    case "Subshell":
      return subshell(n, indent);
    case "BraceGroup":
      return braceGroup(n, indent);
    case "CompoundList":
      return stmts(n.commands, indent);
    case "TestCommand":
      return testCmd(n);
    case "ArithmeticCommand":
      return arithCmd(n);
    case "Select":
      return selectNode(n, indent);
    case "ArithmeticFor":
      return arithFor(n, indent);
    case "Coproc":
      return coprocNode(n, indent);
    case "Statement": {
      let out = printNode(n.command, indent);
      for (const r of n.redirects) out += " " + redir(r);
      if (n.background) out += " &";
      return out;
    }
  }
}

function wd(w: Word): string {
  if (!w.parts) return w.text;
  let out = "";
  for (const p of w.parts) out += p.text;
  return out;
}

function assign(a: AssignmentPrefix): string {
  let out = a.name ?? "";
  if (a.index != null) out += "[" + a.index + "]";
  out += a.append ? "+=" : "=";
  if (a.array) {
    out += "(" + a.array.map((w) => wd(w)).join(" ") + ")";
  } else if (a.value) {
    out += wd(a.value);
  }
  return out;
}

function cmd(c: Command): string {
  const parts: string[] = [];
  for (const a of c.prefix) parts.push(assign(a));
  if (c.name) parts.push(wd(c.name));
  for (const s of c.suffix) parts.push(wd(s));
  for (const r of c.redirects) parts.push(redir(r));
  return parts.join(" ");
}

function pipe(p: Pipeline, indent: number): string {
  let out = "";
  if (p.time) out += "time ";
  if (p.negated) out += "! ";
  for (let i = 0; i < p.commands.length; i++) {
    if (i > 0) out += " " + p.operators[i - 1] + " ";
    out += printNode(p.commands[i], indent);
  }
  return out;
}

function andOr(a: AndOr, indent: number): string {
  let out = "";
  for (let i = 0; i < a.commands.length; i++) {
    if (i > 0) out += " " + a.operators[i - 1] + " ";
    out += printNode(a.commands[i], indent);
  }
  return out;
}

function ifNode(n: If, indent: number, isElif: boolean): string {
  const pad = "  ".repeat(indent);
  const kw = isElif ? "elif" : "if";
  let out = kw + " " + inlineList(n.clause) + "; then\n";
  out += stmts(n.then.commands, indent + 1);
  if (n.else) {
    out += "\n";
    if (n.else.type === "If") {
      out += pad + ifNode(n.else, indent, true);
    } else {
      out += pad + "else\n";
      out += stmts(n.else.commands, indent + 1) + "\n";
      out += pad + "fi";
    }
  } else {
    out += "\n" + pad + "fi";
  }
  return out;
}

function forNode(n: For, indent: number): string {
  const pad = "  ".repeat(indent);
  let out = "for " + wd(n.name);
  if (n.wordlist.length > 0) {
    out += " in";
    for (const w of n.wordlist) out += " " + wd(w);
  }
  out += "; do\n";
  out += stmts(n.body.commands, indent + 1) + "\n";
  out += pad + "done";
  return out;
}

function whileNode(n: While, indent: number): string {
  const pad = "  ".repeat(indent);
  let out = n.kind + " " + inlineList(n.clause) + "; do\n";
  out += stmts(n.body.commands, indent + 1) + "\n";
  out += pad + "done";
  return out;
}

function caseNode(n: Case, indent: number): string {
  const pad = "  ".repeat(indent);
  const iPad = "  ".repeat(indent + 1);
  const bPad = "  ".repeat(indent + 2);
  let out = "case " + wd(n.word) + " in\n";
  for (const item of n.items) {
    out += iPad + item.pattern.map((p) => wd(p)).join(" | ") + ")\n";
    if (item.body.commands.length > 0) {
      out += stmts(item.body.commands, indent + 2) + "\n";
    }
    out += bPad + (item.terminator ?? ";;") + "\n";
  }
  out += pad + "esac";
  return out;
}

function funcNode(n: Function, indent: number): string {
  const pad = "  ".repeat(indent);
  let out = wd(n.name) + "() {\n";
  if (n.body.type === "BraceGroup") {
    out += stmts(n.body.body.commands, indent + 1) + "\n";
  } else if (n.body.type === "CompoundList") {
    out += stmts(n.body.commands, indent + 1) + "\n";
  } else {
    out += "  ".repeat(indent + 1) + printNode(n.body, indent + 1) + "\n";
  }
  out += pad + "}";
  for (const r of n.redirects) out += " " + redir(r);
  return out;
}

function subshell(n: Subshell, indent: number): string {
  const pad = "  ".repeat(indent);
  if (n.body.commands.length <= 1) {
    return "(" + inlineList(n.body) + ")";
  }
  let out = "(\n";
  out += stmts(n.body.commands, indent + 1) + "\n";
  out += pad + ")";
  return out;
}

function braceGroup(n: BraceGroup, indent: number): string {
  const pad = "  ".repeat(indent);
  let out = "{\n";
  out += stmts(n.body.commands, indent + 1) + "\n";
  out += pad + "}";
  return out;
}

function testCmd(n: TestCommand): string {
  return "[[ " + testExpr(n.expression) + " ]]";
}

function testExpr(e: TestExpression): string {
  switch (e.type) {
    case "TestUnary":
      return e.operator + " " + wd(e.operand);
    case "TestBinary":
      return wd(e.left) + " " + e.operator + " " + wd(e.right);
    case "TestLogical":
      return testExpr(e.left) + " " + e.operator + " " + testExpr(e.right);
    case "TestNot":
      return "! " + testExpr(e.operand);
    case "TestGroup":
      return "( " + testExpr(e.expression) + " )";
  }
}

function arithCmd(n: ArithmeticCommand): string {
  if (n.expression) return "(( " + arithExpr(n.expression) + " ))";
  return "((" + n.body + "))";
}

function arithFor(n: ArithmeticFor, indent: number): string {
  const pad = "  ".repeat(indent);
  const init = n.initialize ? arithExpr(n.initialize) : "";
  const test = n.test ? arithExpr(n.test) : "";
  const update = n.update ? arithExpr(n.update) : "";
  let out = "for (( " + init + "; " + test + "; " + update + " )); do\n";
  out += stmts(n.body.commands, indent + 1) + "\n";
  out += pad + "done";
  return out;
}

function coprocNode(n: Coproc, indent: number): string {
  let out = "coproc";
  if (n.name) out += " " + wd(n.name);
  out += " " + printNode(n.body, indent);
  for (const r of n.redirects) out += " " + redir(r);
  return out;
}

function arithExpr(e: ArithmeticExpression): string {
  switch (e.type) {
    case "ArithmeticWord":
      return e.value;
    case "ArithmeticGroup":
      return "(" + arithExpr(e.expression) + ")";
    case "ArithmeticUnary":
      return e.prefix ? e.operator + arithExpr(e.operand) : arithExpr(e.operand) + e.operator;
    case "ArithmeticTernary":
      return arithExpr(e.test) + " ? " + arithExpr(e.consequent) + " : " + arithExpr(e.alternate);
    case "ArithmeticBinary": {
      const prec = arithPrec(e.operator);
      const ra = arithRightAssoc(e.operator);
      let left = arithExpr(e.left);
      let right = arithExpr(e.right);
      if (arithNeedsParens(e.left, prec, ra ? false : true)) left = "(" + left + ")";
      if (arithNeedsParens(e.right, prec, ra ? true : false)) right = "(" + right + ")";
      return left + " " + e.operator + " " + right;
    }
    case "ArithmeticCommandExpansion":
      return e.text; // preserve original text for roundtrip
  }
}

function arithPrec(op: string): number {
  switch (op) {
    case ",":
      return 1;
    case "=":
    case "+=":
    case "-=":
    case "*=":
    case "/=":
    case "%=":
    case "<<=":
    case ">>=":
    case "&=":
    case "|=":
    case "^=":
      return 2;
    case "||":
      return 4;
    case "&&":
      return 5;
    case "|":
      return 6;
    case "^":
      return 7;
    case "&":
      return 8;
    case "==":
    case "!=":
      return 9;
    case "<":
    case "<=":
    case ">":
    case ">=":
      return 10;
    case "<<":
    case ">>":
      return 11;
    case "+":
    case "-":
      return 12;
    case "*":
    case "/":
    case "%":
      return 13;
    case "**":
      return 14;
    default:
      return 0;
  }
}

function arithRightAssoc(op: string): boolean {
  switch (op) {
    case "=":
    case "+=":
    case "-=":
    case "*=":
    case "/=":
    case "%=":
    case "<<=":
    case ">>=":
    case "&=":
    case "|=":
    case "^=":
    case "**":
      return true;
    default:
      return false;
  }
}

function arithNeedsParens(child: ArithmeticExpression, parentPrec: number, isSafe: boolean): boolean {
  if (child.type === "ArithmeticBinary") {
    const cp = arithPrec(child.operator);
    return cp < parentPrec || (cp === parentPrec && !isSafe);
  }
  if (child.type === "ArithmeticTernary") return 3 < parentPrec;
  return false;
}

function selectNode(n: Select, indent: number): string {
  const pad = "  ".repeat(indent);
  let out = "select " + wd(n.name);
  if (n.wordlist.length > 0) {
    out += " in";
    for (const w of n.wordlist) out += " " + wd(w);
  }
  out += "; do\n";
  out += stmts(n.body.commands, indent + 1) + "\n";
  out += pad + "done";
  return out;
}

function redir(r: Redirect): string {
  let out = "";
  if (r.fileDescriptor != null) out += r.fileDescriptor;
  if (r.variableName) out += "{" + r.variableName + "}";
  out += r.operator;
  if (r.target) {
    if (r.operator !== "<&" && r.operator !== ">&") out += " ";
    out += wd(r.target);
  }
  return out;
}

function inlineList(cl: CompoundList): string {
  let out = "";
  for (let i = 0; i < cl.commands.length; i++) {
    if (i > 0) out += "; ";
    out += inlineStmt(cl.commands[i]);
  }
  return out;
}

function inlineStmt(s: Statement): string {
  let out = printNode(s.command, 0);
  for (const r of s.redirects) out += " " + redir(r);
  if (s.background) out += " &";
  return out;
}
