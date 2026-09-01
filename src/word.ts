import type { DoubleQuotedChild, Word, WordPart } from "./types.ts";

export type PartsResolver = (source: string, word: Word, depth: number) => WordPart[] | undefined;

function dequoteValue(parts: DoubleQuotedChild[]): string {
  let s = "";
  for (const c of parts) s += c.type === "Literal" ? c.value : c.text;
  return s;
}

function unescapeBareValue(text: string): string {
  const first = text.indexOf("\\");
  if (first === -1) return text;

  let s = "";
  let start = 0;
  for (let i = first; i < text.length; i++) {
    if (text.charCodeAt(i) !== 92) continue;
    s += text.slice(start, i);
    i++;
    if (i >= text.length) {
      s += "\\";
      start = i;
      break;
    }
    if (text.charCodeAt(i) !== 10) s += text[i];
    start = i + 1;
  }
  return s + text.slice(start);
}

function commandExpansionValue(text: string): string {
  if (text[0] !== "$") return text;
  let pos = 1;
  while (text[pos] === "\\" && text[pos + 1] === "\n") pos += 2;
  return pos === 1 || text[pos] !== "(" ? text : "$" + text.slice(pos);
}

export class WordImpl implements Word {
  static _resolveWord: PartsResolver;
  static _resolveHeredocBody: PartsResolver;

  text: string;
  pos: number;
  end: number;
  #source: string | undefined;
  #resolver: PartsResolver;
  #depth: number;
  #parts: WordPart[] | undefined | null;
  #value: string | null = null;

  constructor(text: string, pos: number, end: number, source?: string, resolver?: PartsResolver, depth = 0) {
    this.text = text;
    this.pos = pos;
    this.end = end;
    this.#source = source;
    this.#resolver = resolver ?? WordImpl._resolveWord;
    this.#depth = depth;
    this.#parts = source !== undefined ? null : undefined;
  }

  get value(): string {
    if (this.#value === null) {
      const parts = this.parts;
      if (!parts) {
        this.#value = unescapeBareValue(this.text);
      } else {
        let s = "";
        for (const p of parts) {
          switch (p.type) {
            case "Literal":
            case "SingleQuoted":
            case "AnsiCQuoted":
              s += p.value;
              break;
            case "DoubleQuoted":
            case "LocaleString":
              s += dequoteValue(p.parts);
              break;
            case "CommandExpansion":
              s += commandExpansionValue(p.text);
              break;
            default:
              s += p.text;
              break;
          }
        }
        this.#value = s;
      }
    }
    return this.#value;
  }

  get parts(): WordPart[] | undefined {
    if (this.#parts === null) {
      this.#parts = this.#resolver(this.#source ?? "", this, this.#depth) ?? undefined;
    }
    return this.#parts;
  }
  set parts(v: WordPart[] | undefined) {
    this.#parts = v ?? undefined;
  }

  sourceText(): string | undefined {
    return this.#source?.slice(this.pos, this.end);
  }

  toJSON() {
    return { text: this.text, pos: this.pos, end: this.end, parts: this.parts, value: this.value };
  }
}
