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
  // Bound the re-lex to the word's span. A word inside a substitution script carries the
  // whole original as its source, so an unbounded scan would overrun the word into an
  // adjacent delimiter (e.g. a backtick or `)` immediately after it). For top-level words
  // word.end is the natural boundary, so the bound is a no-op.
  const lexer = new Lexer(source, word.pos, word.end);
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
  const lexer = new Lexer(source, word.pos, word.end);
  const parts = lexer.buildHereDocParts(word.pos, word.end);
  if (!parts) return undefined;
  resolveCollected(lexer);
  return parts;
}

/**
 * Resolve each collected substitution's inner script. The script is parsed *in place*
 * against the original source over the window [innerStart, innerStart + inner.length),
 * so every node is born with absolute pos/end — no slicing, no re-basing — and nested
 * substitutions compose because deeper words re-lex the original on demand.
 *
 * Escaped backticks rebuild `inner` with the escapes removed, so it is no longer a verbatim
 * substring of the source and carries no innerStart; those parse the rebuilt slice and stay
 * relative to it — the single documented exception to absolute offsets.
 */
function resolveCollected(lexer: Lexer): void {
  const source = lexer.getSource();
  for (const e of lexer.getCollectedExpansions()) {
    if (e.inner !== undefined) {
      e.script =
        e.innerStart !== undefined ? parse(source, e.innerStart, e.innerStart + e.inner.length) : parse(e.inner);
      e.inner = undefined;
      e.innerStart = undefined;
    }
  }
}
