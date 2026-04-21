import type { Word, WordPart } from "./types.ts";
import { Lexer } from "./lexer.ts";
import { parse } from "./parser.ts";

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
  resolveCollected(lexer);
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
  resolveCollected(lexer);
  return parts;
}

function resolveCollected(lexer: Lexer): void {
  for (const e of lexer.getCollectedExpansions()) {
    if (e.inner !== undefined) {
      e.script = parse(e.inner);
      e.inner = undefined;
    }
  }
}
