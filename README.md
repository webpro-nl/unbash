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

```js
// Result:
{
  type: "Script",
  commands: [{
    type: "If",
    clause: { type: "Command", name: { text: "[" }, ... },
    then: { type: "Command", name: { text: "cat" }, ... }
  }]
}
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
| tree-sitter-bash (native)    |   14x |       9x |     4x |    4x |
| tree-sitter-bash (WASM)      |   14x |      11x |     7x |    7x |
| sh-syntax                    | 1998x |    1419x |     7x |    4x |
| bash-parser                  |  236x |      N/A |    N/A |   N/A |
| @ericcornelissen/bash-parser |  247x |      N/A |    N/A |   N/A |

Run the benchmarks using Node.js v22 or v24:

```sh
pnpm install
node bench/all.ts
```

## Size

unbash is under 50K minified, 12KB gzipped.

## License

ISC

[1]: https://github.com/tree-sitter/tree-sitter-bash
[2]: https://github.com/un-ts/sh-syntax
[3]: https://github.com/mvdan/sh
[4]: https://github.com/vorpaljs/bash-parser
[5]: https://github.com/ericcornelissen/bash-parser
