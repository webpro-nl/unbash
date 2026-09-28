import type { HereDocBody, WordPart } from "./internal-types.ts";

export class HereDocBodyImpl implements HereDocBody {
  static _resolveParts: (source: string, body: HereDocBody, depth: number) => WordPart[] | undefined;

  type = "HereDocBody" as const;
  pos: number;
  end: number;
  text = "";
  #source: string;
  #depth: number;
  #parts: WordPart[] | undefined | null;

  constructor(source: string, pos: number, quoted: boolean, depth: number) {
    this.pos = pos;
    this.end = pos;
    this.#source = source;
    this.#depth = depth;
    this.#parts = quoted ? undefined : null;
  }

  get parts(): WordPart[] | undefined {
    if (this.#parts === null) this.#parts = HereDocBodyImpl._resolveParts(this.#source, this, this.#depth);
    return this.#parts;
  }

  toJSON() {
    return { type: this.type, pos: this.pos, end: this.end, text: this.text, parts: this.parts };
  }
}
