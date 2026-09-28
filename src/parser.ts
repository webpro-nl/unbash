// oxlint-disable unicorn/no-thenable
export type * from "./types.ts";

import type {
  ArithmeticCommand,
  ArithmeticExpression,
  ArithmeticFor,
  Assignment,
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
  Negation,
  CommandNode,
  PipelineNode,
  ParseError,
  ParsedScript,
  PipeOperator,
  Pipeline,
  HereDoc,
  Redirection,
  RedirectDescriptor,
  Redirected,
  CompoundCommand,
  RedirectOperator,
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
  Time,
  While,
  Word,
} from "./internal-types.ts";
import { hasEmbeddedWordStructure, LexContext, MAX_SYNTAX_NESTING, Token, Lexer, TokenValue } from "./lexer.ts";
import { parseArithmeticExpression } from "./arithmetic.ts";
import { computeWordParts, computeEmbeddedWordParts, computeHereDocBodyParts } from "./parts.ts";
import { WordImpl } from "./word.ts";
import { AssignmentImpl } from "./assignment.ts";
import { CommandImpl } from "./command.ts";
import { HereDocBodyImpl } from "./heredoc.ts";

WordImpl._resolveWord = computeWordParts;
HereDocBodyImpl._resolveParts = computeHereDocBodyParts;

function isDeclarationCommand(name: string): boolean {
  switch (name.length) {
    case 5:
      return name === "local" || name === "alias";
    case 6:
      return name === "export";
    case 7:
      return name === "declare" || name === "typeset";
    case 8:
      return name === "readonly";
    default:
      return false;
  }
}

class ArithmeticCommandImpl implements ArithmeticCommand {
  type = "ArithmeticCommand" as const;
  pos: number;
  end: number;
  body: string;
  #source: string;
  #depth: number;
  #expression: ArithmeticExpression | undefined | null = null;

  constructor(pos: number, end: number, body: string, source: string, depth: number) {
    this.pos = pos;
    this.end = end;
    this.body = body;
    this.#source = source;
    this.#depth = depth;
  }

  get expression(): ArithmeticExpression | undefined {
    if (this.#expression === null) {
      this.#expression = parseArithmeticWithParts(this.body, this.pos + 2, this.#source, this.#depth);
    }
    return this.#expression;
  }
  set expression(v: ArithmeticExpression | undefined) {
    this.#expression = v ?? undefined;
  }

  toJSON(): ArithmeticCommand {
    return {
      type: this.type,
      pos: this.pos,
      end: this.end,
      expression: this.expression,
      body: this.body,
    };
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
  #source: string;
  #depth: number;
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
    source: string,
    depth: number,
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
    this.#source = source;
    this.#depth = depth;
  }

  get initialize(): ArithmeticExpression | undefined {
    if (this.#initialize === null) {
      if (this.#initStr) {
        this.#initialize = parseArithmeticWithParts(this.#initStr, this.#initPos, this.#source, this.#depth);
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
        this.#test = parseArithmeticWithParts(this.#testStr, this.#testPos, this.#source, this.#depth);
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
        this.#update = parseArithmeticWithParts(this.#updateStr, this.#updatePos, this.#source, this.#depth);
      } else {
        this.#update = undefined;
      }
    }
    return this.#update;
  }
  set update(v: ArithmeticExpression | undefined) {
    this.#update = v ?? undefined;
  }

  toJSON(): ArithmeticFor {
    return {
      type: this.type,
      pos: this.pos,
      end: this.end,
      initialize: this.initialize,
      test: this.test,
      update: this.update,
      body: this.body,
    };
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
  "<>": "<>",
  "<&": "<&",
  ">&": ">&",
  ">|": ">|",
  "&>": "&>",
  "&>>": "&>>",
};

function parseArithmeticWithParts(
  body: string,
  offset: number,
  source: string,
  depth = 0,
): ArithmeticExpression | undefined {
  if (!hasEmbeddedWordStructure(source, offset, offset + body.length)) {
    return parseArithmeticExpression(body, offset) ?? undefined;
  }
  const commandExpansions: import("./internal-types.ts").ArithmeticCommandExpansion[] = [];
  const embeddedWords: import("./internal-types.ts").ArithmeticWord[] = [];
  const lexer = new Lexer(source);
  const expression =
    parseArithmeticExpression(body, offset, {
      commandExpansions,
      embeddedWords,
      findClosingBracket: (start, end) => lexer.findClosingBracket(start, end),
      findClosingBrace: (start, end) => lexer.findClosingBrace(start, end),
      findClosingParenthesis: (start, end) => lexer.findClosingParenthesis(start, end),
      findArithmeticExpansionEnd: (start, end) => lexer.findArithmeticExpansionEnd(start, end),
      findArithmeticWordEnd: (start, end) => lexer.findArithmeticWordEnd(start, end),
    }) ?? undefined;
  for (const node of commandExpansions) {
    if (depth <= MAX_SYNTAX_NESTING) {
      node.script = parseRegion(source, node.pos + 2, node.end - 1, depth + 1, true);
    }
  }
  for (const node of embeddedWords) node.parts = computeEmbeddedWordParts(source, node, depth);
  return expression;
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

// After one of these Bash is at a command-start position, the only place a reserved-word
// terminator may follow with no separator.
const compoundClosers = new Uint8Array(37);
compoundClosers[Token.RParen] = 1;
compoundClosers[Token.RBrace] = 1;
compoundClosers[Token.DblRBracket] = 1;
compoundClosers[Token.Fi] = 1;
compoundClosers[Token.Done] = 1;
compoundClosers[Token.Esac] = 1;
compoundClosers[Token.ArithCmd] = 1;

// Inside `[[ ]]` only an unquoted `!` negates; `'!'` and `\!` are ordinary operands.
function isTestNegation(t: TokenValue): boolean {
  return t.token === Token.Word && t.keywordEligible && t.value === "!";
}

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
  "-o": 1,
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

const EMPTY_REDIRECTS: Redirection[] = [];

export function parse(source: string): import("./types.ts").ParsedScript {
  return new Parser(source, 0, source.length).run();
}

// Parse a [start, end) window of `source` in place, so the resulting nodes index the original
// source directly. Used to resolve substitution scripts with absolute offsets; not public API.
export function parseRegion(
  source: string,
  start: number,
  end: number,
  depth = 0,
  parenBoundary = false,
): ParsedScript {
  return new Parser(source, start, end, depth, parenBoundary).run();
}

class Parser {
  private tok: Lexer;
  private source: string;
  private start: number;
  private end: number;
  private depth: number;
  private errors: ParseError[] | null = null;
  private syntaxDepth = 0;

  // `depth` counts the substitution scripts (and sub-fields) enclosing this region; it
  // shares the MAX_SYNTAX_NESTING budget with the lexer's lazy word-part materialization.
  constructor(source: string, start: number, end: number, depth = 0, parenBoundary = false) {
    this.tok = new Lexer(source, start, end, parenBoundary);
    this.tok._nestingDepth = depth;
    this.source = source;
    this.start = start;
    this.end = end;
    this.depth = depth;
  }

  run(): ParsedScript {
    const start = this.start;
    // The boundary script one level past the budget still parses (one level is cheap and
    // iterative) but is flagged: everything below it stays unresolved.
    if (this.depth > MAX_SYNTAX_NESTING) this.error("maximum substitution nesting depth exceeded", start);
    let shebang: string | undefined;
    if (start === 0 && this.source.charCodeAt(0) === 35 && this.source.charCodeAt(1) === 33) {
      const nl = this.source.indexOf("\n");
      shebang = nl === -1 ? this.source : this.source.slice(0, nl);
    }
    const commands = this.list();
    for (;;) {
      const unexpected = this.tok.peek(LexContext.CommandStart);
      if (unexpected.token === Token.EOF) break;

      this.error(`unexpected token '${unexpected.value}'`, unexpected.pos);
      // `In` cannot join `listTerminators`: `list()` shares it, and `in` must not terminate a
      // list inside `for`/`case`.
      if (!listTerminators[unexpected.token] && unexpected.token !== Token.In) break;

      this.tok.next(LexContext.CommandStart);
      let separator = this.tok.peek(LexContext.CommandStart).token;
      if (separator !== Token.Semi && separator !== Token.Newline && separator !== Token.Amp) break;

      while (separator === Token.Semi || separator === Token.Newline || separator === Token.Amp) {
        this.tok.next(LexContext.CommandStart);
        separator = this.tok.peek(LexContext.CommandStart).token;
      }
      const recovered = this.list();
      for (let i = 0; i < recovered.length; i++) commands.push(recovered[i]);
    }
    const lexerErrors = this.tok._errors;
    if (lexerErrors !== null && lexerErrors.length > 0) {
      const errors = this.errors ?? (this.errors = []);
      for (let i = 0; i < lexerErrors.length; i++) errors.push(lexerErrors[i]);
    }
    if (this.errors !== null && this.errors.length > 1) this.errors.sort((a, b) => a.pos - b.pos);
    return {
      type: "Script",
      pos: start,
      end: this.end,
      shebang,
      commands,
      errors: this.errors ?? undefined,
    };
  }

  private error(message: string, pos: number): void {
    (this.errors ?? (this.errors = [])).push({ message, pos });
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

  private makeStatement(command: Statement["command"]): Statement {
    return {
      type: "Statement",
      pos: command.pos,
      end: command.end,
      command,
      background: undefined,
    };
  }

  // list := and_or ((';' | '&' | NEWLINE) and_or)* [';' | '&' | NEWLINE]
  private list(): Statement[] {
    const commands: Statement[] = [];
    this.skipNewlines(LexContext.CommandStart);

    let t = this.tok.peek(LexContext.CommandStart).token;
    if (listTerminators[t] || !commandStarts[t]) return commands;

    const first = this.andOr();
    if (first) commands.push(this.makeStatement(first));

    for (;;) {
      t = this.tok.peekFollow(compoundClosers).token;
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
      if (node) commands.push(this.makeStatement(node));
    }

    return commands;
  }

  // and_or := pipeline (('&&' | '||') newlines pipeline)*
  private andOr(): PipelineNode | AndOr | null {
    const first = this.pipeline();
    if (!first) return null;

    let t = this.tok.peek(LexContext.Normal).token;
    if (t !== Token.And && t !== Token.Or) return first;

    const commands: PipelineNode[] = [first];
    const operators: LogicalOperator[] = [];

    do {
      const operatorToken = this.tok.next(LexContext.Normal);
      const operator = operatorToken.token === Token.And ? "&&" : "||";
      this.skipNewlines(LexContext.CommandStart);
      const next = this.pipeline();
      if (!next) {
        this.error(`expected command after '${operator}'`, operatorToken.end);
        break;
      }
      operators.push(operator);
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

  private withRedirects(command: CompoundCommand): CompoundCommand | Redirected {
    const redirects = this.collectTrailingRedirects();
    if (redirects.length === 0) return command;
    return { type: "Redirected", pos: command.pos, end: redirects[redirects.length - 1].end, command, redirects };
  }

  private pipeline(): PipelineNode | null {
    let prefixes: (Time | Negation)[] | undefined;
    let exceeded = false;
    for (;;) {
      const token = this.tok.peek(LexContext.CommandStart);
      const isTime = token.token === Token.Word && token.keywordEligible && token.value === "time";
      if (token.token !== Token.Bang && !isTime) break;
      const prefix = this.tok.next(LexContext.CommandStart);
      const pos = prefix.pos;
      const keywordEnd = prefix.end;
      let posix: Time["posix"];
      let endOfOptions: Time["endOfOptions"];
      if (isTime) {
        let flag = this.tok.peek(LexContext.CommandStart);
        if (flag.token === Token.Word && flag.keywordEligible && flag.value === "-p") {
          this.tok.next(LexContext.CommandStart);
          posix = { pos: flag.pos, end: flag.end };
          flag = this.tok.peek(LexContext.CommandStart);
        }
        if (flag.token === Token.Word && flag.keywordEligible && flag.value === "--") {
          this.tok.next(LexContext.CommandStart);
          endOfOptions = { pos: flag.pos, end: flag.end };
        }
      }
      if (prefixes === undefined) prefixes = [];
      if (prefixes.length + this.syntaxDepth === MAX_SYNTAX_NESTING) {
        if (!exceeded) this.error("maximum pipeline prefix nesting depth exceeded", pos);
        exceeded = true;
        continue;
      }
      prefixes.push(
        isTime
          ? {
              type: "Time",
              pos,
              end: endOfOptions?.end ?? posix?.end ?? keywordEnd,
              keywordEnd,
              posix,
              endOfOptions,
              command: undefined,
            }
          : { type: "Negation", pos, end: keywordEnd, keywordEnd, command: undefined },
      );
    }

    if (!prefixes) return this.pipelineCommands();
    this.syntaxDepth += prefixes.length;
    let command: PipelineNode | null = this.pipelineCommands();
    this.syntaxDepth -= prefixes.length;
    for (let i = prefixes.length - 1; i >= 0; i--) {
      const prefix = prefixes[i];
      prefix.command = command ?? undefined;
      if (command) prefix.end = command.end;
      command = prefix;
    }
    return command;
  }

  private pipelineCommands(): CommandNode | Pipeline | null {
    const first = this.command();
    if (!first) return null;

    const commands: CommandNode[] = [first];
    const operators: PipeOperator[] = [];
    while (this.tok.peek(LexContext.Normal).token === Token.Pipe) {
      const pipeToken = this.tok.next(LexContext.Normal);
      const operator = pipeToken.value === "|&" ? "|&" : "|";
      this.skipNewlines(LexContext.CommandStart);
      const cmd = this.command();
      if (!cmd) {
        this.error(`expected command after '${operator}'`, pipeToken.end);
        break;
      }
      operators.push(operator);
      commands.push(cmd);
    }

    if (commands.length === 1) {
      return commands[0];
    }
    const pipeline: Pipeline = {
      type: "Pipeline",
      pos: first.pos,
      end: commands[commands.length - 1].end,
      commands,
      operators,
    };
    return pipeline;
  }

  // command := compound_command | function_def | simple_command
  private command(): CommandNode | null {
    let compound: CompoundCommand;
    switch (this.tok.peek(LexContext.CommandStart).token) {
      case Token.LParen:
        compound = this.subshell();
        break;
      case Token.LBrace:
        compound = this.braceGroup();
        break;
      case Token.If:
        compound = this.ifClause();
        break;
      case Token.For:
        compound = this.forClause();
        break;
      case Token.While:
        compound = this.whileClause();
        break;
      case Token.Until:
        compound = this.untilClause();
        break;
      case Token.Case:
        compound = this.caseClause();
        break;
      case Token.Function:
        return this.functionDef();
      case Token.Select:
        compound = this.selectClause();
        break;
      case Token.DblLBracket:
        compound = this.testCommand();
        break;
      case Token.ArithCmd:
        compound = this.arithCommand();
        break;
      case Token.Coproc:
        return this.coprocCommand();
      case Token.Word:
      case Token.Assignment:
      case Token.Redirect:
        return this.simpleCommandOrFunction();
      default:
        return null;
    }
    return this.withRedirects(compound);
  }

  private collectTrailingRedirects(): Redirection[] {
    let redirects: Redirection[] = EMPTY_REDIRECTS;
    while (this.tok.peekFollow(compoundClosers).token === Token.Redirect) {
      if (redirects === EMPTY_REDIRECTS) redirects = [];
      redirects.push(this.readRedirect(LexContext.Normal));
    }
    return redirects;
  }

  // arith_command := (( expr ))
  private arithCommand(): ArithmeticCommand {
    const tok = this.tok.next(LexContext.CommandStart);
    return new ArithmeticCommandImpl(tok.pos, tok.end, tok.value, this.source, this.depth);
  }

  // coproc := COPROC ([name] compound_command [redirections] | simple_command)
  private coprocCommand(): Coproc {
    const start = this.tok.next(LexContext.CommandStart);
    const pos = start.pos;
    const first = this.tok.peek(LexContext.CommandStart);
    let name: Word | undefined;

    // Only a compound command can follow a coprocess name. Decide before parsing
    // a simple command so its assignments and reserved words use the actual name.
    if (first.token === Token.Word) {
      const lookahead = new Lexer(this.source, first.end, this.end);
      lookahead._nestingDepth = this.depth;
      switch (lookahead.peek(LexContext.CommandStart).token) {
        case Token.LParen:
          // `name ( )` opens a function definition, not a subshell body after a name.
          lookahead.next(LexContext.CommandStart);
          if (lookahead.peek(LexContext.Normal).token !== Token.RParen) name = this.readWord(LexContext.CommandStart);
          break;
        case Token.LBrace:
        case Token.If:
        case Token.For:
        case Token.While:
        case Token.Until:
        case Token.Case:
        case Token.Select:
        case Token.DblLBracket:
        case Token.ArithCmd:
          name = this.readWord(LexContext.CommandStart);
      }
    }

    const cmd = this.command();
    if (cmd && cmd.type !== "Function" && cmd.type !== "Coproc") {
      return { type: "Coproc", pos, end: cmd.end, name, body: cmd };
    }
    this.error("expected command after 'coproc'", cmd?.pos ?? start.end);
    const body = cmd
      ? this.makeCompoundList([this.makeStatement(cmd)])
      : ({ type: "CompoundList", pos: start.end, end: start.end, commands: [] } satisfies CompoundList);
    return { type: "Coproc", pos, end: body.end, name, body };
  }

  // subshell := '(' list ')'
  private subshell(): Subshell {
    return this.subshellBody(this.tok.next(LexContext.CommandStart).pos);
  }

  // Continues a subshell whose '(' the caller already consumed.
  private subshellBody(pos: number): Subshell {
    if (this.syntaxDepth === MAX_SYNTAX_NESTING) {
      this.error("maximum subshell nesting depth exceeded", pos);
      const closeEnd = this.tok.skipSubshellBody();
      if (closeEnd < 0) this.error("expected ')' to close subshell", this.tok.getPos());
      const end = closeEnd >= 0 ? closeEnd : pos;
      return { type: "Subshell", pos, end, body: this.makeCompoundList([]) };
    }

    this.syntaxDepth++;
    const commands = this.list();
    this.syntaxDepth--;
    if (commands.length === 0) this.error("expected command in subshell", pos);
    const closeEnd = this.acceptEnd(Token.RParen, LexContext.Normal);
    if (closeEnd < 0) this.error("expected ')' to close subshell", this.tok.getPos());
    const end = closeEnd >= 0 ? closeEnd : pos;
    return { type: "Subshell", pos, end, body: this.makeCompoundList(commands) };
  }

  // brace_group := '{' list '}'
  private braceGroup(): BraceGroup {
    const pos = this.tok.next(LexContext.CommandStart).pos;

    if (this.syntaxDepth === MAX_SYNTAX_NESTING) {
      this.error("maximum brace group nesting depth exceeded", pos);
      const closeEnd = this.tok.skipCompoundBody(Token.RBrace);
      if (closeEnd < 0) this.error("expected '}' to close brace group", this.tok.getPos());
      const end = closeEnd >= 0 ? closeEnd : pos;
      return { type: "BraceGroup", pos, end, body: this.makeCompoundList([]) };
    }

    this.syntaxDepth++;
    const commands = this.list();
    this.syntaxDepth--;
    if (commands.length === 0) this.error("expected command in brace group", pos);
    const closeEnd = this.acceptEnd(Token.RBrace, LexContext.Normal);
    if (closeEnd < 0) this.error("expected '}' to close brace group", this.tok.getPos());
    const end = closeEnd >= 0 ? closeEnd : pos;
    return { type: "BraceGroup", pos, end, body: this.makeCompoundList(commands) };
  }

  // if_clause := IF list THEN list (ELIF list THEN list)* [ELSE list] FI
  private ifClause(): If {
    const pos = this.tok.next(LexContext.CommandStart).pos;

    if (this.syntaxDepth === MAX_SYNTAX_NESTING) {
      this.error("maximum if nesting depth exceeded", pos);
      const closeEnd = this.tok.skipCompoundBody(Token.Fi);
      if (closeEnd < 0) this.error("expected 'fi' to close 'if'", this.tok.getPos());
      const end = closeEnd >= 0 ? closeEnd : pos;
      return {
        type: "If",
        pos,
        end,
        clause: this.makeCompoundList([]),
        then: this.makeCompoundList([]),
        else: undefined,
      };
    }

    this.syntaxDepth++;
    let firstBranch: If | undefined;
    let lastBranch: If | undefined;
    let branchPos = pos;
    let clause: CompoundList;
    let then_: CompoundList;
    for (;;) {
      clause = this.makeCompoundList(this.list());
      this.skipSemi();
      const thenToken = this.accept(Token.Then, LexContext.CommandStart);
      if (!thenToken) this.error("expected 'then'", this.tok.getPos());
      const thenCommands = this.list();
      if (thenToken && thenCommands.length === 0)
        this.error("expected command after 'then'", this.tok.peek(LexContext.CommandStart).pos);
      then_ = this.makeCompoundList(thenCommands);
      this.skipSemi();
      const elif = this.accept(Token.Elif, LexContext.CommandStart);
      if (!elif) break;
      const branch: If = {
        type: "If",
        pos: branchPos,
        end: branchPos,
        clause,
        then: then_,
        else: undefined,
      };
      if (lastBranch) lastBranch.else = branch;
      else firstBranch = branch;
      lastBranch = branch;
      branchPos = elif.pos;
    }

    let else_: CompoundList | If | undefined;
    let end: number;
    if (this.accept(Token.Else, LexContext.CommandStart)) {
      else_ = this.makeCompoundList(this.list());
      this.skipSemi();
      const closeEnd = this.acceptEnd(Token.Fi, LexContext.CommandStart);
      if (closeEnd < 0) this.error("expected 'fi' to close 'if'", this.tok.getPos());
      end = closeEnd >= 0 ? closeEnd : branchPos;
    } else {
      const closeEnd = this.acceptEnd(Token.Fi, LexContext.CommandStart);
      if (closeEnd < 0) this.error("expected 'fi' to close 'if'", this.tok.getPos());
      end = closeEnd >= 0 ? closeEnd : branchPos;
    }
    this.syntaxDepth--;
    const finalBranch: If = { type: "If", pos: branchPos, end, clause, then: then_, else: else_ };
    if (!firstBranch) return finalBranch;
    lastBranch!.else = finalBranch;
    let branch: If | CompoundList | undefined = firstBranch;
    while (branch?.type === "If") {
      branch.end = end;
      branch = branch.else;
    }
    return firstBranch;
  }

  // for_clause := FOR word [IN word* (';'|NL)] DO list DONE
  //            | FOR '((' expr '))' [';'|NL] DO list DONE
  private forClause(): For | ArithmeticFor {
    const pos = this.tok.next(LexContext.CommandStart).pos;

    if (this.tok.peek(LexContext.Normal).token === Token.LParen) {
      return this.cStyleFor(pos);
    }

    const name = this.readWord(LexContext.Normal);
    let wordlist: Word[] | undefined;
    this.skipNewlines(LexContext.CommandStart);
    if (this.tok.peek(LexContext.CommandStart).token === Token.In) {
      this.tok.next(LexContext.CommandStart);
      wordlist = [];
      while (this.tok.peek(LexContext.Normal).token === Token.Word) {
        wordlist.push(this.readWord(LexContext.Normal));
      }
    }
    this.skipSemi();
    this.skipNewlines(LexContext.CommandStart);
    if (this.tok.peek(LexContext.CommandStart).token === Token.LBrace) {
      const bg = this.braceGroup();
      return { type: "For", pos, end: bg.end, name, wordlist, body: bg.body } satisfies For;
    }
    if (!this.accept(Token.Do, LexContext.CommandStart)) this.error("expected 'do'", this.tok.getPos());

    if (this.syntaxDepth === MAX_SYNTAX_NESTING) {
      this.error("maximum for nesting depth exceeded", pos);
      const closeEnd = this.tok.skipCompoundBody(Token.Done);
      if (closeEnd < 0) this.error("expected 'done' to close 'for'", this.tok.getPos());
      const end = closeEnd >= 0 ? closeEnd : pos;
      return { type: "For", pos, end, name, wordlist, body: this.makeCompoundList([]) } satisfies For;
    }

    this.syntaxDepth++;
    const body = this.list();
    this.syntaxDepth--;
    this.skipSemi();
    const closeEnd = this.acceptEnd(Token.Done, LexContext.CommandStart);
    if (closeEnd < 0) this.error("expected 'done' to close 'for'", this.tok.getPos());
    const end = closeEnd >= 0 ? closeEnd : pos;
    return { type: "For", pos, end, name, wordlist, body: this.makeCompoundList(body) } satisfies For;
  }

  // C-style for: (( expr; expr; expr )) [;|NL] do list done | { list }
  private cStyleFor(pos: number): ArithmeticFor {
    const [initStr, testStr, updateStr, initPos, testPos, updatePos] = this.tok.readCStyleForExprs();
    if (this.tok.peek(LexContext.CommandStart).token === Token.Semi) this.tok.next(LexContext.CommandStart);
    this.skipNewlines(LexContext.CommandStart);
    if (this.tok.peek(LexContext.CommandStart).token === Token.LBrace) {
      const bg = this.braceGroup();
      return new ArithmeticForImpl(
        pos,
        bg.end,
        bg.body,
        initStr,
        testStr,
        updateStr,
        initPos,
        testPos,
        updatePos,
        this.source,
        this.depth,
      );
    }
    if (!this.accept(Token.Do, LexContext.CommandStart)) this.error("expected 'do'", this.tok.getPos());

    if (this.syntaxDepth === MAX_SYNTAX_NESTING) {
      this.error("maximum for nesting depth exceeded", pos);
      const closeEnd = this.tok.skipCompoundBody(Token.Done);
      if (closeEnd < 0) this.error("expected 'done' to close 'for'", this.tok.getPos());
      const end = closeEnd >= 0 ? closeEnd : pos;
      return new ArithmeticForImpl(
        pos,
        end,
        this.makeCompoundList([]),
        initStr,
        testStr,
        updateStr,
        initPos,
        testPos,
        updatePos,
        this.source,
        this.depth,
      );
    }

    this.syntaxDepth++;
    const body = this.list();
    this.syntaxDepth--;
    const closeEnd = this.acceptEnd(Token.Done, LexContext.CommandStart);
    if (closeEnd < 0) this.error("expected 'done' to close 'for'", this.tok.getPos());
    const end = closeEnd >= 0 ? closeEnd : pos;
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
      this.source,
      this.depth,
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

    if (this.syntaxDepth === MAX_SYNTAX_NESTING) {
      this.error(`maximum ${kind} nesting depth exceeded`, pos);
      const closeEnd = this.tok.skipCompoundBody(Token.Done);
      if (closeEnd < 0) this.error(`expected 'done' to close '${kind}'`, this.tok.getPos());
      const end = closeEnd >= 0 ? closeEnd : pos;
      return {
        type: "While",
        pos,
        end,
        kind,
        clause: this.makeCompoundList([]),
        body: this.makeCompoundList([]),
      };
    }

    this.syntaxDepth++;
    const clause = this.makeCompoundList(this.list());
    this.skipSemi();
    if (!this.accept(Token.Do, LexContext.CommandStart)) this.error("expected 'do'", this.tok.getPos());
    const body = this.list();
    this.skipSemi();
    const closeEnd = this.acceptEnd(Token.Done, LexContext.CommandStart);
    if (closeEnd < 0) this.error(`expected 'done' to close '${kind}'`, this.tok.getPos());
    const end = closeEnd >= 0 ? closeEnd : pos;
    this.syntaxDepth--;
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

    if (this.syntaxDepth === MAX_SYNTAX_NESTING) {
      this.error("maximum case nesting depth exceeded", pos);
      const closeEnd = this.tok.skipCompoundBody(Token.Esac);
      if (closeEnd < 0) this.error("expected 'esac' to close 'case'", this.tok.getPos());
      const end = closeEnd >= 0 ? closeEnd : pos;
      return { type: "Case", pos, end, word, items: [] } satisfies Case;
    }

    this.syntaxDepth++;
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
      // An empty body belongs where commands would start, not wherever the lexer stopped.
      const bodyPos = rparenEnd >= 0 ? rparenEnd : pattern.length > 0 ? pattern[pattern.length - 1].end : itemPos;
      const itemEnd = cmds.length > 0 ? cmds[cmds.length - 1].end : bodyPos;

      const item: CaseItem = {
        type: "CaseItem",
        pos: itemPos,
        end: itemEnd,
        pattern,
        body:
          cmds.length > 0
            ? this.makeCompoundList(cmds)
            : { type: "CompoundList", pos: bodyPos, end: bodyPos, commands: [] },
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
    this.syntaxDepth--;
    return { type: "Case", pos, end, word, items } satisfies Case;
  }

  // select_clause := SELECT word [IN word* (';'|NL)] DO list DONE
  private selectClause(): Select {
    const pos = this.tok.next(LexContext.CommandStart).pos;
    const name = this.readWord(LexContext.Normal);
    let wordlist: Word[] | undefined;
    this.skipNewlines(LexContext.CommandStart);
    if (this.tok.peek(LexContext.CommandStart).token === Token.In) {
      this.tok.next(LexContext.CommandStart);
      wordlist = [];
      while (this.tok.peek(LexContext.Normal).token === Token.Word) {
        wordlist.push(this.readWord(LexContext.Normal));
      }
    }
    this.skipSemi();
    this.skipNewlines(LexContext.CommandStart);
    if (this.tok.peek(LexContext.CommandStart).token === Token.LBrace) {
      const bg = this.braceGroup();
      return { type: "Select", pos, end: bg.end, name, wordlist, body: bg.body } satisfies Select;
    }
    if (!this.accept(Token.Do, LexContext.CommandStart)) this.error("expected 'do'", this.tok.getPos());

    if (this.syntaxDepth === MAX_SYNTAX_NESTING) {
      this.error("maximum select nesting depth exceeded", pos);
      const closeEnd = this.tok.skipCompoundBody(Token.Done);
      if (closeEnd < 0) this.error("expected 'done' to close 'select'", this.tok.getPos());
      const end = closeEnd >= 0 ? closeEnd : pos;
      return { type: "Select", pos, end, name, wordlist, body: this.makeCompoundList([]) } satisfies Select;
    }

    this.syntaxDepth++;
    const body = this.list();
    this.syntaxDepth--;
    this.skipSemi();
    const closeEnd = this.acceptEnd(Token.Done, LexContext.CommandStart);
    if (closeEnd < 0) this.error("expected 'done' to close 'select'", this.tok.getPos());
    const end = closeEnd >= 0 ? closeEnd : pos;
    return { type: "Select", pos, end, name, wordlist, body: this.makeCompoundList(body) } satisfies Select;
  }

  // test_command := [[ test_expr ]]
  private testCommand(): TestCommand {
    const pos = this.tok.next(LexContext.CommandStart).pos; // consume [[
    const expr = this.parseTestOr();
    const closeEnd = this.acceptEnd(Token.DblRBracket, LexContext.TestMode);
    if (closeEnd < 0) this.error("expected ']]' to close '[['", this.tok.getPos());
    const end = closeEnd >= 0 ? closeEnd : pos;
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
    let t = this.tok.peek(LexContext.TestMode);
    if (!isTestNegation(t)) return this.parseTestPrimary();

    const firstPos = this.tok.next(LexContext.TestMode).pos;
    t = this.tok.peek(LexContext.TestMode);
    if (!isTestNegation(t)) {
      const operand = this.parseTestPrimary();
      return { type: "TestNot", pos: firstPos, end: operand.end, operand } satisfies TestNotExpression;
    }

    const positions = [firstPos];
    while (isTestNegation(t)) {
      positions.push(this.tok.next(LexContext.TestMode).pos);
      t = this.tok.peek(LexContext.TestMode);
    }

    let expression = this.parseTestPrimary();
    for (let i = positions.length - 1; i >= 0; i--) {
      expression = {
        type: "TestNot",
        pos: positions[i],
        end: expression.end,
        operand: expression,
      } satisfies TestNotExpression;
    }
    return expression;
  }

  // test_primary := '(' test_or ')' | unary_op word | word binary_op word | word
  private parseTestPrimary(): TestExpression {
    // Grouped: ( expr )
    if (this.tok.peek(LexContext.TestMode).token === Token.LParen) {
      const openPos = this.tok.next(LexContext.TestMode).pos;

      if (this.syntaxDepth === MAX_SYNTAX_NESTING) {
        this.error("maximum test group nesting depth exceeded", openPos);
        const closeEnd = this.tok.skipTestGroup();
        if (closeEnd < 0) this.error("expected ')' to close test group", this.tok.getPos());
        const end = closeEnd >= 0 ? closeEnd : openPos;
        const operand = new WordImpl("", openPos, openPos, this.source, undefined, this.depth);
        const expression = {
          type: "TestUnary",
          pos: openPos,
          end: openPos,
          operator: "-n",
          operand,
        } satisfies TestUnaryExpression;
        return { type: "TestGroup", pos: openPos, end, expression } satisfies TestGroupExpression;
      }

      this.syntaxDepth++;
      const expr = this.parseTestOr();
      this.syntaxDepth--;
      const closeEnd = this.acceptEnd(Token.RParen, LexContext.TestMode);
      if (closeEnd < 0) this.error("expected ')' to close test group", this.tok.getPos());
      const end = closeEnd >= 0 ? closeEnd : openPos;
      return { type: "TestGroup", pos: openPos, end, expression: expr } satisfies TestGroupExpression;
    }

    const first = this.tok.next(LexContext.TestMode);
    const val = first.value;
    const firstPos = first.pos;
    const firstEnd = first.end;

    // Unary test: -op word, recognized only as written. Bash rejects the operator without an
    // operand, so keep the operator and report the missing word instead of demoting it to a string.
    if (first.keywordEligible && UNARY_TEST_OPS[val] === 1) {
      if (this.tok.peek(LexContext.TestMode).token === Token.Word) {
        const operand = this.readWord(LexContext.TestMode);
        return {
          type: "TestUnary",
          pos: firstPos,
          end: operand.end,
          operator: val,
          operand,
        } satisfies TestUnaryExpression;
      }
      this.error("expected operand after unary test operator", firstEnd);
      const operand = new WordImpl("", firstEnd, firstEnd, this.source, undefined, this.depth);
      return { type: "TestUnary", pos: firstPos, end: firstEnd, operator: val, operand } satisfies TestUnaryExpression;
    }

    // Check for binary op
    const nt = this.tok.peek(LexContext.TestMode);
    if (nt.token === Token.Word && nt.keywordEligible && BINARY_TEST_OPS[nt.value] === 1) {
      const op = this.tok.next(LexContext.TestMode).value;
      let right: Word;
      if (op === "=~") {
        const token = this.tok.readTestRegexWord();
        right = new WordImpl(
          this.source.slice(token.pos, token.end),
          token.pos,
          token.end,
          this.source,
          computeEmbeddedWordParts,
          this.depth,
        );
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
    let body: Function["body"];
    if (this.tok.peek(LexContext.CommandStart).token === Token.LParen) {
      const openPos = this.tok.next(LexContext.CommandStart).pos;
      // `(` is the optional empty parameter list only when `)` follows immediately;
      // anything else opens a subshell body, as in `f() ( ... )`.
      if (this.tok.peek(LexContext.CommandStart).token === Token.RParen) {
        this.tok.next(LexContext.CommandStart);
        this.skipNewlines(LexContext.CommandStart);
        body = this.commandAsBody();
      } else {
        body = this.withRedirects(this.subshellBody(openPos));
      }
    } else {
      this.skipNewlines(LexContext.CommandStart);
      body = this.commandAsBody();
    }
    return { type: "Function", pos, end: body.end, name, body };
  }

  // simple_command or function_def (word '(' ')' body)
  private simpleCommandOrFunction(): Command | Function {
    const prefix: Command["prefix"] = [];
    const cmdPos = this.tok.peek(LexContext.CommandStart).pos;
    let lastEnd = cmdPos;

    // Assignments and redirects interleave freely; after the first element CommandPrefix
    // keeps the following command name from being read as a reserved word.
    let ctx: LexContext = LexContext.CommandStart;
    for (;;) {
      const t = this.tok.peek(ctx).token;
      if (t === Token.Assignment) {
        const assignment = this.tok.next(ctx);
        lastEnd = assignment.end;
        prefix.push(this.parseAssignment(assignment));
      } else if (t === Token.Redirect) {
        const redirect = this.readRedirect(ctx);
        prefix.push(redirect);
        lastEnd = redirect.end;
      } else {
        break;
      }
      ctx = LexContext.CommandPrefix;
    }

    if (this.tok.peek(LexContext.Normal).token !== Token.Word) {
      return new CommandImpl(cmdPos, lastEnd, undefined, prefix, []);
    }

    const nameToken = this.tok.next(LexContext.Normal);
    const declaration = nameToken.keywordEligible && isDeclarationCommand(nameToken.value);
    const name = this.toWord(nameToken);
    ctx = declaration ? LexContext.Declaration : LexContext.Normal;
    lastEnd = name.end;

    // Check for function definition: word '(' ')' body
    if (this.tok.peek(ctx).token === Token.LParen) {
      this.tok.next(LexContext.Normal);
      if (this.tok.peek(LexContext.Normal).token === Token.RParen) {
        this.tok.next(LexContext.Normal);
        this.skipNewlines(LexContext.CommandStart);
        const body = this.commandAsBody();
        return {
          type: "Function",
          pos: name.pos,
          end: body.end,
          name,
          body,
        } satisfies Function;
      }
    }

    const suffix: Command["suffix"] = [];

    // Collect suffix words and redirects
    for (;;) {
      const st = this.tok.peek(ctx).token;
      if (st === Token.Word || st === Token.Assignment) {
        const token = this.tok.next(ctx);
        const w = st === Token.Assignment ? this.parseAssignment(token) : this.toWord(token);
        suffix.push(w);
        lastEnd = w.end;
      } else if (st === Token.Redirect) {
        const redirect = this.readRedirect(ctx);
        suffix.push(redirect);
        lastEnd = redirect.end;
      } else {
        break;
      }
    }

    return new CommandImpl(cmdPos, lastEnd, name, prefix, suffix);
  }

  private readRedirect(ctx: LexContext): Redirection {
    const t = this.tok.next(ctx);
    const tPos = t.pos;
    const tEnd = t.end;
    const descriptor: RedirectDescriptor | undefined =
      t.fileDescriptor !== undefined
        ? { type: "FileDescriptor", pos: tPos, end: t.descriptorEnd, value: t.fileDescriptor }
        : t.variableName !== undefined
          ? { type: "FileDescriptorVariable", pos: tPos, end: t.descriptorEnd, name: t.variableName }
          : undefined;
    const hasTarget = t.targetEnd > t.targetPos;
    if (!hasTarget) this.error("expected redirect target", t.targetPos);
    if (t.value === "<<" || t.value === "<<-") {
      const r: HereDoc = {
        type: "HereDoc",
        pos: tPos,
        end: tEnd,
        operator: t.value,
        descriptor,
        delimiter: hasTarget
          ? {
              type: "HereDocDelimiter",
              pos: t.targetPos,
              end: t.targetEnd,
              text: this.source.slice(t.targetPos, t.targetEnd),
              value: t.content ?? "",
              quoted: t.delimiterQuoted,
            }
          : undefined,
        body: new HereDocBodyImpl(this.source, tEnd, t.delimiterQuoted, this.depth),
        closing: undefined,
      };
      if (hasTarget) this.tok.registerHereDocTarget(r);
      return r;
    }
    const target = hasTarget
      ? new WordImpl(
          this.source.slice(t.targetPos, t.targetEnd),
          t.targetPos,
          t.targetEnd,
          this.source,
          undefined,
          this.depth,
        )
      : undefined;
    return t.value === "<<<"
      ? { type: "HereString", pos: tPos, end: tEnd, operator: "<<<", descriptor, target }
      : { type: "Redirect", pos: tPos, end: tEnd, operator: REDIRECT_OPS[t.value] ?? ">", descriptor, target };
  }

  private commandAsBody(): Function["body"] {
    const cmd = this.command();
    if (cmd && cmd.type !== "Command" && cmd.type !== "Function" && cmd.type !== "Coproc") return cmd;
    this.error("expected compound command as function body", cmd?.pos ?? this.tok.getPos());
    return this.makeCompoundList(cmd ? [this.makeStatement(cmd)] : []);
  }

  private readWord(ctx: LexContext): Word {
    return this.toWord(this.tok.next(ctx));
  }

  private toWord(tok: TokenValue): Word {
    const text = tok.raw ? tok.value : this.source.slice(tok.pos, tok.end);
    return new WordImpl(text, tok.pos, tok.end, this.source, undefined, this.depth);
  }

  private toWordFromPosEnd(tok: TokenValue, pos: number, end: number): Word {
    const text = tok.raw && tok.pos === pos && tok.end === end ? tok.value : this.source.slice(pos, end);
    return new WordImpl(text, pos, end, this.source, undefined, this.depth);
  }

  private parseAssignment(token: TokenValue): Assignment {
    const text = token.raw ? token.value : this.source.slice(token.pos, token.end);
    return new AssignmentImpl(text, token.pos, token.end, this.source, token.assignmentOperatorPos, this.depth);
  }

  private makeCompoundList(commands: Statement[]): CompoundList {
    const p = this.tok.getPos();
    const pos = commands.length > 0 ? commands[0].pos : p;
    const end = commands.length > 0 ? commands[commands.length - 1].end : p;
    return { type: "CompoundList", pos, end, commands };
  }
}
