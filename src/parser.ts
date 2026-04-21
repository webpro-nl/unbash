// oxlint-disable unicorn/no-thenable
export type * from "./types.ts";

import type {
  ArithmeticCommand,
  ArithmeticExpression,
  ArithmeticFor,
  AssignmentPrefix,
  BraceGroup,
  Case,
  CaseItem,
  CaseTerminator,
  Command,
  CompoundList,
  Coproc,
  For,
  Function,
  If,
  AndOr,
  LogicalOperator,
  Node,
  ParseError,
  PipeOperator,
  Pipeline,
  Redirect,
  RedirectOperator,
  Script,
  Select,
  Statement,
  Subshell,
  TestBinaryExpression,
  TestCommand,
  TestExpression,
  TestGroupExpression,
  TestLogicalExpression,
  TestNotExpression,
  TestUnaryExpression,
  While,
  Word,
} from "./types.ts";
import { LexContext, Token, Lexer, TokenValue } from "./lexer.ts";
import { parseArithmeticExpression } from "./arithmetic.ts";
import { computeWordParts, computeHereDocBodyParts } from "./parts.ts";
import { WordImpl } from "./word.ts";

WordImpl._resolveWord = computeWordParts;
WordImpl._resolveHeredocBody = computeHereDocBodyParts;

class ArithmeticCommandImpl implements ArithmeticCommand {
  type = "ArithmeticCommand" as const;
  pos: number;
  end: number;
  body: string;
  #expression: ArithmeticExpression | undefined | null = null;

  constructor(pos: number, end: number, body: string) {
    this.pos = pos;
    this.end = end;
    this.body = body;
  }

  get expression(): ArithmeticExpression | undefined {
    if (this.#expression === null) {
      this.#expression = parseArithmeticExpression(this.body, this.pos + 2) ?? undefined;
      if (this.#expression) resolveArithmeticExpansions(this.#expression);
    }
    return this.#expression;
  }
  set expression(v: ArithmeticExpression | undefined) {
    this.#expression = v ?? undefined;
  }
}

class ArithmeticForImpl implements ArithmeticFor {
  type = "ArithmeticFor" as const;
  pos: number;
  end: number;
  body: CompoundList;
  #initStr: string;
  #testStr: string;
  #updateStr: string;
  #initPos: number;
  #testPos: number;
  #updatePos: number;
  #initialize: ArithmeticExpression | undefined | null = null;
  #test: ArithmeticExpression | undefined | null = null;
  #update: ArithmeticExpression | undefined | null = null;

  constructor(
    pos: number,
    end: number,
    body: CompoundList,
    initStr: string,
    testStr: string,
    updateStr: string,
    initPos: number,
    testPos: number,
    updatePos: number,
  ) {
    this.pos = pos;
    this.end = end;
    this.body = body;
    this.#initStr = initStr;
    this.#testStr = testStr;
    this.#updateStr = updateStr;
    this.#initPos = initPos;
    this.#testPos = testPos;
    this.#updatePos = updatePos;
  }

  get initialize(): ArithmeticExpression | undefined {
    if (this.#initialize === null) {
      if (this.#initStr) {
        const expr = parseArithmeticExpression(this.#initStr);
        if (expr) {
          offsetArith(expr, this.#initPos);
          resolveArithmeticExpansions(expr);
        }
        this.#initialize = expr ?? undefined;
      } else {
        this.#initialize = undefined;
      }
    }
    return this.#initialize;
  }
  set initialize(v: ArithmeticExpression | undefined) {
    this.#initialize = v ?? undefined;
  }

  get test(): ArithmeticExpression | undefined {
    if (this.#test === null) {
      if (this.#testStr) {
        const expr = parseArithmeticExpression(this.#testStr);
        if (expr) {
          offsetArith(expr, this.#testPos);
          resolveArithmeticExpansions(expr);
        }
        this.#test = expr ?? undefined;
      } else {
        this.#test = undefined;
      }
    }
    return this.#test;
  }
  set test(v: ArithmeticExpression | undefined) {
    this.#test = v ?? undefined;
  }

  get update(): ArithmeticExpression | undefined {
    if (this.#update === null) {
      if (this.#updateStr) {
        const expr = parseArithmeticExpression(this.#updateStr);
        if (expr) {
          offsetArith(expr, this.#updatePos);
          resolveArithmeticExpansions(expr);
        }
        this.#update = expr ?? undefined;
      } else {
        this.#update = undefined;
      }
    }
    return this.#update;
  }
  set update(v: ArithmeticExpression | undefined) {
    this.#update = v ?? undefined;
  }
}

const CASE_TERMINATORS: Record<number, CaseTerminator> = {
  [Token.DoubleSemi]: ";;",
  [Token.SemiAmp]: ";&",
  [Token.DoubleSemiAmp]: ";;&",
};

const REDIRECT_OPS: Record<string, RedirectOperator> = {
  ">": ">",
  ">>": ">>",
  "<": "<",
  "<<": "<<",
  "<<-": "<<-",
  "<<<": "<<<",
  "<>": "<>",
  "<&": "<&",
  ">&": ">&",
  ">|": ">|",
  "&>": "&>",
  "&>>": "&>>",
};

function offsetArith(node: ArithmeticExpression, base: number): void {
  node.pos += base;
  node.end += base;
  switch (node.type) {
    case "ArithmeticBinary":
      offsetArith(node.left, base);
      offsetArith(node.right, base);
      break;
    case "ArithmeticUnary":
      offsetArith(node.operand, base);
      break;
    case "ArithmeticTernary":
      offsetArith(node.test, base);
      offsetArith(node.consequent, base);
      offsetArith(node.alternate, base);
      break;
    case "ArithmeticGroup":
      offsetArith(node.expression, base);
      break;
  }
}

export function resolveArithmeticExpansions(expr: ArithmeticExpression): void {
  switch (expr.type) {
    case "ArithmeticBinary":
      resolveArithmeticExpansions(expr.left);
      resolveArithmeticExpansions(expr.right);
      break;
    case "ArithmeticUnary":
      resolveArithmeticExpansions(expr.operand);
      break;
    case "ArithmeticTernary":
      resolveArithmeticExpansions(expr.test);
      resolveArithmeticExpansions(expr.consequent);
      resolveArithmeticExpansions(expr.alternate);
      break;
    case "ArithmeticGroup":
      resolveArithmeticExpansions(expr.expression);
      break;
    case "ArithmeticCommandExpansion":
      if (expr.inner !== undefined) {
        expr.script = parse(expr.inner);
        expr.inner = undefined;
      }
      break;
  }
}

// Lookup tables for O(1) token classification (replaces sequential comparisons)
const listTerminators = new Uint8Array(37);
listTerminators[Token.EOF] = 1;
listTerminators[Token.RParen] = 1;
listTerminators[Token.RBrace] = 1;
listTerminators[Token.Then] = 1;
listTerminators[Token.Else] = 1;
listTerminators[Token.Elif] = 1;
listTerminators[Token.Fi] = 1;
listTerminators[Token.Do] = 1;
listTerminators[Token.Done] = 1;
listTerminators[Token.Esac] = 1;
listTerminators[Token.DoubleSemi] = 1;
listTerminators[Token.SemiAmp] = 1;
listTerminators[Token.DoubleSemiAmp] = 1;

const commandStarts = new Uint8Array(37);
commandStarts[Token.Word] = 1;
commandStarts[Token.Assignment] = 1;
commandStarts[Token.Bang] = 1;
commandStarts[Token.LParen] = 1;
commandStarts[Token.LBrace] = 1;
commandStarts[Token.DblLBracket] = 1;
commandStarts[Token.If] = 1;
commandStarts[Token.For] = 1;
commandStarts[Token.While] = 1;
commandStarts[Token.Until] = 1;
commandStarts[Token.Case] = 1;
commandStarts[Token.Function] = 1;
commandStarts[Token.Select] = 1;
commandStarts[Token.ArithCmd] = 1;
commandStarts[Token.Coproc] = 1;
commandStarts[Token.Redirect] = 1;

const UNARY_TEST_OPS: Record<string, 1> = {
  "-a": 1,
  "-b": 1,
  "-c": 1,
  "-d": 1,
  "-e": 1,
  "-f": 1,
  "-g": 1,
  "-h": 1,
  "-k": 1,
  "-p": 1,
  "-r": 1,
  "-s": 1,
  "-t": 1,
  "-u": 1,
  "-v": 1,
  "-w": 1,
  "-x": 1,
  "-z": 1,
  "-n": 1,
  "-N": 1,
  "-S": 1,
  "-L": 1,
  "-G": 1,
  "-O": 1,
  "-R": 1,
};

const BINARY_TEST_OPS: Record<string, 1> = {
  "==": 1,
  "!=": 1,
  "=~": 1,
  "=": 1,
  "-eq": 1,
  "-ne": 1,
  "-lt": 1,
  "-le": 1,
  "-gt": 1,
  "-ge": 1,
  "-nt": 1,
  "-ot": 1,
  "-ef": 1,
  "<": 1,
  ">": 1,
};

const EMPTY_PREFIX: AssignmentPrefix[] = [];
const EMPTY_SUFFIX: Word[] = [];
const EMPTY_REDIRECTS: Redirect[] = [];

export function parse(source: string): Script & { errors?: ParseError[] } {
  const parser = new Parser(source);
  return parser.parse(source.length);
}

class Parser {
  private tok: Lexer;
  private source: string;
  private errors: ParseError[] = [];
  private _redirects: Redirect[] = [];

  constructor(source: string) {
    this.tok = new Lexer(source);
    this.source = source;
  }

  parse(sourceLen: number): Script & { errors?: ParseError[] } {
    let shebang: string | undefined;
    if (this.source.charCodeAt(0) === 35 && this.source.charCodeAt(1) === 33) {
      const nl = this.source.indexOf("\n");
      shebang = nl === -1 ? this.source : this.source.slice(0, nl);
    }
    const commands = this.list();
    const lexerErrors = this.tok._errors;
    if (lexerErrors !== null) {
      for (let i = 0; i < lexerErrors.length; i++) this.errors.push(lexerErrors[i]);
    }
    const result: Script & { errors?: ParseError[] } = {
      type: "Script",
      pos: 0,
      end: sourceLen,
      shebang,
      commands,
      errors: this.errors.length > 0 ? this.errors : undefined,
    };
    return result;
  }

  private error(message: string, pos: number): void {
    this.errors.push({ message, pos });
  }

  private skipSemi(): void {
    if (this.tok.peek(LexContext.Normal).token === Token.Semi) this.tok.next(LexContext.Normal);
  }

  private accept(token: Token, ctx: LexContext = LexContext.Normal) {
    if (this.tok.peek(ctx).token === token) return this.tok.next(ctx);
    return null;
  }

  private acceptEnd(token: Token, ctx: LexContext = LexContext.Normal): number {
    if (this.tok.peek(ctx).token === token) return this.tok.next(ctx).end;
    return -1;
  }

  private skipNewlines(ctx: LexContext = LexContext.Normal): void {
    while (this.tok.peek(ctx).token === Token.Newline) this.tok.next(ctx);
  }

  private makeStatement(command: Node, redirects: Redirect[]): Statement {
    const end = redirects.length > 0 ? redirects[redirects.length - 1].end : command.end;
    return {
      type: "Statement",
      pos: command.pos,
      end,
      command,
      background: undefined,
      redirects,
    };
  }

  // list := and_or ((';' | '&' | NEWLINE) and_or)* [';' | '&' | NEWLINE]
  private list(): Statement[] {
    const commands: Statement[] = [];
    this.skipNewlines(LexContext.CommandStart);

    let t = this.tok.peek(LexContext.CommandStart).token;
    if (listTerminators[t] || !commandStarts[t]) return commands;

    const first = this.andOr();
    if (first) {
      const redirects = this._redirects;
      this._redirects = [];
      commands.push(this.makeStatement(first, redirects));
    }

    for (;;) {
      t = this.tok.peek(LexContext.Normal).token;
      if (t !== Token.Semi && t !== Token.Newline && t !== Token.Amp) break;
      const isBackground = t === Token.Amp;
      const sepEnd = this.tok.next(LexContext.Normal).end;
      if (isBackground) {
        const stmt = commands[commands.length - 1];
        stmt.background = true;
        stmt.end = sepEnd;
      }
      this.skipNewlines(LexContext.CommandStart);
      t = this.tok.peek(LexContext.CommandStart).token;
      if (listTerminators[t] || !commandStarts[t]) break;
      const node = this.andOr();
      if (node) {
        const redirects = this._redirects;
        this._redirects = [];
        commands.push(this.makeStatement(node, redirects));
      }
    }

    return commands;
  }

  // and_or := pipeline (('&&' | '||') newlines pipeline)*
  private andOr(): Node | null {
    const first = this.pipeline();
    if (!first) return null;

    let t = this.tok.peek(LexContext.Normal).token;
    if (t !== Token.And && t !== Token.Or) return first;

    // Wrap first pipeline with any pending redirects before creating AndOr
    let wrappedFirst: Node = first;
    if (this._redirects.length > 0) {
      wrappedFirst = this.makeStatement(first, this._redirects);
      this._redirects = [];
    }
    const commands: Node[] = [wrappedFirst];
    const operators: LogicalOperator[] = [];

    do {
      operators.push(this.tok.next(LexContext.Normal).token === Token.And ? "&&" : "||");
      this.skipNewlines(LexContext.CommandStart);
      const next = this.pipeline();
      if (!next) break;
      commands.push(next);
      t = this.tok.peek(LexContext.Normal).token;
    } while (t === Token.And || t === Token.Or);

    return {
      type: "AndOr",
      pos: first.pos,
      end: commands[commands.length - 1].end,
      commands,
      operators,
    } satisfies AndOr;
  }

  private wrapCompoundRedirects(node: Node): Node {
    const redirects = this._redirects;
    this._redirects = [];
    if (redirects.length === 0) return node;
    return this.makeStatement(node, redirects);
  }

  // pipeline := ['time' ['-p']] ['!'] command ('|' newlines command)*
  private pipeline(): Node | null {
    let time = false;
    let pipelinePos = 0;
    if (
      this.tok.peek(LexContext.CommandStart).token === Token.Word &&
      this.tok.peek(LexContext.CommandStart).value === "time"
    ) {
      time = true;
      pipelinePos = this.tok.next(LexContext.CommandStart).pos;
      if (
        this.tok.peek(LexContext.CommandStart).token === Token.Word &&
        this.tok.peek(LexContext.CommandStart).value === "-p"
      )
        this.tok.next(LexContext.CommandStart);
    }

    const negated = this.tok.peek(LexContext.CommandStart).token === Token.Bang;
    if (negated) {
      if (!time) pipelinePos = this.tok.peek(LexContext.CommandStart).pos;
      this.tok.next(LexContext.CommandStart);
    }

    const first = this.command();
    if (!first) {
      if (time || negated) {
        const pipeline: Pipeline = {
          type: "Pipeline",
          pos: pipelinePos,
          end: pipelinePos,
          commands: [],
          negated: negated ? true : undefined,
          operators: [],
          time: time ? true : undefined,
        };
        return pipeline;
      }
      return null;
    }

    if (!time && !negated) pipelinePos = first.pos;

    const commands: Node[] = [first];
    const operators: PipeOperator[] = [];
    // Save _redirects from first command — only wrap in Statement if piped
    let firstRedirects = this._redirects;
    this._redirects = [];
    while (this.tok.peek(LexContext.Normal).token === Token.Pipe) {
      if (commands.length === 1 && firstRedirects.length > 0) {
        commands[0] = this.makeStatement(first, firstRedirects);
        firstRedirects = [];
      }
      const pipeVal = this.tok.next(LexContext.Normal).value;
      operators.push(pipeVal === "|&" ? "|&" : "|");
      this.skipNewlines(LexContext.CommandStart);
      const cmd = this.command();
      if (cmd) commands.push(this.wrapCompoundRedirects(cmd));
    }

    if (commands.length === 1 && !negated && !time) {
      // Pass redirects up for list() to consume
      this._redirects = firstRedirects;
      return commands[0];
    }
    // Wrap first command's compound redirects in Statement if needed
    if (firstRedirects.length > 0) {
      commands[0] = this.makeStatement(first, firstRedirects);
    }
    const pipeline: Pipeline = {
      type: "Pipeline",
      pos: pipelinePos,
      end: commands[commands.length - 1].end,
      commands,
      negated: negated ? true : undefined,
      operators,
      time: time ? true : undefined,
    };
    return pipeline;
  }

  // command := compound_command | function_def | simple_command
  private command(): Node | null {
    switch (this.tok.peek(LexContext.CommandStart).token) {
      case Token.LParen:
        return this.subshell();
      case Token.LBrace:
        return this.braceGroup();
      case Token.If:
        return this.ifClause();
      case Token.For:
        return this.forClause();
      case Token.While:
        return this.whileClause();
      case Token.Until:
        return this.untilClause();
      case Token.Case:
        return this.caseClause();
      case Token.Function:
        return this.functionDef();
      case Token.Select:
        return this.selectClause();
      case Token.DblLBracket:
        return this.testCommand();
      case Token.ArithCmd:
        return this.arithCommand();
      case Token.Coproc:
        return this.coprocCommand();
      case Token.Word:
      case Token.Assignment:
      case Token.Redirect:
        return this.simpleCommandOrFunction();
      default:
        return null;
    }
  }

  private collectTrailingRedirects(): Redirect[] {
    let redirects: Redirect[] = [];
    while (this.tok.peek(LexContext.Normal).token === Token.Redirect) {
      redirects = this.collectRedirect(redirects, LexContext.Normal);
    }
    return redirects;
  }

  // arith_command := (( expr ))
  private arithCommand(): ArithmeticCommand {
    const tok = this.tok.next(LexContext.CommandStart);
    this._redirects = this.collectTrailingRedirects();
    return new ArithmeticCommandImpl(tok.pos, tok.end, tok.value);
  }

  // coproc := COPROC [name] command [redirections]
  private coprocCommand(): Coproc {
    const startTok = this.tok.next(LexContext.CommandStart);
    const pos = startTok.pos;
    const startEnd = startTok.end;

    const t = this.tok.peek(LexContext.CommandStart);

    // If next token starts a compound command, no name — parse full pipeline
    if (t.token !== Token.Word && t.token !== Token.Assignment && t.token !== Token.Redirect) {
      const body = this.pipeline() ?? {
        type: "Command" as const,
        pos,
        end: startEnd,
        name: undefined,
        prefix: EMPTY_PREFIX,
        suffix: EMPTY_SUFFIX,
        redirects: EMPTY_REDIRECTS,
      };
      const bodyRedirects = this._redirects;
      this._redirects = [];
      const redirects = this.collectTrailingRedirects();
      const allRedirects = [...bodyRedirects, ...redirects];
      const end = allRedirects.length > 0 ? allRedirects[allRedirects.length - 1].end : body.end;
      return { type: "Coproc", pos, end, name: undefined, body, redirects: allRedirects };
    }

    // Consume first word as tentative name
    const tentativeWord = this.toWord(this.tok.next(LexContext.CommandStart));

    // Try to parse what follows as a pipeline
    const body = this.pipeline();

    if (body === null) {
      const cmd: Command = {
        type: "Command",
        pos: tentativeWord.pos,
        end: tentativeWord.end,
        name: tentativeWord,
        prefix: EMPTY_PREFIX,
        suffix: EMPTY_SUFFIX,
        redirects: EMPTY_REDIRECTS,
      };
      const redirects = this.collectTrailingRedirects();
      const end = redirects.length > 0 ? redirects[redirects.length - 1].end : cmd.end;
      return { type: "Coproc", pos, end, name: undefined, body: cmd, redirects };
    }

    if (body.type === "Command") {
      const cmd = body;
      if (cmd.name) {
        cmd.suffix = [cmd.name, ...cmd.suffix];
      }
      cmd.name = tentativeWord;
      cmd.pos = tentativeWord.pos;
      const redirects = this.collectTrailingRedirects();
      const end = redirects.length > 0 ? redirects[redirects.length - 1].end : cmd.end;
      return { type: "Coproc", pos, end, name: undefined, body: cmd, redirects };
    }

    // Pipeline or compound command — tentative "name" IS the coproc name
    const bodyRedirects = this._redirects;
    this._redirects = [];
    const redirects = this.collectTrailingRedirects();
    const allRedirects = [...bodyRedirects, ...redirects];
    const end = allRedirects.length > 0 ? allRedirects[allRedirects.length - 1].end : body.end;
    return { type: "Coproc", pos, end, name: tentativeWord, body, redirects: allRedirects };
  }

  // subshell := '(' list ')'
  private subshell(): Subshell {
    const pos = this.tok.next(LexContext.CommandStart).pos;
    const commands = this.list();
    const closeEnd = this.acceptEnd(Token.RParen, LexContext.Normal);
    if (closeEnd < 0) this.error("expected ')' to close subshell", this.tok.getPos());
    const end = closeEnd >= 0 ? closeEnd : pos;
    this._redirects = this.collectTrailingRedirects();
    return { type: "Subshell", pos, end, body: this.makeCompoundList(commands) };
  }

  // brace_group := '{' list '}'
  private braceGroup(): BraceGroup {
    const pos = this.tok.next(LexContext.CommandStart).pos;
    const commands = this.list();
    const closeEnd = this.acceptEnd(Token.RBrace, LexContext.Normal);
    if (closeEnd < 0) this.error("expected '}' to close brace group", this.tok.getPos());
    const end = closeEnd >= 0 ? closeEnd : pos;
    this._redirects = this.collectTrailingRedirects();
    return { type: "BraceGroup", pos, end, body: this.makeCompoundList(commands) };
  }

  // if_clause := IF list THEN list (ELIF list THEN list)* [ELSE list] FI
  private ifClause(): If {
    const pos = this.tok.next(LexContext.CommandStart).pos;
    const clause = this.makeCompoundList(this.list());
    this.skipSemi();
    if (!this.accept(Token.Then, LexContext.CommandStart)) this.error("expected 'then'", this.tok.getPos());
    const then_ = this.makeCompoundList(this.list());
    this.skipSemi();
    let else_: CompoundList | If | undefined;
    let end: number;
    if (this.tok.peek(LexContext.CommandStart).token === Token.Elif) {
      else_ = this.ifClause();
      end = else_.end; // elif's ifClause already consumed fi
    } else if (this.accept(Token.Else, LexContext.CommandStart)) {
      else_ = this.makeCompoundList(this.list());
      this.skipSemi();
      const closeEnd = this.acceptEnd(Token.Fi, LexContext.CommandStart);
      if (closeEnd < 0) this.error("expected 'fi' to close 'if'", this.tok.getPos());
      end = closeEnd >= 0 ? closeEnd : pos;
    } else {
      const closeEnd = this.acceptEnd(Token.Fi, LexContext.CommandStart);
      if (closeEnd < 0) this.error("expected 'fi' to close 'if'", this.tok.getPos());
      end = closeEnd >= 0 ? closeEnd : pos;
    }
    this._redirects = this.collectTrailingRedirects();
    return { type: "If", pos, end, clause, then: then_, else: else_ };
  }

  // for_clause := FOR word [IN word* (';'|NL)] DO list DONE
  //            | FOR '((' expr '))' [';'|NL] DO list DONE
  private forClause(): For | ArithmeticFor {
    const pos = this.tok.next(LexContext.CommandStart).pos;

    if (this.tok.peek(LexContext.Normal).token === Token.LParen) {
      return this.cStyleFor(pos);
    }

    const name = this.readWord(LexContext.Normal);
    const wordlist: Word[] = [];
    this.skipNewlines(LexContext.CommandStart);
    if (this.tok.peek(LexContext.CommandStart).token === Token.In) {
      this.tok.next(LexContext.CommandStart);
      while (this.tok.peek(LexContext.Normal).token === Token.Word) {
        wordlist.push(this.readWord(LexContext.Normal));
      }
    }
    this.skipSemi();
    this.skipNewlines(LexContext.CommandStart);
    if (!this.accept(Token.Do, LexContext.CommandStart)) this.error("expected 'do'", this.tok.getPos());
    const body = this.list();
    this.skipSemi();
    const closeEnd = this.acceptEnd(Token.Done, LexContext.CommandStart);
    if (closeEnd < 0) this.error("expected 'done' to close 'for'", this.tok.getPos());
    const end = closeEnd >= 0 ? closeEnd : pos;
    this._redirects = this.collectTrailingRedirects();
    return { type: "For", pos, end, name, wordlist, body: this.makeCompoundList(body) } satisfies For;
  }

  // C-style for: (( expr; expr; expr )) [;|NL] do list done | { list }
  private cStyleFor(pos: number): ArithmeticFor {
    const [initStr, testStr, updateStr, initPos, testPos, updatePos] = this.tok.readCStyleForExprs();
    if (this.tok.peek(LexContext.CommandStart).token === Token.Semi) this.tok.next(LexContext.CommandStart);
    this.skipNewlines(LexContext.CommandStart);
    if (this.tok.peek(LexContext.CommandStart).token === Token.LBrace) {
      const bg = this.braceGroup();
      return new ArithmeticForImpl(pos, bg.end, bg.body, initStr, testStr, updateStr, initPos, testPos, updatePos);
    }
    if (!this.accept(Token.Do, LexContext.CommandStart)) this.error("expected 'do'", this.tok.getPos());
    const body = this.list();
    const closeEnd = this.acceptEnd(Token.Done, LexContext.CommandStart);
    if (closeEnd < 0) this.error("expected 'done' to close 'for'", this.tok.getPos());
    const end = closeEnd >= 0 ? closeEnd : pos;
    this._redirects = this.collectTrailingRedirects();
    return new ArithmeticForImpl(
      pos,
      end,
      this.makeCompoundList(body),
      initStr,
      testStr,
      updateStr,
      initPos,
      testPos,
      updatePos,
    );
  }

  private whileClause(): While {
    return this.whileOrUntil("while");
  }

  private untilClause(): While {
    return this.whileOrUntil("until");
  }

  private whileOrUntil(kind: "while" | "until"): While {
    const pos = this.tok.next(LexContext.CommandStart).pos;
    const clause = this.makeCompoundList(this.list());
    this.skipSemi();
    if (!this.accept(Token.Do, LexContext.CommandStart)) this.error("expected 'do'", this.tok.getPos());
    const body = this.list();
    this.skipSemi();
    const closeEnd = this.acceptEnd(Token.Done, LexContext.CommandStart);
    if (closeEnd < 0) this.error(`expected 'done' to close '${kind}'`, this.tok.getPos());
    const end = closeEnd >= 0 ? closeEnd : pos;
    this._redirects = this.collectTrailingRedirects();
    return { type: "While", pos, end, kind, clause, body: this.makeCompoundList(body) };
  }

  // case_clause := CASE word IN (pattern) list (;; | ;& | ;;&) ... ESAC
  private caseClause(): Case {
    const pos = this.tok.next(LexContext.CommandStart).pos;
    const word = this.readWord(LexContext.Normal);
    this.skipNewlines(LexContext.CommandStart);
    if (!this.accept(Token.In, LexContext.CommandStart))
      this.error("expected 'in' after 'case' word", this.tok.getPos());
    this.skipNewlines(LexContext.CommandStart);

    const items: CaseItem[] = [];
    let t = this.tok.peek(LexContext.CommandStart).token;
    while (t !== Token.Esac && t !== Token.EOF) {
      const itemPos = this.tok.peek(LexContext.Normal).pos;
      this.accept(Token.LParen, LexContext.Normal);
      const pattern: Word[] = [];
      t = this.tok.peek(LexContext.Normal).token;
      while (t !== Token.RParen && t !== Token.EOF) {
        if (t !== Token.Pipe) pattern.push(this.toWord(this.tok.next(LexContext.Normal)));
        else this.tok.next(LexContext.Normal);
        t = this.tok.peek(LexContext.Normal).token;
      }
      const rparenEnd = this.acceptEnd(Token.RParen, LexContext.Normal);

      const cmds = this.list();
      let itemEnd = rparenEnd >= 0 ? rparenEnd : itemPos;
      if (cmds.length > 0) itemEnd = cmds[cmds.length - 1].end;

      const item: CaseItem = {
        type: "CaseItem",
        pos: itemPos,
        end: itemEnd,
        pattern,
        body: this.makeCompoundList(cmds),
        terminator: undefined,
      };

      t = this.tok.peek(LexContext.CommandStart).token;
      if (t === Token.DoubleSemi || t === Token.SemiAmp || t === Token.DoubleSemiAmp) {
        const termTok = this.tok.next(LexContext.CommandStart);
        item.terminator = CASE_TERMINATORS[termTok.token];
        item.end = termTok.end;
      }
      items.push(item);
      this.skipNewlines(LexContext.CommandStart);
      t = this.tok.peek(LexContext.CommandStart).token;
    }
    const closeEnd = this.acceptEnd(Token.Esac, LexContext.CommandStart);
    if (closeEnd < 0) this.error("expected 'esac' to close 'case'", this.tok.getPos());
    const end = closeEnd >= 0 ? closeEnd : pos;
    this._redirects = this.collectTrailingRedirects();
    return { type: "Case", pos, end, word, items } satisfies Case;
  }

  // select_clause := SELECT word [IN word* (';'|NL)] DO list DONE
  private selectClause(): Select {
    const pos = this.tok.next(LexContext.CommandStart).pos;
    const name = this.readWord(LexContext.Normal);
    const wordlist: Word[] = [];
    this.skipNewlines(LexContext.CommandStart);
    if (this.tok.peek(LexContext.CommandStart).token === Token.In) {
      this.tok.next(LexContext.CommandStart);
      while (this.tok.peek(LexContext.Normal).token === Token.Word) {
        wordlist.push(this.readWord(LexContext.Normal));
      }
    }
    this.skipSemi();
    this.skipNewlines(LexContext.CommandStart);
    if (!this.accept(Token.Do, LexContext.CommandStart)) this.error("expected 'do'", this.tok.getPos());
    const body = this.list();
    this.skipSemi();
    const closeEnd = this.acceptEnd(Token.Done, LexContext.CommandStart);
    if (closeEnd < 0) this.error("expected 'done' to close 'select'", this.tok.getPos());
    const end = closeEnd >= 0 ? closeEnd : pos;
    this._redirects = this.collectTrailingRedirects();
    return { type: "Select", pos, end, name, wordlist, body: this.makeCompoundList(body) } satisfies Select;
  }

  // test_command := [[ test_expr ]]
  private testCommand(): TestCommand {
    const pos = this.tok.next(LexContext.CommandStart).pos; // consume [[
    const expr = this.parseTestOr();
    const closeEnd = this.acceptEnd(Token.DblRBracket, LexContext.TestMode);
    if (closeEnd < 0 && this.tok.peek(LexContext.Normal).token === Token.EOF)
      this.error("expected ']]' to close '[['", this.tok.getPos());
    const end = closeEnd >= 0 ? closeEnd : pos;
    this._redirects = this.collectTrailingRedirects();
    return { type: "TestCommand", pos, end, expression: expr };
  }

  // test_or := test_and ('||' test_and)*
  private parseTestOr(): TestExpression {
    let left = this.parseTestAnd();
    while (this.tok.peek(LexContext.TestMode).token === Token.Or) {
      this.tok.next(LexContext.TestMode);
      const right = this.parseTestAnd();
      left = {
        type: "TestLogical",
        pos: left.pos,
        end: right.end,
        operator: "||",
        left,
        right,
      } satisfies TestLogicalExpression;
    }
    return left;
  }

  // test_and := test_not ('&&' test_not)*
  private parseTestAnd(): TestExpression {
    let left = this.parseTestNot();
    while (this.tok.peek(LexContext.TestMode).token === Token.And) {
      this.tok.next(LexContext.TestMode);
      const right = this.parseTestNot();
      left = {
        type: "TestLogical",
        pos: left.pos,
        end: right.end,
        operator: "&&",
        left,
        right,
      } satisfies TestLogicalExpression;
    }
    return left;
  }

  // test_not := '!' test_not | test_primary
  private parseTestNot(): TestExpression {
    if (this.tok.peek(LexContext.TestMode).token === Token.Word && this.tok.peek(LexContext.TestMode).value === "!") {
      const notPos = this.tok.next(LexContext.TestMode).pos;
      const operand = this.parseTestNot();
      return { type: "TestNot", pos: notPos, end: operand.end, operand } satisfies TestNotExpression;
    }
    return this.parseTestPrimary();
  }

  // test_primary := '(' test_or ')' | unary_op word | word binary_op word | word
  private parseTestPrimary(): TestExpression {
    // Grouped: ( expr )
    if (this.tok.peek(LexContext.TestMode).token === Token.LParen) {
      const openPos = this.tok.next(LexContext.TestMode).pos;
      const expr = this.parseTestOr();
      const closeEnd = this.acceptEnd(Token.RParen, LexContext.TestMode);
      if (closeEnd < 0) this.error("expected ')' to close test group", this.tok.getPos());
      const end = closeEnd >= 0 ? closeEnd : openPos;
      return { type: "TestGroup", pos: openPos, end, expression: expr } satisfies TestGroupExpression;
    }

    const first = this.tok.next(LexContext.TestMode);
    const val = first.value;
    const firstPos = first.pos;
    const firstEnd = first.end;

    // Unary test: -op word
    if (UNARY_TEST_OPS[val] === 1) {
      const nt = this.tok.peek(LexContext.TestMode).token;
      if (nt === Token.Word) {
        const operand = this.readWord(LexContext.TestMode);
        return {
          type: "TestUnary",
          pos: firstPos,
          end: operand.end,
          operator: val,
          operand,
        } satisfies TestUnaryExpression;
      }
    }

    // Check for binary op
    const nt = this.tok.peek(LexContext.TestMode);
    if (nt.token === Token.Word && BINARY_TEST_OPS[nt.value] === 1) {
      const op = this.tok.next(LexContext.TestMode).value;
      let right: Word;
      if (op === "=~") {
        right = this.toWord(this.tok.readTestRegexWord());
      } else {
        right = this.readWord(LexContext.TestMode);
      }
      const left = this.toWordFromPosEnd(first, firstPos, firstEnd);
      return {
        type: "TestBinary",
        pos: firstPos,
        end: right.end,
        operator: op,
        left,
        right,
      } satisfies TestBinaryExpression;
    }

    // Standalone word (implicit -n test)
    const w = this.toWordFromPosEnd(first, firstPos, firstEnd);
    return { type: "TestUnary", pos: firstPos, end: w.end, operator: "-n", operand: w } satisfies TestUnaryExpression;
  }

  // function_def with 'function' keyword
  private functionDef(): Function {
    const pos = this.tok.next(LexContext.CommandStart).pos;
    const name = this.readWord(LexContext.Normal);
    if (this.tok.peek(LexContext.CommandStart).token === Token.LParen) {
      this.tok.next(LexContext.CommandStart);
      if (!this.accept(Token.RParen, LexContext.CommandStart)) this.error("expected ')' after '('", this.tok.getPos());
    }
    this.skipNewlines(LexContext.CommandStart);
    const body = this.commandAsBody();
    const redirects = this._redirects;
    this._redirects = [];
    const end = redirects.length > 0 ? redirects[redirects.length - 1].end : body.end;
    return { type: "Function", pos, end, name, body, redirects };
  }

  // simple_command or function_def (word '(' ')' body)
  private simpleCommandOrFunction(): Node {
    const prefix: AssignmentPrefix[] = [];
    let redirects: Redirect[] = [];
    let cmdPos = this.tok.peek(LexContext.CommandStart).pos;
    let lastEnd = cmdPos;

    while (this.tok.peek(LexContext.CommandStart).token === Token.Assignment) {
      const t = this.tok.next(LexContext.CommandStart);
      lastEnd = t.end;
      prefix.push(this.parseAssignment(t));
    }

    // Consume prefix redirects (e.g. "2>/dev/null cmd")
    while (this.tok.peek(LexContext.CommandStart).token === Token.Redirect) {
      redirects = this.collectRedirect(redirects, LexContext.CommandStart);
      lastEnd = redirects[redirects.length - 1].end;
    }

    if (this.tok.peek(LexContext.Normal).token !== Token.Word) {
      if (prefix.length > 0) {
        return {
          type: "Command",
          pos: cmdPos,
          end: lastEnd,
          name: undefined,
          prefix,
          suffix: EMPTY_SUFFIX,
          redirects,
        } satisfies Command;
      }
      return {
        type: "Command",
        pos: cmdPos,
        end: lastEnd,
        name: undefined,
        prefix: EMPTY_PREFIX,
        suffix: EMPTY_SUFFIX,
        redirects: EMPTY_REDIRECTS,
      } satisfies Command;
    }

    const name = this.readWord(LexContext.Normal);
    lastEnd = name.end;

    // Check for function definition: word '(' ')' body
    if (this.tok.peek(LexContext.Normal).token === Token.LParen) {
      this.tok.next(LexContext.Normal);
      if (this.tok.peek(LexContext.Normal).token === Token.RParen) {
        this.tok.next(LexContext.Normal);
        this.skipNewlines(LexContext.CommandStart);
        const body = this.commandAsBody();
        const bodyRedirects = this._redirects;
        this._redirects = [];
        const end = bodyRedirects.length > 0 ? bodyRedirects[bodyRedirects.length - 1].end : body.end;
        return { type: "Function", pos: name.pos, end, name, body, redirects: bodyRedirects } satisfies Function;
      }
    }

    const suffix: Word[] = [];

    // Collect suffix words and redirects
    for (;;) {
      const st = this.tok.peek(LexContext.Normal).token;
      if (st === Token.Word || st === Token.Assignment) {
        const w = this.readWord(LexContext.Normal);
        suffix.push(w);
        lastEnd = w.end;
      } else if (st === Token.Redirect) {
        redirects = this.collectRedirect(redirects, LexContext.Normal);
        lastEnd = redirects[redirects.length - 1].end;
      } else {
        break;
      }
    }

    return { type: "Command", pos: cmdPos, end: lastEnd, name, prefix, suffix, redirects } satisfies Command;
  }

  private collectRedirect(redirects: Redirect[], ctx: LexContext): Redirect[] {
    const t = this.tok.next(ctx);
    const tPos = t.pos;
    const tEnd = t.end;
    const r: Redirect = {
      pos: tPos,
      end: tEnd,
      operator: REDIRECT_OPS[t.value] ?? ">",
      target: undefined,
      fileDescriptor: t.fileDescriptor,
      variableName: t.variableName,
      content: t.content,
      heredocQuoted: undefined,
      body: undefined,
    };
    if (t.content != null) {
      r.target = new WordImpl(t.content, t.targetPos, t.targetEnd, this.source);
    }
    if (t.value === "<<" || t.value === "<<-") this.tok.registerHereDocTarget(r);
    redirects.push(r);
    return redirects;
  }

  private commandAsBody(): Node {
    const t = this.tok.peek(LexContext.CommandStart).token;
    if (t === Token.LBrace) return this.braceGroup();
    if (t === Token.LParen) return this.subshell();
    const cmd = this.command();
    const p = this.tok.getPos();
    return cmd ?? ({ type: "CompoundList", pos: p, end: p, commands: [] } satisfies CompoundList);
  }

  private readWord(ctx: LexContext): Word {
    return this.toWord(this.tok.next(ctx));
  }

  private toWord(tok: TokenValue): Word {
    return new WordImpl(this.source.slice(tok.pos, tok.end), tok.pos, tok.end, this.source);
  }

  private toWordFromPosEnd(tok: TokenValue, pos: number, end: number): Word {
    return new WordImpl(this.source.slice(pos, end), pos, end, this.source);
  }

  private parseAssignment(tok: TokenValue): AssignmentPrefix {
    const text = this.source.slice(tok.pos, tok.end);
    const tokPos = tok.pos;
    const tokEnd = tok.end;
    const result: AssignmentPrefix = {
      type: "Assignment",
      pos: tokPos,
      end: tokEnd,
      text,
      name: undefined,
      value: undefined,
      append: undefined,
      index: undefined,
      array: undefined,
    };

    // Find the = sign, accounting for name, name[index], and += variants
    const eqIdx = text.indexOf("=");
    if (eqIdx <= 0) return result;

    let nameEnd = eqIdx;
    let append = false;
    let index: string | undefined;

    // Check for += (append)
    if (text.charCodeAt(eqIdx - 1) === 0x2b /* + */) {
      append = true;
      nameEnd = eqIdx - 1;
    }

    // Check for [index] before = or +=
    const bracketIdx = text.indexOf("[");
    if (bracketIdx > 0 && bracketIdx < nameEnd) {
      const rbracketIdx = text.indexOf("]", bracketIdx);
      if (rbracketIdx > bracketIdx && rbracketIdx + 1 === nameEnd) {
        index = text.slice(bracketIdx + 1, rbracketIdx);
        nameEnd = bracketIdx;
      }
    }

    const name = text.slice(0, nameEnd);
    result.name = name;
    if (append) result.append = true;
    if (index !== undefined) result.index = index;

    // Value portion starts after =
    const valStart = eqIdx + 1;
    const valText = text.slice(valStart);

    // Check for array assignment: value starts with (
    if (valText.charCodeAt(0) === 0x28 /* ( */ && valText.charCodeAt(valText.length - 1) === 0x29 /* ) */) {
      const inner = valText.slice(1, -1);
      const arrayOffset = tokPos + valStart + 1;
      const elements = this.parseArrayElements(inner, arrayOffset);
      result.array = elements;
    } else {
      result.value = new WordImpl(valText, tokPos + valStart, tokEnd, this.source);
    }

    return result;
  }

  private parseArrayElements(inner: string, offset = 0): Word[] {
    const subTok = new Lexer(inner);
    const elements: Word[] = [];
    while (subTok.peek(LexContext.Normal).token !== Token.EOF) {
      if (subTok.peek(LexContext.Normal).token === Token.Newline) {
        subTok.next(LexContext.Normal);
        continue;
      }
      const t = subTok.next(LexContext.Normal);
      if (t.token === Token.Word || t.token === Token.Assignment) {
        const pos = t.pos + offset;
        const end = t.end + offset;
        elements.push(new WordImpl(this.source.slice(pos, end), pos, end, this.source));
      }
    }
    return elements;
  }

  private makeCompoundList(commands: Statement[]): CompoundList {
    const p = this.tok.getPos();
    const pos = commands.length > 0 ? commands[0].pos : p;
    const end = commands.length > 0 ? commands[commands.length - 1].end : p;
    return { type: "CompoundList", pos, end, commands };
  }
}
