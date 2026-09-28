import { Lexer, LexContext, skipLineContinuations, Token } from "./lexer.ts";
import { computeArrayElementParts, computeEmbeddedWordParts } from "./parts.ts";
import type { ArrayValue, Assignment, Word } from "./internal-types.ts";
import { WordImpl } from "./word.ts";

class ArrayValueImpl implements ArrayValue {
  type = "ArrayValue" as const;
  pos: number;
  end: number;
  #source: string;
  #depth: number;
  #elements: Word[] | undefined;

  constructor(source: string, pos: number, end: number, depth: number) {
    this.pos = pos;
    this.end = end;
    this.#source = source;
    this.#depth = depth;
  }

  get elements(): Word[] {
    if (this.#elements) return this.#elements;
    const lexer = new Lexer(this.#source, this.pos + 1, this.end - 1);
    lexer._nestingDepth = this.#depth;
    const elements: Word[] = [];
    while (lexer.peek(LexContext.ArrayElement).token !== Token.EOF) {
      const token = lexer.next(LexContext.ArrayElement);
      if (token.token !== Token.Word && token.token !== Token.Assignment) continue;
      const text = token.raw ? token.value : this.#source.slice(token.pos, token.end);
      const resolver = text.charCodeAt(0) === 91 ? computeArrayElementParts : undefined;
      elements.push(new WordImpl(text, token.pos, token.end, this.#source, resolver, this.#depth));
    }
    this.#elements = elements;
    return elements;
  }

  toJSON(): ArrayValue {
    return { type: this.type, pos: this.pos, end: this.end, elements: this.elements };
  }
}

export class AssignmentImpl implements Assignment {
  type = "Assignment" as const;
  pos: number;
  end: number;
  text: string;
  #source: string;
  #depth: number;
  #operatorPos: number;
  #name: string | null = null;
  #append: boolean | undefined;
  #index: Word | undefined;
  #value: Word | ArrayValue | null = null;

  constructor(text: string, pos: number, end: number, source: string, operatorPos: number, depth: number) {
    this.pos = pos;
    this.end = end;
    this.text = text;
    this.#source = source;
    this.#operatorPos = operatorPos;
    this.#depth = depth;
  }

  get name(): string {
    return this.#name ?? this.resolveTarget();
  }

  get append(): boolean | undefined {
    if (this.#name === null) this.resolveTarget();
    return this.#append;
  }

  get index(): Word | undefined {
    if (this.#name === null) this.resolveTarget();
    return this.#index;
  }

  get value(): Word | ArrayValue {
    if (this.#value !== null) return this.#value;
    const start = this.#operatorPos + 1;
    const arrayStart = skipLineContinuations(this.#source, start, this.end);
    this.#value =
      this.#source.charCodeAt(arrayStart) === 40 && this.#source.charCodeAt(this.end - 1) === 41
        ? new ArrayValueImpl(this.#source, arrayStart, this.end, this.#depth)
        : new WordImpl(this.#source.slice(start, this.end), start, this.end, this.#source, undefined, this.#depth);
    return this.#value;
  }

  private resolveTarget(): string {
    const equal = this.#operatorPos - this.pos;
    let nameEnd = equal;
    let appendPos = equal;
    while (appendPos >= 2 && this.text.charCodeAt(appendPos - 2) === 92 && this.text.charCodeAt(appendPos - 1) === 10)
      appendPos -= 2;
    if (this.text.charCodeAt(appendPos - 1) === 43) {
      this.#append = true;
      nameEnd = appendPos - 1;
    }
    const bracket = this.text.indexOf("[");
    if (bracket > 0 && bracket < nameEnd) {
      const close = this.text.lastIndexOf("]", equal);
      if (close > bracket) {
        const start = this.pos + bracket + 1;
        const end = this.pos + close;
        this.#index = new WordImpl(
          this.#source.slice(start, end),
          start,
          end,
          this.#source,
          computeEmbeddedWordParts,
          this.#depth,
        );
        nameEnd = bracket;
      }
    }
    const name = this.text.slice(0, nameEnd);
    return (this.#name = name.includes("\\\n") ? name.split("\\\n").join("") : name);
  }

  toJSON(): Assignment {
    return {
      type: this.type,
      pos: this.pos,
      end: this.end,
      text: this.text,
      name: this.name,
      append: this.append,
      index: this.index,
      value: this.value,
    };
  }
}
