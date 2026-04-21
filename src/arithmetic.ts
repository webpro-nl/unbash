import type { ArithmeticCommandExpansion, ArithmeticExpression } from "./types.ts";
import {
  CH_TAB,
  CH_NL,
  CH_SPACE,
  CH_BANG,
  CH_DOLLAR,
  CH_PERCENT,
  CH_AMP,
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
  CH_LT,
  CH_EQ,
  CH_GT,
  CH_QUESTION,
  CH_A,
  CH_Z,
  CH_LBRACKET,
  CH_RBRACKET,
  CH_CARET,
  CH_UNDERSCORE,
  CH_a,
  CH_z,
  CH_LBRACE,
  CH_PIPE,
  CH_RBRACE,
  CH_TILDE,
} from "./chars.ts";

function opPrec(op: string): number {
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
      return -1;
  }
}

function opRightAssoc(op: string): boolean {
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

export function parseArithmeticExpression(src: string, offset: number = 0): ArithmeticExpression | null {
  let pos = 0;
  const len = src.length;

  function skipWS(): void {
    while (pos < len) {
      const c = src.charCodeAt(pos);
      if (c === CH_SPACE || c === CH_TAB || c === CH_NL) pos++;
      else break;
    }
  }

  function tryReadBinOp(): string | null {
    if (pos >= len) return null;
    const c = src.charCodeAt(pos);
    const nc = pos + 1 < len ? src.charCodeAt(pos + 1) : 0;
    const nnc = pos + 2 < len ? src.charCodeAt(pos + 2) : 0;

    switch (c) {
      case CH_COMMA:
        pos++;
        return ",";
      case CH_EQ:
        if (nc === CH_EQ) {
          pos += 2;
          return "==";
        }
        pos++;
        return "=";
      case CH_BANG:
        if (nc === CH_EQ) {
          pos += 2;
          return "!=";
        }
        return null; // unary
      case CH_LT:
        if (nc === CH_LT) {
          if (nnc === CH_EQ) {
            pos += 3;
            return "<<=";
          }
          pos += 2;
          return "<<";
        }
        if (nc === CH_EQ) {
          pos += 2;
          return "<=";
        }
        pos++;
        return "<";
      case CH_GT:
        if (nc === CH_GT) {
          if (nnc === CH_EQ) {
            pos += 3;
            return ">>=";
          }
          pos += 2;
          return ">>";
        }
        if (nc === CH_EQ) {
          pos += 2;
          return ">=";
        }
        pos++;
        return ">";
      case CH_PLUS:
        if (nc === CH_EQ) {
          pos += 2;
          return "+=";
        }
        if (nc === CH_PLUS) return null; // postfix/prefix, not binary
        pos++;
        return "+";
      case CH_DASH:
        if (nc === CH_EQ) {
          pos += 2;
          return "-=";
        }
        if (nc === CH_DASH) return null; // postfix/prefix, not binary
        pos++;
        return "-";
      case CH_STAR:
        if (nc === CH_STAR) {
          pos += 2;
          return "**";
        }
        if (nc === CH_EQ) {
          pos += 2;
          return "*=";
        }
        pos++;
        return "*";
      case CH_SLASH:
        if (nc === CH_EQ) {
          pos += 2;
          return "/=";
        }
        pos++;
        return "/";
      case CH_PERCENT:
        if (nc === CH_EQ) {
          pos += 2;
          return "%=";
        }
        pos++;
        return "%";
      case CH_PIPE:
        if (nc === CH_PIPE) {
          pos += 2;
          return "||";
        }
        if (nc === CH_EQ) {
          pos += 2;
          return "|=";
        }
        pos++;
        return "|";
      case CH_AMP:
        if (nc === CH_AMP) {
          pos += 2;
          return "&&";
        }
        if (nc === CH_EQ) {
          pos += 2;
          return "&=";
        }
        pos++;
        return "&";
      case CH_CARET:
        if (nc === CH_EQ) {
          pos += 2;
          return "^=";
        }
        pos++;
        return "^";
      case CH_QUESTION:
        pos++;
        return "?";
      default:
        return null;
    }
  }

  function parseBinExpr(minPrec: number): ArithmeticExpression {
    let left = parseUnaryExpr();

    while (true) {
      skipWS();
      if (pos >= len) break;

      const saved = pos;
      const op = tryReadBinOp();
      if (!op) break;

      // Ternary
      if (op === "?") {
        if (3 < minPrec) {
          pos = saved;
          break;
        }
        const consequent = parseBinExpr(1);
        skipWS();
        if (pos < len && src.charCodeAt(pos) === CH_COLON) pos++;
        const alternate = parseBinExpr(3);
        left = { type: "ArithmeticTernary", pos: left.pos, end: alternate.end, test: left, consequent, alternate };
        continue;
      }

      const prec = opPrec(op);
      if (prec < minPrec) {
        pos = saved;
        break;
      }

      const nextPrec = opRightAssoc(op) ? prec : prec + 1;
      const right = parseBinExpr(nextPrec);
      left = { type: "ArithmeticBinary", pos: left.pos, end: right.end, operator: op, left, right };
    }

    return left;
  }

  function parseUnaryExpr(): ArithmeticExpression {
    skipWS();
    if (pos >= len) return { type: "ArithmeticWord", pos: pos + offset, end: pos + offset, value: "" };

    const start = pos;
    const c = src.charCodeAt(pos);
    const nc = pos + 1 < len ? src.charCodeAt(pos + 1) : 0;

    // Prefix ++ --
    if (c === CH_PLUS && nc === CH_PLUS) {
      pos += 2;
      const operand = parseUnaryExpr();
      return { type: "ArithmeticUnary", pos: start + offset, end: operand.end, operator: "++", operand, prefix: true };
    }
    if (c === CH_DASH && nc === CH_DASH) {
      pos += 2;
      const operand = parseUnaryExpr();
      return { type: "ArithmeticUnary", pos: start + offset, end: operand.end, operator: "--", operand, prefix: true };
    }

    // Unary ! ~ + -
    if (c === CH_BANG) {
      pos++;
      const operand = parseUnaryExpr();
      return { type: "ArithmeticUnary", pos: start + offset, end: operand.end, operator: "!", operand, prefix: true };
    }
    if (c === CH_TILDE) {
      pos++;
      const operand = parseUnaryExpr();
      return { type: "ArithmeticUnary", pos: start + offset, end: operand.end, operator: "~", operand, prefix: true };
    }
    if (c === CH_PLUS && nc !== CH_PLUS && nc !== CH_EQ) {
      pos++;
      const operand = parseUnaryExpr();
      return { type: "ArithmeticUnary", pos: start + offset, end: operand.end, operator: "+", operand, prefix: true };
    }
    if (c === CH_DASH && nc !== CH_DASH && nc !== CH_EQ) {
      pos++;
      const operand = parseUnaryExpr();
      return { type: "ArithmeticUnary", pos: start + offset, end: operand.end, operator: "-", operand, prefix: true };
    }

    return parsePostfixExpr();
  }

  function parsePostfixExpr(): ArithmeticExpression {
    const operand = parseAtom();
    skipWS();
    if (pos + 1 < len) {
      const c = src.charCodeAt(pos);
      const nc = src.charCodeAt(pos + 1);
      if (c === CH_PLUS && nc === CH_PLUS) {
        pos += 2;
        return { type: "ArithmeticUnary", pos: operand.pos, end: pos + offset, operator: "++", operand, prefix: false };
      }
      if (c === CH_DASH && nc === CH_DASH) {
        pos += 2;
        return { type: "ArithmeticUnary", pos: operand.pos, end: pos + offset, operator: "--", operand, prefix: false };
      }
    }
    return operand;
  }

  function parseAtom(): ArithmeticExpression {
    skipWS();
    if (pos >= len) return { type: "ArithmeticWord", pos: pos + offset, end: pos + offset, value: "" };

    const c = src.charCodeAt(pos);

    // Parenthesized expression
    if (c === CH_LPAREN) {
      const start = pos;
      pos++;
      const expr = parseBinExpr(0);
      skipWS();
      if (pos < len && src.charCodeAt(pos) === CH_RPAREN) pos++;
      return { type: "ArithmeticGroup", pos: start + offset, end: pos + offset, expression: expr };
    }

    // Dollar expansion
    if (c === CH_DOLLAR) {
      return readDollarAtom();
    }

    // Number or variable name
    return readWordAtom();
  }

  function readDollarAtom(): ArithmeticExpression {
    const start = pos;
    pos++; // skip $
    if (pos >= len) return { type: "ArithmeticWord", pos: start + offset, end: pos + offset, value: "$" };

    const c = src.charCodeAt(pos);

    if (c === CH_LPAREN) {
      if (pos + 1 < len && src.charCodeAt(pos + 1) === CH_LPAREN) {
        // $(( nested arithmetic ))
        pos += 2;
        let depth = 1;
        while (pos < len && depth > 0) {
          if (src.charCodeAt(pos) === CH_LPAREN && pos + 1 < len && src.charCodeAt(pos + 1) === CH_LPAREN) {
            depth++;
            pos += 2;
          } else if (src.charCodeAt(pos) === CH_RPAREN && pos + 1 < len && src.charCodeAt(pos + 1) === CH_RPAREN) {
            depth--;
            if (depth > 0) pos += 2;
            else pos += 2;
          } else pos++;
        }
      } else {
        // $( command substitution )
        pos++; // skip (
        let depth = 1;
        while (pos < len && depth > 0) {
          const ch = src.charCodeAt(pos);
          if (ch === CH_LPAREN) depth++;
          else if (ch === CH_RPAREN) depth--;
          pos++;
        }
        const text = src.slice(start, pos);
        const inner = text.slice(2, -1); // remove "$(" and ")"
        return {
          type: "ArithmeticCommandExpansion",
          pos: start + offset,
          end: pos + offset,
          text,
          inner,
          script: undefined,
        } satisfies ArithmeticCommandExpansion;
      }
    } else if (c === CH_LBRACE) {
      // ${ parameter expansion }
      pos++;
      let depth = 1;
      while (pos < len && depth > 0) {
        const ch = src.charCodeAt(pos);
        if (ch === CH_LBRACE) depth++;
        else if (ch === CH_RBRACE) depth--;
        pos++;
      }
    } else {
      // $var
      while (pos < len) {
        const ch = src.charCodeAt(pos);
        if (
          (ch >= CH_a && ch <= CH_z) ||
          (ch >= CH_A && ch <= CH_Z) ||
          (ch >= CH_0 && ch <= CH_9) ||
          ch === CH_UNDERSCORE
        )
          pos++;
        else break;
      }
    }

    return { type: "ArithmeticWord", pos: start + offset, end: pos + offset, value: src.slice(start, pos) };
  }

  function readWordAtom(): ArithmeticExpression {
    const start = pos;

    while (pos < len) {
      const c = src.charCodeAt(pos);
      if (
        (c >= CH_0 && c <= CH_9) ||
        (c >= CH_A && c <= CH_Z) ||
        (c >= CH_a && c <= CH_z) ||
        c === CH_UNDERSCORE ||
        c === 35 // # for base-N literals like 2#101
      ) {
        pos++;
      } else break;
    }

    // Array subscript: var[expr]
    if (pos > start && pos < len && src.charCodeAt(pos) === CH_LBRACKET) {
      pos++;
      let depth = 1;
      while (pos < len && depth > 0) {
        const c = src.charCodeAt(pos);
        if (c === CH_LBRACKET) depth++;
        else if (c === CH_RBRACKET) depth--;
        pos++;
      }
    }

    if (pos === start) {
      // Unknown character — advance to prevent infinite loop
      pos++;
      return { type: "ArithmeticWord", pos: start + offset, end: pos + offset, value: src.slice(start, pos) };
    }

    return { type: "ArithmeticWord", pos: start + offset, end: pos + offset, value: src.slice(start, pos) };
  }

  skipWS();
  if (pos >= len) return null;
  const result = parseBinExpr(0);
  // Check there's nothing important remaining
  skipWS();
  return result;
}
