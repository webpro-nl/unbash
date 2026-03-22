import type { DoubleQuotedChild, Word, WordPart } from "./types.ts";

export type PartsResolver = (source: string, word: Word) => WordPart[] | undefined;

function dequoteValue(parts: DoubleQuotedChild[]): string {
  let s = "";
  for (const c of parts) s += c.type === "Literal" ? c.value : c.text;
  return s;
}

export class WordImpl implements Word {
  static _resolveWord: PartsResolver;
  static _resolveHeredocBody: PartsResolver;

  text: string;
  pos: number;
  end: number;
  #source: string;
  #resolver: PartsResolver;
  #parts: WordPart[] | undefined | null;
  #value: string | null = null;

  constructor(text: string, pos: number, end: number, source?: string, resolver?: PartsResolver) {
    this.text = text;
    this.pos = pos;
    this.end = end;
    this.#source = source ?? "";
    this.#resolver = resolver ?? WordImpl._resolveWord;
    this.#parts = source !== undefined ? null : undefined;
  }

  get value(): string {
    if (this.#value === null) {
      const parts = this.parts;
      if (!parts) {
        this.#value = this.text;
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
      this.#parts = this.#resolver(this.#source, this) ?? undefined;
    }
    return this.#parts;
  }
  set parts(v: WordPart[] | undefined) {
    this.#parts = v ?? undefined;
  }

  toJSON() {
    return { text: this.text, pos: this.pos, end: this.end, parts: this.parts, value: this.value };
  }
}
