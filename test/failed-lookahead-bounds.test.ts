import assert from "node:assert/strict";
import test from "node:test";
import { LexContext, Lexer, Token } from "../src/lexer.ts";
import { parse } from "../src/parser.ts";
import { nodeOfType } from "./ast-helpers.ts";

const SIZES = [1024, 4096, 16384, 65536];
const READS_PER_CHAR = 64;

function countReads(source: string): number {
  const charCodeAt = String.prototype.charCodeAt;
  let reads = 0;
  String.prototype.charCodeAt = function (index: number): number {
    reads++;
    return charCodeAt.call(this, index);
  };
  try {
    parse(source);
  } finally {
    String.prototype.charCodeAt = charCodeAt;
  }
  return reads;
}

function wordParts(source: string): (string | undefined)[][] {
  const command = nodeOfType(parse(source).commands[0].command, "Command");
  const word = nodeOfType(command.args[0] ?? command.name, "Word");
  return word.parts!.map((part) => [part.type, "text" in part ? part.text : undefined]);
}

for (const size of SIZES) {
  test(`unmatched braces in a ${size}-byte word are scanned in linear reads`, () => {
    const source = "n" + "{".repeat(size - 1);
    const reads = countReads(source);
    assert.ok(reads <= READS_PER_CHAR * source.length, `${reads} reads for ${source.length} characters`);
  });

  test(`unmatched $[ openers in a ${size}-byte word are scanned in linear reads`, () => {
    const source = "echo " + "$[".repeat(Math.floor((size - 5) / 2));
    const reads = countReads(source);
    assert.ok(reads <= READS_PER_CHAR * source.length, `${reads} reads for ${source.length} characters`);
  });

  test(`unmatched $[ openers with one final ] in a ${size}-byte word are scanned in linear reads`, () => {
    const source = "echo " + "$[".repeat(Math.floor((size - 6) / 2)) + "]";
    const reads = countReads(source);
    assert.ok(reads <= READS_PER_CHAR * source.length, `${reads} reads for ${source.length} characters`);
  });
}

test("an unmatched outer brace keeps a valid inner expansion", () => {
  assert.deepEqual(wordParts("n{{a,b}"), [
    ["Literal", "n{"],
    ["BraceExpansion", "{a,b}"],
  ]);
});

test("a brace expansion after unmatched openers keeps its inner expansion", () => {
  assert.deepEqual(wordParts("n{{{a,b}"), [
    ["Literal", "n{{"],
    ["BraceExpansion", "{a,b}"],
  ]);
});

test("nested $[ expansions parse as a single arithmetic expansion", () => {
  assert.deepEqual(wordParts("echo $[$[1]]"), [["ArithmeticExpansion", "$[$[1]]"]]);
  assert.deepEqual(wordParts("echo $[1+$[2]]x"), [
    ["ArithmeticExpansion", "$[1+$[2]]"],
    ["Literal", "x"],
  ]);
});

test("an unmatched $[ before a valid $[ expansion keeps the inner expansion", () => {
  assert.deepEqual(wordParts("echo $[$[1]"), [
    ["Literal", "$["],
    ["ArithmeticExpansion", "$[1]"],
  ]);
});

function countWork<T extends object>(run: () => T) {
  const charCodeAt = String.prototype.charCodeAt;
  const indexOf = String.prototype.indexOf;
  const lastIndexOf = String.prototype.lastIndexOf;
  const includes = String.prototype.includes;
  let reads = 0;
  let searched = 0;
  String.prototype.charCodeAt = function (index: number) {
    reads++;
    return charCodeAt.call(this, index);
  };
  String.prototype.indexOf = function (search: string, position = 0) {
    const result = indexOf.call(this, search, position);
    const start = Math.max(0, Math.min(this.length, Math.trunc(position) || 0));
    searched += result < 0 ? this.length - start : result - start + search.length;
    return result;
  };
  String.prototype.lastIndexOf = function (search: string, position = Infinity) {
    const result = lastIndexOf.call(this, search, position);
    const start = Math.max(0, Math.min(this.length - search.length, position));
    searched += result < 0 ? start + search.length : start - result + search.length;
    return result;
  };
  String.prototype.includes = function (search: string, position = 0) {
    const result = includes.call(this, search, position);
    const start = Math.max(0, Math.min(this.length, Math.trunc(position) || 0));
    const hit = result ? indexOf.call(this, search, position) : -1;
    searched += hit < 0 ? this.length - start : hit - start + search.length;
    return result;
  };
  try {
    const result = run();
    return { ...result, reads, searched, work: reads + searched };
  } finally {
    String.prototype.charCodeAt = charCodeAt;
    String.prototype.indexOf = indexOf;
    String.prototype.lastIndexOf = lastIndexOf;
    String.prototype.includes = includes;
  }
}

const families = [
  ["unmatched braces", (size: number) => "echo n" + "{".repeat(size) + "\nprintf tail\n"],
  [
    "balanced literal braces",
    (size: number) => "echo " + "{".repeat(size) + "word" + "}".repeat(size) + "\nprintf tail\n",
  ],
  ["alternating successful braces", (size: number) => "echo n{" + "{a,b}{".repeat(size) + "\nprintf tail\n"],
  [
    "shorter failed and successful braces",
    (size: number) => "echo n{" + "{{literal}}{a,b}{".repeat(size) + "\nprintf tail\n",
  ],
  ["unclosed legacy arithmetic", (size: number) => "echo " + "$[".repeat(size) + "\nprintf tail\n"],
  ["legacy arithmetic with a final closer", (size: number) => "echo " + "$[".repeat(size) + "]\nprintf tail\n"],
  ["separate damaged legacy words", (size: number) => "echo $[x\n".repeat(size) + "]\nprintf tail\n"],
  [
    "legacy failure with bare parameter subfields",
    (size: number) => "echo " + "$[x${v:-$[1]}".repeat(size) + "\nprintf tail",
  ],
  [
    "legacy failure with quoted parameter subfields",
    (size: number) => "echo " + '$[x${v:-"$[1]"}'.repeat(size) + "\nprintf tail",
  ],
  [
    "legacy failure with quoted test re-entry",
    (size: number) => 'echo $[x\n[[ "$[1+2]" = 3 ]]\n'.repeat(size) + "]\nprintf tail",
  ],
  [
    "legacy failure followed by successes",
    (size: number) => "echo $[\n" + "echo $[1+2] $[1+$[2]]\n".repeat(size) + "printf tail\n",
  ],
] as const;

test("immediate brace rejections do not allocate a lookahead table", () => {
  for (const source of ["echo {\n", "echo {}\n", "echo { }\n", "f() { :; }\n", "echo {"]) {
    const MapConstructor = globalThis.Map;
    let maps = 0;
    globalThis.Map = new Proxy(MapConstructor, {
      construct(target, args) {
        maps++;
        return Reflect.construct(target, args);
      },
    });
    try {
      const script = parse(source);
      assert.equal(script.errors, undefined);
      assert.equal(script.commands.length, 1);
      assert.equal(maps, 0, source);
    } finally {
      globalThis.Map = MapConstructor;
    }
  }
});

for (const [name, sourceOfSize] of families) {
  for (const materialize of [false, true]) {
    test(`${name} bounds ${materialize ? "parse and JSON" : "parse"} reads and native search ranges`, () => {
      const counts = [64, 128, 256].map((size) => {
        const source = sourceOfSize(size);
        const result = countWork(() => {
          const script = parse(source);
          return { script, outputLength: materialize ? JSON.stringify(script).length : 0 };
        });
        const tail = nodeOfType(result.script.commands.at(-1)!.command, "Command");
        assert.equal(tail.name?.text, "printf");
        assert.equal(tail.args[0].text, "tail");
        return {
          size,
          length: source.length,
          reads: result.reads,
          searched: result.searched,
          work: result.work,
          outputLength: result.outputLength,
        };
      });
      for (let index = 1; index < counts.length; index++) {
        assert.ok(counts[index].work < counts[index - 1].work * 2.2, JSON.stringify(counts));
      }
    });
  }
}

const continuation = String.fromCharCode(92, 10);
for (const [name, line, expectedWords] of [
  ["continued command", "n" + continuation + "$[$[ x\n", ["n$[$[", "x"]],
  ["continued argument", "echo n" + continuation + "$[$[ x\n", ["echo", "n$[$[", "x"]],
  ["quoted argument", 'echo "x"$[$[ y\n', ["echo", "x$[$[", "y"]],
  ["quoted inner success", 'echo "x"$[$[1] y\n', ["echo", "x$[$[1]", "y"]],
] as const) {
  test(`${name} keeps legacy failure facts while reading prior token values`, () => {
    const counts = [16, 32, 64, 128].map((size) => {
      const source = line.repeat(size) + "printf tail\n";
      const result = countWork(() => {
        const lexer = new Lexer(source);
        const tokens: [number, number, number, string][] = [];
        for (;;) {
          const token = lexer.next(LexContext.CommandStart);
          if (token.token === Token.EOF) break;
          lexer.peek(LexContext.CommandStart);
          tokens.push([token.token, token.pos, token.end, token.value]);
        }
        return { tokens, outputLength: JSON.stringify(tokens).length };
      });
      const words = result.tokens.filter((token) => token[0] === Token.Word).map((token) => token[3]);
      assert.deepEqual(words.slice(0, expectedWords.length), expectedWords);
      assert.deepEqual(words.slice(-2), ["printf", "tail"]);
      return {
        size,
        reads: result.reads,
        searched: result.searched,
        work: result.work,
        outputLength: result.outputLength,
      };
    });
    for (let index = 1; index < counts.length; index++) {
      assert.ok(counts[index].work < counts[index - 1].work * 2.2, JSON.stringify(counts));
    }
  });
}

const hereDoc = "cat <<$[1]${a[0]}\nbody\n$[1]${a[0]}\n";
for (const [name, body, kind, expected] of [
  ["value", 'a[${a[0]}]="x"', "value", "a[${a[0]}]=x"],
  ["parameter field", "$[1]${a[0]}", "field", "$[1]${a[0]}"],
  ["parenthesis success", hereDoc + ")", "parenthesis", 42],
  ["parenthesis failure", hereDoc, "parenthesis", -1],
  ["delimiter success", "$( " + hereDoc + ")} ", "delimiter", 46],
  ["delimiter failure", "$( " + hereDoc + ")", "delimiter", -1],
] as const) {
  test(`temporary ${name} scan retains enclosing bracket and arithmetic failure facts`, () => {
    const lexer = new Lexer("[$[$[x " + body + " [tail]");
    const scan = lexer as unknown as {
      findClosingArithmeticBracket(start: number): number;
      parseSubFieldWord(start: number, end: number): { text: string };
    };
    assert.equal(lexer.findClosingBracket(1), -1);
    assert.equal(lexer.findClosingBracket(1), -1);
    assert.equal(scan.findClosingArithmeticBracket(3), -1);
    lexer._buildParts = true;
    const end = 7 + body.length;
    const result =
      kind === "value"
        ? lexer._tokenValue(7, end, false)
        : kind === "field"
          ? scan.parseSubFieldWord(7, end).text
          : kind === "parenthesis"
            ? lexer.findClosingParenthesis(7, end)
            : lexer.findClosingBrace(7, end);
    assert.equal(result, expected);
    assert.deepEqual(
      countWork(() => ({
        bracket: lexer.findClosingBracket(1),
        arithmetic: scan.findClosingArithmeticBracket(3),
      })),
      { bracket: -1, arithmetic: -1, reads: 0, searched: 0, work: 0 },
    );
  });
}

test("valid inner braces retain structure and spans across fresh lazy access orders", () => {
  const source = "echo n{{a,b} n{{{x,y} {word{a,b}}\n";
  for (const valueFirst of [true, false]) {
    const script = parse(source);
    const command = nodeOfType(script.commands[0].command, "Command");
    const words = command.args.map((word) => nodeOfType(word, "Word"));
    assert.equal(script.errors, undefined);
    if (valueFirst)
      assert.deepEqual(
        words.map((word) => word.value),
        ["n{{a,b}", "n{{{x,y}", "{word{a,b}}"],
      );
    assert.deepEqual(
      words.map((word) => word.parts?.map((part) => [part.type, part.text, part.pos, part.end])),
      [
        [
          ["Literal", "n{", 5, 7],
          ["BraceExpansion", "{a,b}", 7, 12],
        ],
        [
          ["Literal", "n{{", 13, 16],
          ["BraceExpansion", "{x,y}", 16, 21],
        ],
        [
          ["Literal", "{word", 22, 27],
          ["BraceExpansion", "{a,b}", 27, 32],
          ["Literal", "}", 32, 33],
        ],
      ],
    );
    assert.deepEqual(
      words.map((word) => word.value),
      ["n{{a,b}", "n{{{x,y}", "{word{a,b}}"],
    );
    JSON.stringify(script);
    assert.equal(script.errors, undefined);
  }
});

test("word-local brace scans handle backwards reads and changed bounds", () => {
  const source = "n{{a,b}";
  const lexer = new Lexer(source);
  for (const depth of [0, 256, 1, 0]) {
    lexer._nestingDepth = depth;
    assert.deepEqual(
      lexer.buildWordParts(0)?.map((part) => [part.type, part.text, part.pos, part.end]),
      [
        ["Literal", "n{", 0, 2],
        ["BraceExpansion", "{a,b}", 2, 7],
      ],
    );
    assert.equal(lexer.fork(0, 6).buildWordParts(0), null);
  }
  const script = parse("n\\\n{{literal}}");
  const word = nodeOfType(script.commands[0].command, "Command").name!;
  assert.equal(word.text, "n\\\n{{literal}}");
  assert.equal(word.value, "n{{literal}}");
  assert.equal(word.parts, undefined);
  assert.deepEqual([word.pos, word.end], [0, 14]);
  assert.equal(script.errors, undefined);
});

test("legacy failure facts do not erase successful or changed-window searches", () => {
  const lexer = new Lexer("$[$[1] $[2]");
  const scan = lexer as unknown as { findClosingArithmeticBracket(start: number, end?: number): number };
  for (const depth of [0, 256, 1, 0]) {
    lexer._nestingDepth = depth;
    assert.equal(scan.findClosingArithmeticBracket(2), -1);
    assert.equal(scan.findClosingArithmeticBracket(4), 5);
    assert.equal(scan.findClosingArithmeticBracket(9), 10);
    assert.equal(scan.findClosingArithmeticBracket(9, 10), -1);
    assert.equal(scan.findClosingArithmeticBracket(9, 11), 10);
    assert.equal(scan.findClosingArithmeticBracket(2, 11), -1);
  }
});

test("valid nested and multiline legacy arithmetic retain complete words and later commands", () => {
  for (const [source, expected, end] of [
    ["echo $[1+$[2]]\nprintf tail\n", "$[1+$[2]]", 14],
    ["echo $[1 +\n2]\nprintf tail\n", "$[1 +\n2]", 13],
  ] as const) {
    const script = parse(source);
    const word = nodeOfType(nodeOfType(script.commands[0].command, "Command").args[0], "Word");
    assert.equal(word.text, expected);
    assert.equal(word.parts?.length, 1);
    assert.equal(word.parts?.[0].type, "ArithmeticExpansion");
    assert.equal(word.parts?.[0].text, expected);
    assert.deepEqual([word.pos, word.end], [5, end]);
    assert.equal(nodeOfType(script.commands[1].command, "Command").name?.text, "printf");
    assert.equal(script.errors, undefined);
  }
});
