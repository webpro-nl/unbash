// oxlint-disable unicorn/no-thenable
import type {
  DeferredCommandExpansion,
  DoubleQuotedChild,
  ExtGlobOperator,
  ParameterExpansionPart,
  ParseError,
  Word,
  WordPart,
} from "./types.ts";
import { parseArithmeticExpression } from "./arithmetic.ts";
import { WordImpl } from "./word.ts";
import {
  CH_TAB,
  CH_NL,
  CH_SPACE,
  CH_BANG,
  CH_DQUOTE,
  CH_HASH,
  CH_DOLLAR,
  CH_PERCENT,
  CH_AMP,
  CH_SQUOTE,
  CH_LPAREN,
  CH_RPAREN,
  CH_STAR,
  CH_PLUS,
  CH_COMMA,
  CH_DASH,
  CH_SLASH,
  CH_0,
  CH_9,
  CH_COLON,
  CH_SEMI,
  CH_LT,
  CH_EQ,
  CH_GT,
  CH_QUESTION,
  CH_AT,
  CH_A,
  CH_Z,
  CH_LBRACKET,
  CH_BACKSLASH,
  CH_RBRACKET,
  CH_CARET,
  CH_UNDERSCORE,
  CH_BACKTICK,
  CH_a,
  CH_z,
  CH_LBRACE,
  CH_PIPE,
  CH_RBRACE,
} from "./chars.ts";

export const Token = {
  Word: 0,
  Assignment: 1,
  Semi: 2,
  Newline: 3,
  Pipe: 4,
  And: 5,
  Or: 6,
  Amp: 7,
  LParen: 8,
  RParen: 9,
  LBrace: 10,
  RBrace: 11,
  Bang: 12,
  If: 13,
  Then: 14,
  Else: 15,
  Elif: 16,
  Fi: 17,
  Do: 18,
  Done: 19,
  For: 20,
  While: 21,
  Until: 22,
  In: 23,
  Case: 24,
  Esac: 25,
  Function: 26,
  DoubleSemi: 27,
  SemiAmp: 28,
  DoubleSemiAmp: 29,
  Select: 30,
  DblLBracket: 31,
  DblRBracket: 32,
  EOF: 33,
  ArithCmd: 34,
  Coproc: 35,
  Redirect: 36,
} as const;

export type Token = (typeof Token)[keyof typeof Token];

export class TokenValue {
  token: Token = Token.EOF;
  value: string = "";
  pos: number = 0;
  end: number = 0;
  fileDescriptor?: number = undefined;
  variableName?: string = undefined;
  content?: string = undefined;
  targetPos = 0;
  targetEnd = 0;

  reset(): void {
    this.token = Token.EOF;
    this.value = "";
    this.pos = 0;
    this.end = 0;
    this.fileDescriptor = undefined;
    this.variableName = undefined;
    this.content = undefined;
    this.targetPos = 0;
    this.targetEnd = 0;
  }

  copyFrom(other: TokenValue): void {
    this.token = other.token;
    this.value = other.value;
    this.pos = other.pos;
    this.end = other.end;
    this.fileDescriptor = other.fileDescriptor;
    this.variableName = other.variableName;
    this.content = other.content;
    this.targetPos = other.targetPos;
    this.targetEnd = other.targetEnd;
  }
}

const RESERVED_WORDS: Record<string, Token> = {
  if: Token.If,
  then: Token.Then,
  else: Token.Else,
  elif: Token.Elif,
  fi: Token.Fi,
  do: Token.Do,
  done: Token.Done,
  for: Token.For,
  while: Token.While,
  until: Token.Until,
  in: Token.In,
  case: Token.Case,
  esac: Token.Esac,
  function: Token.Function,
  select: Token.Select,
  coproc: Token.Coproc,
  "!": Token.Bang,
  "{": Token.LBrace,
  "}": Token.RBrace,
};

// Combined character type table — bit 0: metachar, bit 1: word-special
const charType = new Uint8Array(128);
charType[CH_PIPE] = 1;
charType[CH_AMP] = 1;
charType[CH_SEMI] = 1;
charType[CH_LPAREN] = 1;
charType[CH_RPAREN] = 1;
charType[CH_LT] = 1;
charType[CH_GT] = 1;
charType[CH_SPACE] = 1;
charType[CH_TAB] = 1;
charType[CH_NL] = 1;
charType[CH_BACKSLASH] = 2;
charType[CH_SQUOTE] = 2;
charType[CH_DQUOTE] = 2;
charType[CH_DOLLAR] = 2;
charType[CH_BACKTICK] = 2;
charType[CH_LBRACE] = 2;

function findUnnested(s: string, target: number): number {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === CH_BACKSLASH) {
      i++;
      continue;
    }
    if (c === CH_LBRACE) {
      depth++;
      continue;
    }
    if (c === CH_RBRACE) {
      if (depth > 0) depth--;
      continue;
    }
    if (c === CH_SQUOTE) {
      i++;
      while (i < s.length && s.charCodeAt(i) !== CH_SQUOTE) i++;
      continue;
    }
    if (c === CH_DQUOTE) {
      i++;
      while (i < s.length && s.charCodeAt(i) !== CH_DQUOTE) {
        if (s.charCodeAt(i) === CH_BACKSLASH) i++;
        i++;
      }
      continue;
    }
    if (c === target && depth === 0) return i;
  }
  return -1;
}

// Lookup: identifier chars (a-z, A-Z, 0-9, _) — bit 0: start, bit 1: continue
const isIdChar = new Uint8Array(128);
for (let i = CH_a; i <= CH_z; i++) isIdChar[i] = 3;
for (let i = CH_A; i <= CH_Z; i++) isIdChar[i] = 3;
for (let i = CH_0; i <= CH_9; i++) isIdChar[i] = 2;
isIdChar[CH_UNDERSCORE] = 3;

const extglobPrefix = new Uint8Array(128);
extglobPrefix[CH_QUESTION] = 1;
extglobPrefix[CH_AT] = 1;
extglobPrefix[CH_STAR] = 1;
extglobPrefix[CH_PLUS] = 1;
extglobPrefix[CH_BANG] = 1;
extglobPrefix[CH_EQ] = 1;

const extglobOp: Record<number, ExtGlobOperator> = {
  [CH_QUESTION]: "?",
  [CH_AT]: "@",
  [CH_STAR]: "*",
  [CH_PLUS]: "+",
  [CH_BANG]: "!",
};

function isDQChild(p: WordPart): p is DoubleQuotedChild {
  const t = p.type;
  return (
    t === "Literal" ||
    t === "SimpleExpansion" ||
    t === "ParameterExpansion" ||
    t === "CommandExpansion" ||
    t === "ArithmeticExpansion"
  );
}

function isAllDigits(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < CH_0 || c > CH_9) return false;
  }
  return text.length > 0;
}

function isAssignmentWord(text: string): boolean {
  const eqIdx = text.indexOf("=");
  if (eqIdx <= 0) return false;
  let c = text.charCodeAt(0);
  if (c >= 128 || !(isIdChar[c] & 1)) return false;
  let i = 1;
  for (; i < eqIdx; i++) {
    c = text.charCodeAt(i);
    if (c >= 128 || !(isIdChar[c] & 2)) break;
  }
  if (i === eqIdx) return true;
  // name+=value
  if (c === CH_PLUS && i + 1 === eqIdx) return true;
  // name[index]=value or name[index]+=value
  if (c === CH_LBRACKET) {
    const rbIdx = text.indexOf("]", i + 1);
    if (rbIdx > i && (rbIdx + 1 === eqIdx || (text.charCodeAt(rbIdx + 1) === CH_PLUS && rbIdx + 2 === eqIdx)))
      return true;
  }
  return false;
}

interface PendingHereDoc {
  delimiter: string;
  strip: boolean;
  quoted: boolean;
  target?: { content?: string; heredocQuoted?: boolean; body?: Word };
}

function setToken(out: TokenValue, token: Token, value: string, pos: number = 0, end: number = 0): void {
  out.token = token;
  out.value = value;
  out.pos = pos;
  out.end = end;
  out.fileDescriptor = undefined;
  out.variableName = undefined;
  out.content = undefined;
}

export const LexContext = {
  Normal: 0,
  CommandStart: 1,
  TestMode: 2,
} as const;
export type LexContext = (typeof LexContext)[keyof typeof LexContext];

function scanBraceExpansion(src: string, pos: number, len: number): number {
  const nextCh = pos + 1 < len ? src.charCodeAt(pos + 1) : 0;
  if (nextCh <= CH_SPACE || nextCh === CH_RBRACE) return -1;
  let depth = 1;
  let hasSep = false;
  let scanPos = pos + 1;
  while (scanPos < len && depth > 0) {
    const bc = src.charCodeAt(scanPos);
    if (bc === CH_LBRACE) depth++;
    else if (bc === CH_RBRACE) {
      if (--depth === 0) break;
    } else if (bc <= CH_SPACE || bc === CH_SEMI || bc === CH_PIPE || bc === CH_AMP) return -1;
    else if (
      depth === 1 &&
      (bc === 0x2c /* , */ || (bc === 0x2e /* . */ && scanPos + 1 < len && src.charCodeAt(scanPos + 1) === 0x2e))
    )
      hasSep = true;
    if (bc === CH_BACKSLASH) scanPos++;
    scanPos++;
  }
  if (depth === 0 && hasSep) return scanPos + 1;
  return -1;
}

export class Lexer {
  private src: string;
  private pos: number;
  private current: TokenValue;
  private nextState: TokenValue;
  private hasPeek: boolean;
  private pendingHereDocs: PendingHereDoc[];
  private collectedExpansions: DeferredCommandExpansion[];
  _errors: ParseError[] | null = null;
  _buildParts = false;

  constructor(src: string) {
    this.src = src;
    this.pos = 0;
    this.current = new TokenValue();
    this.nextState = new TokenValue();
    this.hasPeek = false;
    this.pendingHereDocs = [];
    this.collectedExpansions = [];

    if (src.charCodeAt(0) === CH_HASH && src.charCodeAt(1) === CH_BANG) {
      const nl = src.indexOf("\n");
      this.pos = nl === -1 ? src.length : nl + 1;
    }
  }

  get errors(): ParseError[] {
    return this._errors ?? (this._errors = []);
  }

  getCollectedExpansions(): DeferredCommandExpansion[] {
    return this.collectedExpansions;
  }

  getPos(): number {
    return this.pos;
  }

  /** Set position and scan a word, building parts. Used by computeWordParts. */
  buildWordParts(startPos: number): WordPart[] | null {
    this._buildParts = true;
    this.pos = startPos;
    // Handle process substitution words <(...) and >(...)
    const ch = this.src.charCodeAt(startPos);
    if (
      (ch === 0x3c /* < */ || ch === 0x3e) /* > */ &&
      startPos + 1 < this.src.length &&
      this.src.charCodeAt(startPos + 1) === 0x28 /* ( */
    ) {
      this.pos = startPos + 2;
      const inner = this.extractBalanced();
      const text = this.src.slice(startPos, this.pos);
      const part: import("./types.ts").ProcessSubstitutionPart = {
        type: "ProcessSubstitution",
        text,
        operator: ch === 0x3c ? "<" : ">",
        script: undefined,
        inner: inner ?? undefined,
      };
      const exp: DeferredCommandExpansion = { inner: inner ?? undefined, _part: part };
      this.collectedExpansions.push(exp);
      // Continue reading any trailing word text (e.g., suffix after proc sub)
      if (this.pos < this.src.length) {
        this.readWordText();
        if (this._wordParts) {
          this._wordParts.unshift(part);
        } else {
          this._wordParts = [part];
        }
      } else {
        this._wordParts = [part];
      }
    } else {
      this.readWordText();
    }
    return this._wordParts;
  }

  /** Scan a heredoc body for expansions, building parts. Spaces/newlines are literal. */
  buildHereDocParts(bodyPos: number, bodyEnd: number): WordPart[] | null {
    this._buildParts = true;
    const src = this.src;
    const parts: WordPart[] = [];
    let litBuf = "";
    let litStart = bodyPos;
    let i = bodyPos;

    const flushLit = () => {
      if (litBuf) {
        parts.push({ type: "Literal", value: litBuf, text: src.slice(litStart, i) });
        litBuf = "";
      }
    };

    while (i < bodyEnd) {
      const ch = src.charCodeAt(i);

      if (ch === 0x5c /* \\ */) {
        // Backslash escape — in unquoted heredoc, \\$, \\`, \\\\ are special
        if (i + 1 < bodyEnd) {
          const nc = src.charCodeAt(i + 1);
          if (nc === 0x24 /* $ */ || nc === 0x60 /* ` */ || nc === 0x5c /* \\ */) {
            litBuf += String.fromCharCode(nc);
            i += 2;
            continue;
          }
        }
        litBuf += "\\";
        i++;
        continue;
      }

      if (ch === 0x24 /* $ */) {
        flushLit();
        litStart = i;
        this.pos = i;
        this.readDollar();
        if (this._resultPart) {
          parts.push(this._resultPart);
          litStart = this.pos;
        } else {
          litBuf += src.slice(i, this.pos);
        }
        i = this.pos;
        continue;
      }

      if (ch === 0x60 /* ` */) {
        flushLit();
        litStart = i;
        this.pos = i;
        this.readBacktickExpansion();
        if (this._resultPart) {
          parts.push(this._resultPart);
          litStart = this.pos;
        } else {
          litBuf += src.slice(i, this.pos);
        }
        i = this.pos;
        continue;
      }

      litBuf += src[i];
      i++;
    }

    flushLit();
    return parts.length > 1 || (parts.length === 1 && parts[0].type !== "Literal") ? parts : null;
  }

  registerHereDocTarget(target: { content?: string; heredocQuoted?: boolean; body?: Word }): void {
    for (const hd of this.pendingHereDocs) {
      if (!hd.target) {
        hd.target = target;
        return;
      }
    }
  }

  // Read the right-hand operand of =~ in [[ ]]. Parentheses and pipe are not
  // metacharacters in regex patterns, so we temporarily clear their charType
  // entries so that readWord's fast/slow path treats them as plain chars.
  readTestRegexWord(): TokenValue {
    this.hasPeek = false;
    const chars = [CH_LPAREN, CH_RPAREN, CH_PIPE, CH_LT, CH_GT];
    const saved = chars.map((c) => charType[c]);
    for (const c of chars) charType[c] = 0;
    try {
      this.skipSpacesAndTabs();
      this.readWord(this.current, LexContext.Normal, this.pos);
      return this.current;
    } finally {
      for (let i = 0; i < chars.length; i++) charType[chars[i]] = saved[i];
    }
  }

  // Read C-style for expressions: called after first '(' consumed by parser.
  // Expects pos at second '('. Returns [init, test, update] raw text.
  readCStyleForExprs(): [string, string, string, number, number, number] {
    this.hasPeek = false; // discard any peeked token
    const src = this.src;
    const len = src.length;
    // Skip spaces to second '('
    while (this.pos < len && (src.charCodeAt(this.pos) === CH_SPACE || src.charCodeAt(this.pos) === CH_TAB)) this.pos++;
    if (this.pos < len && src.charCodeAt(this.pos) === CH_LPAREN) this.pos++;
    const starts: [number, number, number] = [this.pos, 0, 0];
    const parts: [string, string, string, number, number, number] = ["", "", "", 0, 0, 0];
    let partIdx = 0;
    let depth = 1;
    let partStart = this.pos;
    while (this.pos < len && depth > 0) {
      const c = src.charCodeAt(this.pos);
      if (c === CH_LPAREN) {
        depth++;
        this.pos++;
      } else if (c === CH_RPAREN) {
        depth--;
        if (depth === 0) {
          const raw = src.slice(partStart, this.pos);
          parts[partIdx] = raw.trim();
          parts[3 + partIdx] = starts[partIdx] + raw.length - raw.trimStart().length;
          this.pos++; // skip closing )
          // Skip the outer ) as well
          while (this.pos < len && (src.charCodeAt(this.pos) === CH_SPACE || src.charCodeAt(this.pos) === CH_TAB))
            this.pos++;
          if (this.pos < len && src.charCodeAt(this.pos) === CH_RPAREN) this.pos++;
          break;
        }
        this.pos++;
      } else if (c === CH_SEMI && depth === 1) {
        const raw = src.slice(partStart, this.pos);
        parts[partIdx] = raw.trim();
        parts[3 + partIdx] = starts[partIdx] + raw.length - raw.trimStart().length;
        if (partIdx < 2) partIdx++;
        this.pos++;
        partStart = this.pos;
        starts[partIdx] = partStart;
      } else if (c === CH_SQUOTE) {
        this.pos++;
        this.skipSQ();
      } else if (c === CH_DQUOTE) {
        this.pos++;
        this.skipDQ();
      } else {
        this.pos++;
      }
    }
    return parts;
  }

  peek(ctx: LexContext = LexContext.Normal): TokenValue {
    if (!this.hasPeek) {
      this.readNext(this.nextState, ctx);
      this.hasPeek = true;
    }
    return this.nextState;
  }

  next(ctx: LexContext = LexContext.Normal): TokenValue {
    if (this.hasPeek) {
      this.hasPeek = false;
      const temp = this.current;
      this.current = this.nextState;
      this.nextState = temp;
      return this.current;
    }
    this.readNext(this.current, ctx);
    return this.current;
  }

  unshift(tok: TokenValue): void {
    this.nextState.copyFrom(tok);
    this.hasPeek = true;
  }

  private readNext(out: TokenValue, ctx: LexContext): void {
    const src = this.src;
    const len = src.length;

    // Skip spaces and tabs (inlined for hot path)
    let pos = this.pos;
    while (pos < len) {
      const ch = src.charCodeAt(pos);
      if (ch === CH_SPACE || ch === CH_TAB) {
        pos++;
        continue;
      }
      if (ch === CH_BACKSLASH && pos + 1 < len && src.charCodeAt(pos + 1) === CH_NL) {
        pos += 2;
        continue;
      }
      // Inside [[ ]], newlines are whitespace
      if (ch === CH_NL && ctx === LexContext.TestMode) {
        pos++;
        continue;
      }
      break;
    }
    this.pos = pos;

    if (pos >= len) {
      setToken(out, Token.EOF, "", pos, pos);
      return;
    }

    const tokenStart = pos;
    const ch = src.charCodeAt(pos);

    if (ch === CH_HASH) {
      // Skip comment
      while (this.pos < len && src.charCodeAt(this.pos) !== CH_NL) this.pos++;
      this.readNext(out, ctx);
      return;
    }

    if (ch === CH_NL) {
      this.pos++;
      this.consumePendingHereDocs();
      setToken(out, Token.Newline, "\n", tokenStart, this.pos);
      return;
    }

    // In test mode (inside [[ ]]), < and > are string comparison operators, not redirects
    if (ctx === LexContext.TestMode && (ch === CH_LT || ch === CH_GT)) {
      this.pos++;
      setToken(out, Token.Word, ch === CH_LT ? "<" : ">", tokenStart, this.pos);
      return;
    }

    if (this.tryReadOperator(out, ch, ctx, tokenStart)) return;

    this.readWord(out, ctx, tokenStart);
  }

  private tryReadOperator(out: TokenValue, ch: number, ctx: LexContext, tokenStart: number): boolean {
    const src = this.src;
    const pos = this.pos;
    const next = pos + 1 < src.length ? src.charCodeAt(pos + 1) : 0;

    switch (ch) {
      case CH_SEMI:
        if (next === CH_SEMI) {
          if (pos + 2 < src.length && src.charCodeAt(pos + 2) === CH_AMP) {
            this.pos += 3;
            setToken(out, Token.DoubleSemiAmp, ";;&", tokenStart, this.pos);
            return true;
          }
          this.pos += 2;
          setToken(out, Token.DoubleSemi, ";;", tokenStart, this.pos);
          return true;
        }
        if (next === CH_AMP) {
          this.pos += 2;
          setToken(out, Token.SemiAmp, ";&", tokenStart, this.pos);
          return true;
        }
        this.pos++;
        setToken(out, Token.Semi, ";", tokenStart, this.pos);
        return true;
      case CH_PIPE:
        if (next === CH_PIPE) {
          this.pos += 2;
          setToken(out, Token.Or, "||", tokenStart, this.pos);
          return true;
        }
        if (next === CH_AMP) {
          this.pos += 2;
          setToken(out, Token.Pipe, "|&", tokenStart, this.pos);
          return true;
        } // |& → pipe (stderr merge)
        this.pos++;
        setToken(out, Token.Pipe, "|", tokenStart, this.pos);
        return true;
      case CH_AMP:
        if (next === CH_AMP) {
          this.pos += 2;
          setToken(out, Token.And, "&&", tokenStart, this.pos);
          return true;
        }
        if (next === CH_GT) {
          // &> or &>> — redirect, not background
          this.pos += 2;
          const append = this.pos < src.length && src.charCodeAt(this.pos) === CH_GT;
          if (append) this.pos++;
          this.skipSpacesAndTabs();
          this._redirectTargetPos = this.pos;
          if (this.pos < src.length && src.charCodeAt(this.pos) !== CH_NL) this.readWordText();
          this.redirectToken(out, append ? "&>>" : "&>", tokenStart);
          return true;
        }
        this.pos++;
        setToken(out, Token.Amp, "&", tokenStart, this.pos);
        return true;
      case CH_LPAREN:
        if (ctx === LexContext.CommandStart && next === CH_LPAREN) {
          this.readArithmeticCommand(out, tokenStart);
          return true;
        }
        this.pos++;
        setToken(out, Token.LParen, "(", tokenStart, this.pos);
        return true;
      case CH_RPAREN:
        this.pos++;
        setToken(out, Token.RParen, ")", tokenStart, this.pos);
        return true;
      case CH_LT:
      case CH_GT:
        return this.readRedirection(out, tokenStart);
      default:
        return false;
    }
  }

  private readRedirection(out: TokenValue, tokenStart: number): boolean {
    const src = this.src;
    const ch = src.charCodeAt(this.pos);
    let op = "";

    if (ch === CH_LT) {
      this.pos++;
      const next = this.pos < src.length ? src.charCodeAt(this.pos) : 0;
      if (next === CH_LT) {
        this.pos++;
        const third = this.pos < src.length ? src.charCodeAt(this.pos) : 0;
        if (third === CH_LT) {
          // <<< herestring
          this.pos++;
          this.skipSpacesAndTabs();
          this._redirectTargetPos = this.pos;
          if (this.pos < src.length && src.charCodeAt(this.pos) !== CH_NL) this.readWordText();
          this.redirectToken(out, "<<<", tokenStart);
          return true;
        }
        const dash = third === CH_DASH;
        if (dash) this.pos++;
        this.skipSpacesAndTabs();
        this.readHereDocDelimiter();
        this.pendingHereDocs.push({ delimiter: this._hereDelim, strip: dash, quoted: this._hereQuoted });
        setToken(out, Token.Redirect, dash ? "<<-" : "<<", tokenStart, this.pos);
        out.content = this._hereDelim;
        return true;
      }
      if (next === CH_LPAREN) {
        this.readProcessSubstitution(out, "<", tokenStart);
        return true;
      }
      if (next === CH_GT) {
        op = "<>";
        this.pos++;
      } else if (next === CH_AMP) {
        op = "<&";
        this.pos++;
      } else {
        op = "<";
      }
    } else if (ch === CH_GT) {
      this.pos++;
      const next = this.pos < src.length ? src.charCodeAt(this.pos) : 0;
      if (next === CH_LPAREN) {
        this.readProcessSubstitution(out, ">", tokenStart);
        return true;
      }
      if (next === CH_GT) {
        op = ">>";
        this.pos++;
      } else if (next === CH_AMP) {
        op = ">&";
        this.pos++;
      } else if (next === CH_PIPE) {
        op = ">|";
        this.pos++;
      } else {
        op = ">";
      }
    }

    this.skipSpacesAndTabs();
    if (this.pos < src.length) {
      const nc = src.charCodeAt(this.pos);
      if ((nc === CH_LT || nc === CH_GT) && this.pos + 1 < src.length && src.charCodeAt(this.pos + 1) === CH_LPAREN) {
        const psStart = this.pos;
        this.pos += 2;
        this.extractBalanced();
        const psText = src.slice(psStart, this.pos);
        setToken(out, Token.Redirect, op, tokenStart, this.pos);
        out.content = psText;
        out.targetPos = psStart;
        out.targetEnd = this.pos;
        return true;
      }
      this._redirectTargetPos = this.pos;
      if (nc !== CH_NL) this.readWordText();
    }

    this.redirectToken(out, op, tokenStart);
    return true;
  }

  private redirectToken(out: TokenValue, operator: string, tokenStart: number): void {
    setToken(out, Token.Redirect, operator, tokenStart, this.pos);
    out.content = this._wordText;
    out.targetPos = this._redirectTargetPos;
    out.targetEnd = this.pos;
  }

  private readProcessSubstitution(out: TokenValue, operator: "<" | ">", tokenStart: number): void {
    this.pos++; // skip (
    this.extractBalanced();
    const text = this.src.slice(tokenStart, this.pos);
    setToken(out, Token.Word, text, tokenStart, this.pos);
  }

  private readHereDocDelimiter(): void {
    const src = this.src;
    const len = src.length;
    let delimiter = "";

    if (this.pos < len && src.charCodeAt(this.pos) === CH_SQUOTE) {
      this.pos++;
      const start = this.pos;
      while (this.pos < len && src.charCodeAt(this.pos) !== CH_SQUOTE) this.pos++;
      delimiter = src.slice(start, this.pos);
      if (this.pos < len) this.pos++;
      this._hereDelim = delimiter;
      this._hereQuoted = true;
      return;
    } else if (this.pos < len && src.charCodeAt(this.pos) === CH_DQUOTE) {
      this.pos++;
      while (this.pos < len && src.charCodeAt(this.pos) !== CH_DQUOTE) {
        if (src.charCodeAt(this.pos) === CH_BACKSLASH) this.pos++;
        delimiter += src[this.pos];
        this.pos++;
      }
      if (this.pos < len) this.pos++;
      this._hereDelim = delimiter;
      this._hereQuoted = true;
      return;
    } else if (this.pos < len && src.charCodeAt(this.pos) === CH_BACKSLASH) {
      while (this.pos < len) {
        const c = src.charCodeAt(this.pos);
        if (c < 128 && charType[c] & 1) break;
        if (c === CH_BACKSLASH) this.pos++;
        if (this.pos < len) {
          delimiter += src[this.pos];
          this.pos++;
        }
      }
      this._hereDelim = delimiter;
      this._hereQuoted = true;
      return;
    } else {
      const start = this.pos;
      while (this.pos < len) {
        const c = src.charCodeAt(this.pos);
        if (c < 128 && charType[c] & 1) break;
        this.pos++;
      }
      this._hereDelim = src.slice(start, this.pos);
      this._hereQuoted = false;
    }
  }

  private consumePendingHereDocs(): void {
    for (const hd of this.pendingHereDocs) {
      const bodyPos = this.pos;
      const body = this.readHereDocBody(hd.delimiter, hd.strip);
      if (hd.target) {
        hd.target.content = body;
        if (hd.quoted) {
          hd.target.heredocQuoted = true;
        } else if (body) {
          const parsed = this.parseHereDocBody(body, bodyPos);
          if (parsed) hd.target.body = parsed;
        }
      }
    }
    this.pendingHereDocs.length = 0;
  }

  private readHereDocBody(delimiter: string, strip: boolean): string {
    const src = this.src;
    const len = src.length;
    const dLen = delimiter.length;
    const bodyStart = this.pos;
    while (this.pos < len) {
      let lineStart = this.pos;
      let lineEnd = src.indexOf("\n", this.pos);
      if (lineEnd === -1) lineEnd = len;

      if (strip) {
        while (lineStart < lineEnd && src.charCodeAt(lineStart) === CH_TAB) lineStart++;
      }

      if (lineEnd - lineStart === dLen && src.startsWith(delimiter, lineStart)) {
        const body = src.slice(bodyStart, this.pos);
        this.pos = lineEnd < len ? lineEnd + 1 : lineEnd;
        return body;
      }

      this.pos = lineEnd < len ? lineEnd + 1 : lineEnd;
    }
    return src.slice(bodyStart, this.pos);
  }

  // Scan an unquoted heredoc body for expansions ($var, ${...}, $(...), `...`).
  // Returns a Word (without parts — use computeWordParts for those) if expansions exist.
  private parseHereDocBody(body: string, bodyPos: number): Word | null {
    // Quick scan: if no $ or backtick, no expansions possible
    let hasExpansion = false;
    for (let i = 0; i < body.length; i++) {
      const c = body.charCodeAt(i);
      if (c === CH_BACKTICK) {
        hasExpansion = true;
        break;
      }
      if (c === CH_DOLLAR) {
        // Check next char — bare $ at end or before space/newline is literal
        const next = i + 1 < body.length ? body.charCodeAt(i + 1) : 0;
        if (
          next === CH_LBRACE ||
          next === CH_LPAREN ||
          next === CH_DOLLAR ||
          (next >= CH_a && next <= CH_z) ||
          (next >= CH_A && next <= CH_Z) ||
          next === CH_UNDERSCORE ||
          next === CH_BANG ||
          next === CH_HASH ||
          next === CH_AT ||
          next === CH_STAR ||
          next === CH_QUESTION ||
          next === CH_DASH ||
          (next >= CH_0 && next <= CH_9)
        ) {
          hasExpansion = true;
          break;
        }
      }
      if (c === CH_BACKSLASH) i++; // skip escaped char
    }
    if (!hasExpansion) return null;
    return new WordImpl(body, bodyPos, bodyPos + body.length);
  }

  private _wordText = "";
  private _wordQuoted = false;
  private _wordHasExpansions = false;
  _wordParts: WordPart[] | null = null;
  private _redirectTargetPos = 0;
  private _resultText = "";
  private _resultHasExpansion = false;
  private _resultPart: WordPart | undefined;
  private _dqText = "";
  private _dqHasExpansions = false;
  private _dqParts: DoubleQuotedChild[] | null = null;
  private _hereDelim = "";
  private _hereQuoted = false;

  private readWord(out: TokenValue, ctx: LexContext, tokenStart: number = 0): void {
    this.readWordText();
    const text = this._wordText;
    const hasExpansions = this._wordHasExpansions;
    const quoted = this._wordQuoted;
    const wordEnd = this.pos;

    if (ctx === LexContext.CommandStart) {
      if (!hasExpansions && !quoted) {
        const fc = text.charCodeAt(0);
        if (
          ((fc >= CH_a && fc <= CH_z && text.length <= 8) || fc === CH_BANG || fc === CH_LBRACE || fc === CH_RBRACE) &&
          text in RESERVED_WORDS
        ) {
          setToken(out, RESERVED_WORDS[text], text, tokenStart, wordEnd);
          return;
        }
        if (fc === CH_LBRACKET && text === "[[") {
          setToken(out, Token.DblLBracket, text, tokenStart, wordEnd);
          return;
        }
      }
      if (isAssignmentWord(text)) {
        setToken(out, Token.Assignment, text, tokenStart, wordEnd);
        return;
      }
    }
    if (!hasExpansions && !quoted && text === "]]") {
      setToken(out, Token.DblRBracket, text, tokenStart, wordEnd);
      return;
    }

    // FD number prefix: all-digit word followed by < or > → redirect with fd
    if (!hasExpansions && this.pos < this.src.length) {
      const nc = this.src.charCodeAt(this.pos);
      if (nc === CH_LT || nc === CH_GT) {
        if (text.charCodeAt(0) >= CH_0 && text.charCodeAt(0) <= CH_9 && isAllDigits(text)) {
          const fd = Number.parseInt(text, 10);
          if (this.readRedirection(out, tokenStart)) {
            out.fileDescriptor = fd;
            return;
          }
        }
        if (text.charCodeAt(0) === CH_LBRACE && text.charCodeAt(text.length - 1) === CH_RBRACE && text.length > 2) {
          const varname = text.slice(1, -1);
          if (this.readRedirection(out, tokenStart)) {
            out.variableName = varname;
            return;
          }
        }
      }
    }

    setToken(out, Token.Word, text, tokenStart, wordEnd);
  }

  private readWordText(): void {
    const src = this.src;
    const len = src.length;
    let pos = this.pos;

    // Fast path: scan a single run of plain chars (covers most words)
    const fastStart = pos;
    while (pos < len) {
      const c = src.charCodeAt(pos);
      if (c < 128 && charType[c]) break;
      pos++;
    }
    const exitCh = pos < len ? src.charCodeAt(pos) : 0;
    if (
      pos >= len ||
      (charType[exitCh] & 1 && !(exitCh === CH_LPAREN && pos > fastStart && extglobPrefix[src.charCodeAt(pos - 1)]))
    ) {
      this.pos = pos;
      this._wordText = pos > fastStart ? src.slice(fastStart, pos) : "";
      this._wordQuoted = false;
      this._wordHasExpansions = false;
      if (this._buildParts) this._wordParts = null;
      return;
    }

    // Slow path: word contains quotes, expansions, escapes, etc.
    let text = pos > fastStart ? src.slice(fastStart, pos) : "";
    let quoted = false;
    let hasExpansions = false;
    const bp = this._buildParts;
    let parts: WordPart[] | undefined;
    let litBuf = "";
    let litStart = 0;
    if (bp) {
      parts = [];
      litBuf = text; // fast-path prefix is literal
      litStart = fastStart;
    }

    while (pos < len) {
      const ch = src.charCodeAt(pos);

      if (ch >= 128 || !charType[ch]) {
        const runStart = pos;
        pos++;
        while (pos < len) {
          const c = src.charCodeAt(pos);
          if (c < 128 && charType[c]) break;
          pos++;
        }
        const chunk = src.slice(runStart, pos);
        text += chunk;
        if (bp) litBuf += chunk;
        continue;
      }

      if (charType[ch] & 1) {
        if (ch === CH_LPAREN && text.length > 0 && extglobPrefix[text.charCodeAt(text.length - 1)]) {
          const prefixChar = text.charCodeAt(text.length - 1);
          pos++;
          const innerStart = pos;
          let depth = 1;
          while (pos < len && depth > 0) {
            const c = src.charCodeAt(pos);
            if (c === CH_LPAREN) depth++;
            else if (c === CH_RPAREN) depth--;
            pos++;
          }
          const pattern = src.slice(innerStart, pos - 1); // without closing )
          const eg = "(" + src.slice(innerStart, pos);
          text += eg;
          // Create ExtendedGlob part for real extglob operators (not = which is array assignment)
          if (bp && prefixChar !== CH_EQ) {
            // Remove the prefix char from litBuf (it was appended in the previous iteration)
            if (litBuf.length > 0) {
              const trimmed = litBuf.slice(0, -1);
              if (trimmed) parts!.push({ type: "Literal", value: trimmed, text: src.slice(litStart, innerStart - 2) });
              litBuf = "";
            }
            const op = extglobOp[prefixChar];
            const fullText = op + eg;
            parts!.push({ type: "ExtendedGlob", text: fullText, operator: op, pattern });
            litStart = pos;
          } else if (bp) {
            litBuf += eg;
          }
          continue;
        }
        break;
      }

      if (ch === CH_BACKSLASH) {
        pos++;
        if (pos < len) {
          if (src.charCodeAt(pos) === CH_NL) {
            pos++;
          } else {
            quoted = true;
            const escaped = src[pos++];
            text += escaped;
            if (bp) litBuf += escaped;
          }
        }
        continue;
      }

      if (ch === CH_SQUOTE) {
        const sqStart = pos;
        quoted = true;
        pos++;
        const start = pos;
        while (pos < len && src.charCodeAt(pos) !== CH_SQUOTE) pos++;
        const value = src.slice(start, pos);
        text += value;
        if (pos < len) pos++;
        else this.errors.push({ message: "unterminated single quote", pos: start - 1 });
        if (bp) {
          if (litBuf) {
            parts!.push({ type: "Literal", value: litBuf, text: src.slice(litStart, sqStart) });
            litBuf = "";
          }
          parts!.push({ type: "SingleQuoted", value, text: src.slice(sqStart, pos) });
          litStart = pos;
        }
        continue;
      }

      if (ch === CH_DQUOTE) {
        const dqStart = pos;
        quoted = true;
        pos++;
        this.pos = pos;
        this.readDoubleQuoted();
        pos = this.pos;
        text += this._dqText;
        if (this._dqHasExpansions) hasExpansions = true;
        if (bp) {
          if (litBuf) {
            parts!.push({ type: "Literal", value: litBuf, text: src.slice(litStart, dqStart) });
            litBuf = "";
          }
          const dqText = src.slice(dqStart, pos);
          parts!.push({
            type: "DoubleQuoted",
            text: dqText,
            parts: this._dqParts ?? [{ type: "Literal", value: this._dqText, text: src.slice(dqStart + 1, pos - 1) }],
          });
          litStart = pos;
        }
        continue;
      }

      if (ch === CH_DOLLAR) {
        const dollarStart = pos;
        this.pos = pos;
        this.readDollar();
        pos = this.pos;
        text += this._resultText;
        if (this._resultHasExpansion) hasExpansions = true;
        if (bp) {
          if (this._resultPart) {
            if (litBuf) {
              parts!.push({ type: "Literal", value: litBuf, text: src.slice(litStart, dollarStart) });
              litBuf = "";
            }
            parts!.push(this._resultPart);
            litStart = pos;
          } else {
            litBuf += this._resultText;
          }
        }
        continue;
      }

      if (ch === CH_BACKTICK) {
        const btStart = pos;
        this.pos = pos;
        this.readBacktickExpansion();
        pos = this.pos;
        text += this._resultText;
        hasExpansions = true;
        if (bp) {
          if (litBuf) {
            parts!.push({ type: "Literal", value: litBuf, text: src.slice(litStart, btStart) });
            litBuf = "";
          }
          parts!.push(this._resultPart!);
          litStart = pos;
        }
        continue;
      }

      if (ch === CH_LBRACE) {
        const braceEnd = scanBraceExpansion(src, pos, len);
        if (braceEnd > 0) {
          const braceText = src.slice(pos, braceEnd);
          text += braceText;
          if (bp) {
            if (litBuf) {
              parts!.push({ type: "Literal", value: litBuf, text: src.slice(litStart, pos) });
              litBuf = "";
            }
            parts!.push({ type: "BraceExpansion", text: braceText });
            litStart = braceEnd;
          }
          pos = braceEnd;
          continue;
        }
        text += "{";
        if (bp) litBuf += "{";
        pos++;
        continue;
      }

      pos++;
    }

    if (bp && litBuf) parts!.push({ type: "Literal", value: litBuf, text: src.slice(litStart, pos) });

    this.pos = pos;
    this._wordText = text;
    this._wordQuoted = quoted;
    this._wordHasExpansions = hasExpansions;
    if (bp) {
      // Only store parts if they add structure beyond a single literal
      this._wordParts = parts!.length > 1 || (parts!.length === 1 && parts![0].type !== "Literal") ? parts! : null;
    }
  }

  private readInnerWordText(): void {
    const src = this.src;
    const len = src.length;
    let pos = this.pos;
    let text = "";
    const bp = this._buildParts;
    let parts: WordPart[] | undefined;
    let litBuf = "";
    let litStart = 0;
    if (bp) {
      parts = [];
      litStart = pos;
    }

    while (pos < len) {
      const ch = src.charCodeAt(pos);

      if (ch === CH_BACKSLASH) {
        pos++;
        if (pos < len) {
          if (src.charCodeAt(pos) === CH_NL) {
            pos++;
          } else {
            const escaped = src[pos++];
            text += escaped;
            if (bp) litBuf += escaped;
          }
        }
        continue;
      }

      if (ch === CH_SQUOTE) {
        const sqStart = pos;
        pos++;
        const start = pos;
        while (pos < len && src.charCodeAt(pos) !== CH_SQUOTE) pos++;
        const value = src.slice(start, pos);
        text += value;
        if (pos < len) pos++;
        if (bp) {
          if (litBuf) {
            parts!.push({ type: "Literal", value: litBuf, text: src.slice(litStart, sqStart) });
            litBuf = "";
          }
          parts!.push({ type: "SingleQuoted", value, text: src.slice(sqStart, pos) });
          litStart = pos;
        }
        continue;
      }

      if (ch === CH_DQUOTE) {
        const dqStart = pos;
        pos++;
        this.pos = pos;
        this.readDoubleQuoted();
        pos = this.pos;
        text += this._dqText;
        if (bp) {
          if (litBuf) {
            parts!.push({ type: "Literal", value: litBuf, text: src.slice(litStart, dqStart) });
            litBuf = "";
          }
          const dqText = src.slice(dqStart, pos);
          parts!.push({
            type: "DoubleQuoted",
            text: dqText,
            parts: this._dqParts ?? [{ type: "Literal", value: this._dqText, text: src.slice(dqStart + 1, pos - 1) }],
          });
          litStart = pos;
        }
        continue;
      }

      if (ch === CH_DOLLAR) {
        const dollarStart = pos;
        this.pos = pos;
        this.readDollar();
        pos = this.pos;
        text += this._resultText;
        if (bp) {
          if (this._resultPart) {
            if (litBuf) {
              parts!.push({ type: "Literal", value: litBuf, text: src.slice(litStart, dollarStart) });
              litBuf = "";
            }
            parts!.push(this._resultPart);
            litStart = pos;
          } else {
            litBuf += this._resultText;
          }
        }
        continue;
      }

      if (ch === CH_BACKTICK) {
        const btStart = pos;
        this.pos = pos;
        this.readBacktickExpansion();
        pos = this.pos;
        text += this._resultText;
        if (bp) {
          if (litBuf) {
            parts!.push({ type: "Literal", value: litBuf, text: src.slice(litStart, btStart) });
            litBuf = "";
          }
          parts!.push(this._resultPart!);
          litStart = pos;
        }
        continue;
      }

      text += src[pos];
      if (bp) litBuf += src[pos];
      pos++;
    }

    if (bp && litBuf) parts!.push({ type: "Literal", value: litBuf, text: src.slice(litStart, pos) });

    this.pos = pos;
    this._wordText = text;
    this._wordQuoted = false;
    this._wordHasExpansions = false;
    if (bp) {
      this._wordParts = parts!.length > 1 || (parts!.length === 1 && parts![0].type !== "Literal") ? parts! : null;
    }
  }

  private parseSubFieldWord(s: string): Word {
    if (!s) return new WordImpl("", 0, 0);
    const savedSrc = this.src;
    const savedPos = this.pos;
    const savedText = this._wordText;
    const savedParts = this._wordParts;
    const savedQuoted = this._wordQuoted;

    this.src = s;
    this.pos = 0;
    this.readInnerWordText();

    const word = new WordImpl(this._wordText, 0, 0);
    if (this._buildParts && this._wordParts) {
      word.parts = this._wordParts;
    }

    this.src = savedSrc;
    this.pos = savedPos;
    this._wordText = savedText;
    this._wordParts = savedParts;
    this._wordQuoted = savedQuoted;
    return word;
  }

  private skipSQ(): void {
    while (this.pos < this.src.length && this.src.charCodeAt(this.pos) !== CH_SQUOTE) this.pos++;
    if (this.pos < this.src.length) this.pos++;
  }

  private skipDQ(): void {
    const src = this.src;
    const len = src.length;
    while (this.pos < len) {
      const ch = src.charCodeAt(this.pos);
      if (ch === CH_DQUOTE) {
        this.pos++;
        return;
      }
      if (ch === CH_BACKSLASH) {
        this.pos += 2;
        continue;
      }
      if (ch === CH_DOLLAR && this.pos + 1 < len) {
        const next = src.charCodeAt(this.pos + 1);
        if (next === CH_LPAREN) {
          this.pos += 2;
          this.extractBalanced();
          continue;
        }
        if (next === CH_LBRACE) {
          this.pos += 2;
          let d = 1;
          while (this.pos < len && d > 0) {
            const c = src.charCodeAt(this.pos);
            if (c === CH_RBRACE) {
              if (--d === 0) {
                this.pos++;
                break;
              }
            } else if (c === CH_LBRACE && this.pos > 0 && src.charCodeAt(this.pos - 1) === CH_DOLLAR) d++;
            else if (c === CH_BACKSLASH) {
              this.pos++;
            } else if (c === CH_SQUOTE) {
              this.pos++;
              this.skipSQ();
              continue;
            } else if (c === CH_DQUOTE) {
              this.pos++;
              this.skipDQ();
              continue;
            }
            this.pos++;
          }
          continue;
        }
      }
      if (ch === CH_BACKTICK) {
        this.pos++;
        while (this.pos < len && src.charCodeAt(this.pos) !== CH_BACKTICK) {
          if (src.charCodeAt(this.pos) === CH_BACKSLASH) this.pos++;
          this.pos++;
        }
        if (this.pos < len) this.pos++;
        continue;
      }
      this.pos++;
    }
  }

  private skipSpacesAndTabs(): void {
    const src = this.src;
    const len = src.length;
    while (this.pos < len) {
      const ch = src.charCodeAt(this.pos);
      if (ch === CH_SPACE || ch === CH_TAB) this.pos++;
      else if (ch === CH_BACKSLASH && this.pos + 1 < len && src.charCodeAt(this.pos + 1) === CH_NL) this.pos += 2;
      else break;
    }
  }

  private readDoubleQuoted(): void {
    const src = this.src;
    const len = src.length;
    const contentStart = this.pos;
    let hasExpansions = false;
    const bp = this._buildParts;

    // Fast path: pure literal content (no $, `, or \ — just find closing ")
    if (!bp) {
      let p = this.pos;
      while (p < len) {
        const c = src.charCodeAt(p);
        if (c === CH_DQUOTE) {
          this._dqText = src.slice(contentStart, p);
          this.pos = p + 1;
          this._dqHasExpansions = false;
          this._dqParts = null;
          return;
        }
        if (c === CH_DOLLAR || c === CH_BACKTICK || c === CH_BACKSLASH) break;
        p++;
      }
      // Fall through to general path
    }

    let text = "";
    let parts: DoubleQuotedChild[] | null = null;
    let litBuf = "";
    let litStart = bp ? this.pos : 0;

    while (this.pos < len && src.charCodeAt(this.pos) !== CH_DQUOTE) {
      // Scan run of plain chars inside double quotes
      const runStart = this.pos;
      while (this.pos < len) {
        const c = src.charCodeAt(this.pos);
        if (c === CH_DQUOTE || c === CH_BACKSLASH || c === CH_DOLLAR || c === CH_BACKTICK) break;
        this.pos++;
      }
      if (this.pos > runStart) {
        const chunk = src.slice(runStart, this.pos);
        text += chunk;
        if (bp) litBuf += chunk;
      }

      if (this.pos >= len || src.charCodeAt(this.pos) === CH_DQUOTE) break;

      const ch = src.charCodeAt(this.pos);

      if (ch === CH_BACKSLASH) {
        this.pos++;
        if (this.pos < len) {
          const next = src.charCodeAt(this.pos);
          if (next === CH_NL) {
            this.pos++;
            continue;
          }
          if (next === CH_DOLLAR || next === CH_BACKTICK || next === CH_DQUOTE || next === CH_BACKSLASH) {
            const c = src[this.pos];
            text += c;
            if (bp) litBuf += c;
          } else {
            const pair = "\\" + src[this.pos];
            text += pair;
            if (bp) litBuf += pair;
          }
          this.pos++;
        }
        continue;
      }

      if (ch === CH_DOLLAR) {
        // $" inside double quotes is literal $ followed by closing " (not a locale string)
        if (this.pos + 1 < len && src.charCodeAt(this.pos + 1) === CH_DQUOTE) {
          text += "$";
          if (bp) litBuf += "$";
          this.pos++;
          continue;
        }
        const expStart = this.pos;
        this.readDollar();
        text += this._resultText;
        if (this._resultHasExpansion) hasExpansions = true;
        if (bp) {
          const rp = this._resultPart;
          if (rp && isDQChild(rp)) {
            if (!parts) parts = [];
            if (litBuf) {
              parts.push({ type: "Literal", value: litBuf, text: src.slice(litStart, expStart) });
              litBuf = "";
            }
            parts.push(rp);
            litStart = this.pos;
          } else {
            litBuf += this._resultText;
          }
        }
        continue;
      }

      if (ch === CH_BACKTICK) {
        const btStart = this.pos;
        this.readBacktickExpansion();
        text += this._resultText;
        hasExpansions = true;
        if (bp && this._resultPart && isDQChild(this._resultPart)) {
          if (!parts) parts = [];
          if (litBuf) {
            parts.push({ type: "Literal", value: litBuf, text: src.slice(litStart, btStart) });
            litBuf = "";
          }
          parts.push(this._resultPart);
          litStart = this.pos;
        }
        continue;
      }
    }

    if (bp && parts && litBuf) parts.push({ type: "Literal", value: litBuf, text: src.slice(litStart, this.pos) });

    if (this.pos < len)
      this.pos++; // closing "
    else this.errors.push({ message: "unterminated double quote", pos: contentStart - 1 });
    this._dqText = text;
    this._dqHasExpansions = hasExpansions;
    this._dqParts = parts;
  }

  private readDollar(): void {
    const dollarPos = this.pos;
    this.pos++; // skip $
    const src = this.src;
    const len = src.length;
    if (this.pos >= len) {
      this._resultText = "$";
      this._resultHasExpansion = false;
      this._resultPart = undefined;
      return;
    }

    const ch = src.charCodeAt(this.pos);

    if (ch === CH_LPAREN) {
      if (this.pos + 1 < len && src.charCodeAt(this.pos + 1) === CH_LPAREN) {
        this.readArithmeticExpansion();
        return;
      }
      this.readCommandSubstitution();
      return;
    }

    if (ch === CH_LBRACE) {
      const after = this.pos + 1 < len ? src.charCodeAt(this.pos + 1) : 0;
      if (after === CH_SPACE || after === CH_TAB || after === CH_NL) {
        this.readBraceCommandSubstitution();
        return;
      }
      if (after === CH_PIPE) {
        this.readValueSubstitution();
        return;
      }
      this.readParameterExpansion();
      return;
    }

    if (ch === CH_SQUOTE) {
      this.pos++;
      const value = this.readAnsiCQuoted();
      this._resultText = value;
      this._resultHasExpansion = false;
      this._resultPart = this._buildParts
        ? { type: "AnsiCQuoted", text: src.slice(dollarPos, this.pos), value }
        : undefined;
      return;
    }

    if (ch === CH_DQUOTE) {
      this.pos++;
      this.readDoubleQuoted();
      this._resultText = this._dqText;
      this._resultHasExpansion = this._dqHasExpansions;
      if (this._buildParts) {
        const text = src.slice(dollarPos, this.pos);
        this._resultPart = {
          type: "LocaleString",
          text,
          parts: this._dqParts ?? [
            { type: "Literal", value: this._dqText, text: src.slice(dollarPos + 2, this.pos - 1) },
          ],
        };
      } else {
        this._resultPart = undefined;
      }
      return;
    }

    if (
      ch === CH_AT ||
      ch === CH_STAR ||
      ch === CH_HASH ||
      ch === CH_QUESTION ||
      ch === CH_DASH ||
      ch === CH_DOLLAR ||
      ch === CH_BANG
    ) {
      this.pos++;
      const text = src.slice(this.pos - 2, this.pos);
      this._resultText = text;
      this._resultHasExpansion = false;
      this._resultPart = this._buildParts ? { type: "SimpleExpansion", text } : undefined;
      return;
    }

    if (ch >= CH_0 && ch <= CH_9) {
      this.pos++;
      const text = src.slice(this.pos - 2, this.pos);
      this._resultText = text;
      this._resultHasExpansion = false;
      this._resultPart = this._buildParts ? { type: "SimpleExpansion", text } : undefined;
      return;
    }

    if (ch < 128 && isIdChar[ch] & 1) {
      const dollarPos = this.pos - 1;
      while (this.pos < len) {
        const c = src.charCodeAt(this.pos);
        if (c < 128 && isIdChar[c] & 2) this.pos++;
        else break;
      }
      const text = src.slice(dollarPos, this.pos);
      this._resultText = text;
      this._resultHasExpansion = false;
      this._resultPart = this._buildParts ? { type: "SimpleExpansion", text } : undefined;
      return;
    }

    this._resultText = "$";
    this._resultHasExpansion = false;
    this._resultPart = undefined;
  }

  private scanArithmeticBody(): string {
    this.pos += 2;
    let depth = 1;
    const src = this.src;
    const len = src.length;
    const start = this.pos;
    while (this.pos < len && depth > 0) {
      const c = src.charCodeAt(this.pos);
      if (c === CH_LPAREN && this.pos + 1 < len && src.charCodeAt(this.pos + 1) === CH_LPAREN) {
        depth++;
        this.pos += 2;
      } else if (c === CH_RPAREN && this.pos + 1 < len && src.charCodeAt(this.pos + 1) === CH_RPAREN) {
        if (--depth === 0) {
          this.pos += 2;
          break;
        }
        this.pos += 2;
      } else {
        this.pos++;
      }
    }
    return src.slice(start, this.pos - 2);
  }

  private readArithmeticExpansion(): void {
    const body = this.scanArithmeticBody();
    const text = "$((" + body + "))";
    this._resultText = text;
    this._resultHasExpansion = false;
    if (this._buildParts) {
      const expr = parseArithmeticExpression(body) ?? undefined;
      this._resultPart = { type: "ArithmeticExpansion", text, expression: expr };
    } else {
      this._resultPart = undefined;
    }
  }

  private readArithmeticCommand(out: TokenValue, tokenStart: number): void {
    const body = this.scanArithmeticBody();
    setToken(out, Token.ArithCmd, body, tokenStart, this.pos);
  }

  private readCommandSubstitution(): void {
    const dollarPos = this.pos - 1;
    this.pos++; // skip (
    this.extractBalanced();
    const text = this.src.slice(dollarPos, this.pos);
    this._resultText = text;
    this._resultHasExpansion = true;
    if (this._buildParts) {
      const inner = text.slice(2, -1);
      this._resultPart = { type: "CommandExpansion", text, script: undefined, inner };
      this.collectedExpansions.push({ inner, _part: this._resultPart });
    } else {
      this._resultPart = undefined;
    }
  }

  private readBraceCommandSubstitution(): void {
    this.readBraceSubstitution("${ ", 1);
  }

  private readValueSubstitution(): void {
    this.readBraceSubstitution("${| ", 2);
  }

  private readBraceSubstitution(prefix: string, skip: number): void {
    this.pos += skip;
    const src = this.src;
    const len = src.length;
    let depth = 1;
    const start = this.pos;
    while (this.pos < len) {
      const c = src.charCodeAt(this.pos);
      if (c === CH_LBRACE) depth++;
      else if (c === CH_RBRACE) {
        if (--depth === 0) {
          this.pos++;
          break;
        }
      } else if (c === CH_SQUOTE) {
        this.pos++;
        this.skipSQ();
        continue;
      } else if (c === CH_DQUOTE) {
        this.pos++;
        this.skipDQ();
        continue;
      } else if (c === CH_BACKSLASH) this.pos++;
      this.pos++;
    }
    const inner = src.slice(start, this.pos - 1).trim();
    const text = prefix + inner + " }";
    this._resultText = text;
    this._resultHasExpansion = true;
    if (this._buildParts) {
      this._resultPart = { type: "CommandExpansion", text, script: undefined, inner };
      this.collectedExpansions.push({ inner, _part: this._resultPart });
    } else {
      this._resultPart = undefined;
    }
  }

  private readBacktickExpansion(): void {
    this.pos++; // skip opening `
    const src = this.src;
    const len = src.length;
    let inner = "";
    const start = this.pos;
    let hasEscapes = false;
    while (this.pos < len && src.charCodeAt(this.pos) !== CH_BACKTICK) {
      if (src.charCodeAt(this.pos) === CH_BACKSLASH) {
        hasEscapes = true;
        break;
      }
      this.pos++;
    }

    if (!hasEscapes) {
      inner = src.slice(start, this.pos);
    } else {
      inner = src.slice(start, this.pos);
      while (this.pos < len && src.charCodeAt(this.pos) !== CH_BACKTICK) {
        if (src.charCodeAt(this.pos) === CH_BACKSLASH) {
          this.pos++;
          if (this.pos < len) {
            const c = src.charCodeAt(this.pos);
            if (c === CH_DOLLAR || c === CH_BACKTICK || c === CH_BACKSLASH) {
              inner += src[this.pos];
            } else {
              inner += "\\" + src[this.pos];
            }
            this.pos++;
          }
        } else {
          const runStart = this.pos;
          while (this.pos < len) {
            const c = src.charCodeAt(this.pos);
            if (c === CH_BACKTICK || c === CH_BACKSLASH) break;
            this.pos++;
          }
          inner += src.slice(runStart, this.pos);
        }
      }
    }
    if (this.pos < len)
      this.pos++; // closing `
    else this.errors.push({ message: "unterminated backtick", pos: start - 1 });

    const text = src.slice(start - 1, this.pos); // raw source including backticks
    this._resultText = inner;
    this._resultHasExpansion = true;
    if (this._buildParts) {
      this._resultPart = { type: "CommandExpansion", text, script: undefined, inner };
      this.collectedExpansions.push({ inner, _part: this._resultPart });
    } else {
      this._resultPart = undefined;
    }
  }

  private readParameterExpansion(): void {
    const src = this.src;
    const len = src.length;
    const start = this.pos; // at {
    this.pos++;
    let depth = 1;
    while (this.pos < len && depth > 0) {
      const ch = src.charCodeAt(this.pos);
      if (ch === CH_LBRACE && this.pos > 0 && src.charCodeAt(this.pos - 1) === CH_DOLLAR) depth++;
      else if (ch === CH_RBRACE) {
        if (--depth === 0) {
          this.pos++;
          break;
        }
      } else if (ch === CH_BACKSLASH) {
        this.pos++;
      } else if (ch === CH_SQUOTE) {
        this.pos++;
        this.skipSQ();
        continue;
      } else if (ch === CH_DQUOTE) {
        this.pos++;
        this.skipDQ();
        continue;
      }
      this.pos++;
    }
    const text = src.slice(start - 1, this.pos);
    this._resultText = text;
    this._resultHasExpansion = false;
    if (this._buildParts) {
      const inner = src.slice(start + 1, this.pos - 1);
      this._resultPart = this.parseParamInner(text, inner);
    } else {
      this._resultPart = undefined;
    }
  }

  private parseParamInner(text: string, inner: string): ParameterExpansionPart {
    const result: ParameterExpansionPart = {
      type: "ParameterExpansion",
      text,
      parameter: "",
      index: undefined,
      indirect: undefined,
      length: undefined,
      operator: undefined,
      operand: undefined,
      slice: undefined,
      replace: undefined,
    };
    const ilen = inner.length;
    if (ilen === 0) return result;

    let i = 0;

    // Check for ! prefix (indirect)
    if (inner.charCodeAt(0) === CH_BANG) {
      result.indirect = true;
      i = 1;
    }

    // Check for # prefix (length) — only when not indirect
    if (!result.indirect && inner.charCodeAt(0) === CH_HASH) {
      if (ilen === 1) {
        // ${#} = special variable
        result.parameter = "#";
        return result;
      }
      // ${##...} is always param="#" with operator (bash resolves ambiguity this way)
      if (inner.charCodeAt(1) === CH_HASH) {
        result.parameter = "#";
        i = 1;
      } else {
        // Try as length operator: parse param after #, check if at end
        const tryI = this.scanParamName(inner, 1);
        if (tryI > 1) {
          let endI = tryI;
          if (endI < ilen && inner.charCodeAt(endI) === CH_LBRACKET) {
            const closeB = this.findCloseBracket(inner, endI + 1);
            if (closeB !== -1) endI = closeB + 1;
          }
          if (endI >= ilen) {
            // ${#param} or ${#param[idx]} — length
            result.length = true;
            result.parameter = inner.slice(1, tryI);
            if (tryI < ilen && inner.charCodeAt(tryI) === CH_LBRACKET) {
              const closeB = this.findCloseBracket(inner, tryI + 1);
              if (closeB !== -1) result.index = inner.slice(tryI + 1, closeB);
            }
            return result;
          }
        }
        // Not length — # is the parameter name
        result.parameter = "#";
        i = 1;
      }
    }

    // Parse parameter name if not set yet
    if (!result.parameter) {
      const nameStart = i;
      i = this.scanParamName(inner, i);
      result.parameter = inner.slice(nameStart, i);
    }

    // Check for [index]
    if (i < ilen && inner.charCodeAt(i) === CH_LBRACKET) {
      const closeB = this.findCloseBracket(inner, i + 1);
      if (closeB !== -1) {
        result.index = inner.slice(i + 1, closeB);
        i = closeB + 1;
      }
    }

    // Nothing more → simple expansion
    if (i >= ilen) return result;

    // Determine operator
    const opChar = inner.charCodeAt(i);

    // Colon variants: :-, :=, :+, :? or slice
    if (opChar === CH_COLON) {
      if (i + 1 < ilen) {
        const nc = inner.charCodeAt(i + 1);
        if (nc === CH_DASH || nc === CH_EQ || nc === CH_PLUS || nc === CH_QUESTION) {
          result.operator = inner.slice(i, i + 2);
          result.operand = this.parseSubFieldWord(inner.slice(i + 2));
          return result;
        }
      }
      // Slice: ${var:offset} or ${var:offset:length}
      i++;
      const sliceRest = inner.slice(i);
      const colonIdx = findUnnested(sliceRest, CH_COLON);
      if (colonIdx === -1) {
        result.slice = { offset: this.parseSubFieldWord(sliceRest), length: undefined };
      } else {
        result.slice = {
          offset: this.parseSubFieldWord(sliceRest.slice(0, colonIdx)),
          length: this.parseSubFieldWord(sliceRest.slice(colonIdx + 1)),
        };
      }
      return result;
    }

    // Default/assign/error/alt without colon
    if (opChar === CH_DASH || opChar === CH_EQ || opChar === CH_PLUS || opChar === CH_QUESTION) {
      result.operator = inner[i];
      result.operand = this.parseSubFieldWord(inner.slice(i + 1));
      return result;
    }

    // Prefix strip
    if (opChar === CH_HASH) {
      if (i + 1 < ilen && inner.charCodeAt(i + 1) === CH_HASH) {
        result.operator = "##";
        result.operand = this.parseSubFieldWord(inner.slice(i + 2));
      } else {
        result.operator = "#";
        result.operand = this.parseSubFieldWord(inner.slice(i + 1));
      }
      return result;
    }

    // Suffix strip
    if (opChar === CH_PERCENT) {
      if (i + 1 < ilen && inner.charCodeAt(i + 1) === CH_PERCENT) {
        result.operator = "%%";
        result.operand = this.parseSubFieldWord(inner.slice(i + 2));
      } else {
        result.operator = "%";
        result.operand = this.parseSubFieldWord(inner.slice(i + 1));
      }
      return result;
    }

    // Replacement
    if (opChar === CH_SLASH) {
      i++;
      let replOp = "/";
      if (i < ilen) {
        const nc = inner.charCodeAt(i);
        if (nc === CH_SLASH) {
          replOp = "//";
          i++;
        } else if (nc === CH_HASH) {
          replOp = "/#";
          i++;
        } else if (nc === CH_PERCENT) {
          replOp = "/%";
          i++;
        }
      }
      result.operator = replOp;
      const rest = inner.slice(i);
      const sepIdx = findUnnested(rest, CH_SLASH);
      if (sepIdx === -1) {
        result.replace = {
          pattern: this.parseSubFieldWord(rest),
          replacement: new WordImpl("", 0, 0),
        };
      } else {
        result.replace = {
          pattern: this.parseSubFieldWord(rest.slice(0, sepIdx)),
          replacement: this.parseSubFieldWord(rest.slice(sepIdx + 1)),
        };
      }
      return result;
    }

    // Case modification: ^ ^^ , ,,
    if (opChar === CH_CARET) {
      if (i + 1 < ilen && inner.charCodeAt(i + 1) === CH_CARET) {
        result.operator = "^^";
        const rest = inner.slice(i + 2);
        if (rest) result.operand = this.parseSubFieldWord(rest);
      } else {
        result.operator = "^";
        const rest = inner.slice(i + 1);
        if (rest) result.operand = this.parseSubFieldWord(rest);
      }
      return result;
    }

    if (opChar === CH_COMMA) {
      if (i + 1 < ilen && inner.charCodeAt(i + 1) === CH_COMMA) {
        result.operator = ",,";
        const rest = inner.slice(i + 2);
        if (rest) result.operand = this.parseSubFieldWord(rest);
      } else {
        result.operator = ",";
        const rest = inner.slice(i + 1);
        if (rest) result.operand = this.parseSubFieldWord(rest);
      }
      return result;
    }

    // Transform: @
    if (opChar === CH_AT) {
      result.operator = "@";
      result.operand = this.parseSubFieldWord(inner.slice(i + 1));
      return result;
    }

    // Unknown operator — store remaining as op
    result.operator = inner.slice(i);
    return result;
  }

  private scanParamName(s: string, start: number): number {
    let i = start;
    if (i >= s.length) return i;
    const c = s.charCodeAt(i);
    // Special single-char params
    if (
      c === CH_AT ||
      c === CH_STAR ||
      c === CH_HASH ||
      c === CH_QUESTION ||
      c === CH_DASH ||
      c === CH_DOLLAR ||
      c === CH_BANG
    ) {
      return i + 1;
    }
    // Digits
    if (c >= CH_0 && c <= CH_9) {
      while (i < s.length && s.charCodeAt(i) >= CH_0 && s.charCodeAt(i) <= CH_9) i++;
      return i;
    }
    // Regular name: [a-zA-Z_][a-zA-Z0-9_]*
    if ((c >= CH_a && c <= CH_z) || (c >= CH_A && c <= CH_Z) || c === CH_UNDERSCORE) {
      i++;
      while (i < s.length) {
        const ch = s.charCodeAt(i);
        if (
          (ch >= CH_a && ch <= CH_z) ||
          (ch >= CH_A && ch <= CH_Z) ||
          (ch >= CH_0 && ch <= CH_9) ||
          ch === CH_UNDERSCORE
        )
          i++;
        else break;
      }
    }
    return i;
  }

  private findCloseBracket(s: string, start: number): number {
    let depth = 1;
    for (let i = start; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c === CH_LBRACKET) depth++;
      else if (c === CH_RBRACKET) {
        if (--depth === 0) return i;
      }
    }
    return -1;
  }

  private readAnsiCQuoted(): string {
    const src = this.src;
    const len = src.length;
    let text = "";
    while (this.pos < len && src.charCodeAt(this.pos) !== CH_SQUOTE) {
      if (src.charCodeAt(this.pos) === CH_BACKSLASH && this.pos + 1 < len) {
        this.pos++;
        const ch = src[this.pos];
        switch (ch) {
          case "n":
            text += "\n";
            break;
          case "t":
            text += "\t";
            break;
          case "r":
            text += "\r";
            break;
          case "\\":
            text += "\\";
            break;
          case "'":
            text += "'";
            break;
          case '"':
            text += '"';
            break;
          case "a":
            text += "\x07";
            break;
          case "b":
            text += "\b";
            break;
          case "e":
          case "E":
            text += "\x1B";
            break;
          case "f":
            text += "\f";
            break;
          case "v":
            text += "\v";
            break;
          default:
            text += "\\" + ch;
            break;
        }
        this.pos++;
      } else {
        const runStart = this.pos;
        while (this.pos < len) {
          const c = src.charCodeAt(this.pos);
          if (c === CH_SQUOTE || c === CH_BACKSLASH) break;
          this.pos++;
        }
        text += src.slice(runStart, this.pos);
      }
    }
    if (this.pos < len) this.pos++;
    return text;
  }

  // Extract balanced parens for $(...) — respects nested quotes and case..esac
  private extractBalanced(): string {
    const src = this.src;
    const len = src.length;
    let depth = 1;
    const start = this.pos;

    // Fast path: scan for simple cases with no nested quotes/parens/case
    while (this.pos < len && depth > 0) {
      const c = src.charCodeAt(this.pos);
      if (c === CH_RPAREN) {
        depth--;
        if (depth === 0) {
          const result = src.slice(start, this.pos);
          this.pos++;
          return result;
        }
        this.pos++;
      } else if (c === CH_LPAREN || c === CH_BACKSLASH || c === CH_SQUOTE || c === CH_DQUOTE || c === CH_BACKTICK) {
        break;
      } else if (
        c === 99 /* c */ &&
        // Ensure word start boundary (not inside e.g. "lowercase")
        (this.pos === start || (src.charCodeAt(this.pos - 1) < 128 && charType[src.charCodeAt(this.pos - 1)] !== 0)) &&
        this.pos + 3 < len &&
        src.charCodeAt(this.pos + 1) === 97 /* a */ &&
        src.charCodeAt(this.pos + 2) === 115 /* s */ &&
        src.charCodeAt(this.pos + 3) === 101 /* e */ &&
        (this.pos + 4 >= len || (src.charCodeAt(this.pos + 4) < 128 && charType[src.charCodeAt(this.pos + 4)] & 1))
      ) {
        break;
      } else {
        this.pos++;
      }
    }

    if (depth === 0) return src.slice(start, this.pos);

    // Slow path: just track position (source is copied verbatim, so slice at end)
    let caseDepth = 0;

    while (this.pos < len && depth > 0) {
      const ch = src.charCodeAt(this.pos);
      if (ch === CH_LPAREN) {
        depth++;
        this.pos++;
      } else if (ch === CH_RPAREN) {
        if (caseDepth > 0) {
          this.pos++;
        } else {
          depth--;
          if (depth === 0) {
            const result = src.slice(start, this.pos);
            this.pos++;
            return result;
          }
          this.pos++;
        }
      } else if (ch === CH_BACKSLASH) {
        this.pos++;
        if (this.pos < len) this.pos++;
      } else if (ch === CH_SQUOTE) {
        this.pos++;
        this.skipSQ();
      } else if (ch === CH_DQUOTE) {
        this.pos++;
        this.skipDQ();
      } else if (ch === CH_BACKTICK) {
        this.pos++;
        while (this.pos < len && src.charCodeAt(this.pos) !== CH_BACKTICK) {
          if (src.charCodeAt(this.pos) === CH_BACKSLASH) this.pos++;
          if (this.pos < len) this.pos++;
        }
        if (this.pos < len) this.pos++;
      } else {
        const wStart = this.pos;
        while (this.pos < len) {
          const wc = src.charCodeAt(this.pos);
          if (wc < 128 && charType[wc]) break;
          this.pos++;
        }
        if (this.pos > wStart) {
          const wLen = this.pos - wStart;
          if (wLen === 4) {
            const c0 = src.charCodeAt(wStart);
            if (
              c0 === 99 &&
              src.charCodeAt(wStart + 1) === 97 &&
              src.charCodeAt(wStart + 2) === 115 &&
              src.charCodeAt(wStart + 3) === 101
            ) {
              caseDepth++;
            } else if (
              c0 === 101 &&
              src.charCodeAt(wStart + 1) === 115 &&
              src.charCodeAt(wStart + 2) === 97 &&
              src.charCodeAt(wStart + 3) === 99 &&
              caseDepth > 0
            ) {
              caseDepth--;
            }
          }
        } else {
          this.pos++;
        }
      }
    }
    return src.slice(start, this.pos);
  }
}
