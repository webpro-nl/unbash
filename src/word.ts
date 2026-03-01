import type { DoubleQuotedChild, Word, WordPart } from "./types.ts";

type PartsResolver = (source: string, word: Word) => WordPart[] | undefined;

function dequoteValue(parts: DoubleQuotedChild[]): string {
  let s = "";
  for (const c of parts) s += c.type === "Literal" ? c.value : c.text;
  return s;
}

export class WordImpl implements Word {
  static _resolve: PartsResolver;

  text: string;
  pos: number;
  end: number;
  #source: string;
  #parts: WordPart[] | undefined | null;
  #value: string | null = null;

  constructor(text: string, pos: number, end: number, source?: string) {
    this.text = text;
    this.pos = pos;
    this.end = end;
    this.#source = source ?? "";
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
      this.#parts = WordImpl._resolve(this.#source, this) ?? undefined;
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
