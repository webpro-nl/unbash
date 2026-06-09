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
    type: "If",
    clause: { type: "Command", name: { text: "[" }, ... },
    then: { type: "Command", name: { text: "cat" }, ... }
  }]
}
```

## Source offsets

Every node carries `pos`/`end` as absolute offsets into the original source, so `source.slice(node.pos, node.end)` yields that node's text at any nesting depth — including inside command, process, arithmetic, and `${ }` substitutions, and parameter-expansion sub-fields. No need to track inner offsets while traversing.

```ts
const source = 'echo "$(date -u) $(whoami)"';
const ast = parse(source);
const sub = ast.commands[0].command.suffix[0].parts[0].parts[0]; // the $(date -u)
source.slice(sub.script.pos, sub.script.end); // → "date -u"
```

`parts` is computed lazily — accessing it resolves a word's substitutions in place. Word `text` equals the source span except for parameter-expansion sub-field words (operands, patterns, replacements), where `text` is the processed value (escapes/quotes resolved, like `value`); their `pos`/`end` still span the source.

The one exception to absolute offsets: legacy escaped backticks (`` `… \`…\` …` ``) rebuild their inner with the escapes removed, so it is no longer a verbatim substring of the source — the nested script's offsets stay relative to that rebuilt inner.

## Print

Basic opinionated printer, does not preserve whitespace or comments (except shebang):

```ts
import { parse } from "unbash";
import { print } from "unbash/print";

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
- Granular error recovery that wraps errors in `ERROR` nodes and continues parsing

unbash might be a good fit if you prefer:

- AST output
- A zero-dependency package that runs in any JS environment
- A typed TypeScript API
- Built-in parsing for command/process substitutions, coproc, Bash 5.3 `${ cmd; }`, `[[ ]]`, `(( ))`, and extglob
- Tolerant parsing that never throws and collects parse errors

## unbash vs sh-syntax

[sh-syntax][2] is a WASM wrapper around the robust [mvdan/sh][3] Go parser. It is highly recommended if you need:

- Support for multiple shell dialects (bash, POSIX sh, mksh, Bats)
- Built-in formatting and pretty-printing (`print`)

unbash might be a good fit if you prefer:

- A zero-dependency, synchronous API
- A detailed AST with structured word parts, parameter expansions, arithmetic expressions, and test expressions

## unbash vs bash-parser

[bash-parser][4] (last publish: 2017) and its fork [@ericcornelissen/bash-parser][5] (community dependency maintenance fork ❤️ now archived) might be interesting if you need:

- A POSIX-only mode that rejects bash-specific syntax

unbash might be a good fit if you prefer:

- A zero-dependency architecture
- A typed TypeScript API (ESM-only)
- Tolerant parsing that never throws and collects parse errors
- Structured AST nodes for parameter expansions, arithmetic expressions, and `[[ ]]` test expressions
- Support for many additional syntax features (like herestrings, C-style for loops, `select`, process substitution, etc. etc.)

## Benchmarks

Relative performance comparison (on Apple M1 Pro/32GB), unbash is x times faster:

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
