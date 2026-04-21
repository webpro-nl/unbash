import type { DeferredCommandExpansion, Word, WordPart } from "./types.ts";
import { Lexer } from "./lexer.ts";
import { parse, resolveArithmeticExpansions } from "./parser.ts";

/**
 * Compute the structural parts of a word by re-scanning the source.
 * This is the "cold path" — only called when consumers actually need parts.
 *
 * Returns undefined for simple words (no quotes, expansions, or special structure).
 */
export function computeWordParts(source: string, word: Word): WordPart[] | undefined {
  const lexer = new Lexer(source);
  const parts = lexer.buildWordParts(word.pos);
  if (!parts) return undefined;

  // Resolve command expansions: parse inner scripts
  for (const exp of lexer.getCollectedExpansions()) {
    resolveExpansion(exp);
  }

  // Resolve command substitutions inside arithmetic expressions
  for (const part of parts) {
    if (part.type === "ArithmeticExpansion" && part.expression) {
      resolveArithmeticExpansions(part.expression);
    }
  }

  return parts;
}

/**
 * Compute parts for an unquoted heredoc body.
 * Heredoc bodies use different scanning rules than shell words: newlines are
 * literal and single/double quotes have no special meaning.
 */
export function computeHereDocBodyParts(source: string, word: Word): WordPart[] | undefined {
  const lexer = new Lexer(source);
  const parts = lexer.buildHereDocParts(word.pos, word.end);
  if (!parts) return undefined;

  // Resolve command expansions: parse inner scripts
  for (const exp of lexer.getCollectedExpansions()) {
    resolveExpansion(exp);
  }

  // Resolve command substitutions inside arithmetic expressions
  for (const part of parts) {
    if (part.type === "ArithmeticExpansion" && part.expression) {
      resolveArithmeticExpansions(part.expression);
    }
  }

  return parts;
}

function resolveExpansion(e: DeferredCommandExpansion) {
  if (e.inner !== undefined && e._part) {
    e._part.script = parse(e.inner);
    e._part.inner = undefined;
    e._part = undefined;
    e.inner = undefined;
  }
}
