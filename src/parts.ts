import type { DeferredCommandExpansion, Word, WordPart } from "./types.ts";
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
  for (const exp of lexer.getCollectedExpansions()) {
    resolveExpansion(exp);
  }
  const arithCmdExps = lexer.getCollectedArithCmdExps();
  if (arithCmdExps) {
    for (const node of arithCmdExps) {
      if (node.inner !== undefined) {
        node.script = parse(node.inner);
        node.inner = undefined;
      }
    }
  }
}

function resolveExpansion(e: DeferredCommandExpansion) {
  if (e.inner !== undefined && e._part) {
    e._part.script = parse(e.inner);
    e._part.inner = undefined;
    e._part = undefined;
    e.inner = undefined;
  }
}
