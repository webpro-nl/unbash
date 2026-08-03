# unbash

Fast 0-deps bash parser written in TypeScript

## Install

```sh
npm install unbash
```

## Usage

```ts
import { parse } from "unbash";

const ast = parse('if [ -f "$1" ]; then cat "$1"; fi');
```

Result:

```js
{
  type: "Script",
  commands: [{
    type: "Statement",
    command: {
      type: "If",
      clause: { type: "CompoundList", commands: [ /* [ -f "$1" ] */ ] },
      then: { type: "CompoundList", commands: [ /* cat "$1" */ ] }
    }
  }]
}
```

### Word parts

A `Word` holds its expansions in `parts`. This is a lazy getter, computed on
first access (not an own enumerable property):

```js
const word = parse("echo a$(id)b").commands[0].command.suffix[0];

word.parts; // [Literal, CommandExpansion, Literal]

Object.keys(word); // ["text", "pos", "end"] — no `parts`
({ ...word }); // same
structuredClone(word); // same
```

Read `parts` directly, or serialize with `JSON.stringify`, which includes it
through `toJSON`. A generic walker driven by `Object.keys` finds no expansions
at all, and reports no error while doing so:

```js
import { parse } from "unbash";

const script = parse('echo "$HOME" $(mktemp)');

for (const statement of script.commands) {
  const command = statement.command;
  if (command.type !== "Command") continue;
  for (const word of [command.name, ...command.suffix]) {
    for (const part of word?.parts ?? []) {
      if (part.type === "CommandExpansion") console.log(part.text);
    }
  }
}
// $(mktemp)
```

Word-like fields that can execute nested shell syntax expose the same structure.
`BraceExpansion`, `ExtendedGlob`, and `ArithmeticWord` use `parts`; parameter and
assignment array indexes use `indexParts`.

Positions index the source owned by the nearest `ParsedScript`. Root scripts and
verbatim nested substitutions share the caller's source, so their `pos`/`end`
slice that source directly:

```js
const nested = word.parts.find((part) => part.type === "CommandExpansion").script;
const command = nested.commands[0].command;

source.slice(command.pos, command.end); // exact nested command source
```

A legacy backtick script whose body contains backslash escapes owns its decoded
string as a non-enumerable `source` property. Ordinary scripts nested inside it
index that decoded source. Object spread and `structuredClone` omit `source`
because it is non-enumerable.

Parse errors inside a lazily parsed script surface on that script, not on the
root: check `errors` on every nested `script` while traversing. A consumer that
only reads the root `errors` array cannot tell that a substitution body failed
to parse.

### Print

Basic opinionated printer, does not preserve whitespace or comments (except
shebang):

```ts
import { parse } from "unbash";
import { print } from "unbash/printer";

const ast = parse('if [ -f "$1" ]; then cat "$1"; fi');
const script = print(ast);
```

Result:

```sh
if [ -f "$1" ]; then
  cat "$1"
fi
```

## unbash vs tree-sitter-bash

[tree-sitter-bash][1] is an excellent choice if you need:

- Incremental parsing
- CST output preserving all tokens and punctuation
- Granular error recovery that wraps errors in `ERROR` nodes and continues
  parsing

unbash might be a good fit if you prefer:

- AST output
- A zero-dependency package that runs in any JS environment
- A typed TypeScript API
- Built-in parsing for command/process substitutions, coproc, Bash 5.3 `${ cmd;
}`, `[[ ]]`, `(( ))`, and extglob
- Tolerant parsing that never throws and collects parse errors

## unbash vs sh-syntax

[sh-syntax][2] is a WASM wrapper around the robust [mvdan/sh][3] Go parser. It
is highly recommended if you need:

- Support for multiple shell dialects (bash, POSIX sh, mksh, Bats)
- Built-in formatting and pretty-printing (`print`)

unbash might be a good fit if you prefer:

- A zero-dependency, synchronous API
- A detailed AST with structured word parts, parameter expansions, arithmetic
  expressions, and test expressions

## unbash vs bash-parser

[bash-parser][4] (last publish: 2017) and its fork
[@ericcornelissen/bash-parser][5] (community dependency maintenance fork ❤️ now
archived) might be interesting if you need:

- A POSIX-only mode that rejects bash-specific syntax

unbash might be a good fit if you prefer:

- A zero-dependency architecture
- A typed TypeScript API (ESM-only)
- Tolerant parsing that never throws and collects parse errors
- Structured AST nodes for parameter expansions, arithmetic expressions, and `[[
]]` test expressions
- Support for many additional syntax features (like herestrings, C-style for
  loops, `select`, process substitution, etc. etc.)

## Benchmarks

Relative performance comparison (on Apple M1 Pro/32GB), unbash is x times
faster:

| Parser                       | short | advanced | medium | large |
| ---------------------------- | ----: | -------: | -----: | ----: |
| tree-sitter-bash (native)    |   13x |       9x |     4x |    5x |
| tree-sitter-bash (WASM)      |   16x |      12x |     8x |    8x |
| sh-syntax                    | 2136x |    1537x |     8x |    4x |
| bash-parser                  |  256x |      N/A |    N/A |   N/A |
| @ericcornelissen/bash-parser |  267x |      N/A |    N/A |   N/A |

Run the benchmarks using Node.js v22:

```sh
pnpm install
node bench/all.ts
```

## Size

unbash is 53K minified, 13KB gzipped.

## Playgrounds

- [unbash.statichost.page][6]
- [ast-explorer.dev][7]

## License

ISC

[1]: https://github.com/tree-sitter/tree-sitter-bash
[2]: https://github.com/un-ts/sh-syntax
[3]: https://github.com/mvdan/sh
[4]: https://github.com/vorpaljs/bash-parser
[5]: https://github.com/ericcornelissen/bash-parser
[6]: https://unbash.statichost.page
[7]: https://ast-explorer.dev/#eNoVjDsKwzAQRK8yDK5CyAGS2nVAId02jixZAbFr/Kls393rbh7zeBsrn5xLqpV3jr5X/XVzcYgOKRaD8LoNzffTBqFotgkZf8XtUW14oTdRIHaLq00WYscwpRFtCO8g2psm75n3toPHCdz+Ivg=
