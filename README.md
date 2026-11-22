# unbash

The best bash parser in JavaScript. Fast, complete, typed.

![unbash logo][1]

[![NPM Version][3]][2] [![NPM Downloads][4]][2]

## Install

```sh
npm install unbash
```

## When to use unbash?

Use unbash when your input is Bash source: a pasted command, a complete script,
or shell source embedded in another format, and you need to inspect its
structure without executing it. It returns a typed, source-positioned AST.

Example use cases:

- Check commands against blocklists before execution ([Desktop Commander][5])
- Extract embedded scripts and heredocs for syntax highlighting ([T3 Code][6])
- Extract command names and arguments for approval rules ([ZCode][7])
- Collect executables and literal file, configuration, and dependency references
- Find test report paths in CI commands and package scripts ([Spec
  Controller][8])
- Import or convert commands such as `curl` to code
- Check package scripts for shell portability
- Report syntax errors in pasted or generated Bash using the partial tree and
  error positions
- Build command summaries and pipeline previews ([Ultimate][9])

## Supported syntax

unbash parses GNU Bash.

Currently at Bash v5.3 with non-interactive defaults including `extglob`
patterns. Supported syntax includes commands, control flows, pipelines,
redirects, assignments, compound statements, parameter and word expansions,
process and nested substitutions, coproc, heredocs, herestrings, nested and
generated syntax, etc. etc.

POSIX `sh` scripts parse as Bash. unbash does not gate syntax by version, i.e.
it accepts syntax that older Bash releases reject.

## Unsupported syntax

Other shell languages are not supported: zsh, ksh93, mksh, fish, PowerShell,
`cmd.exe`, csh, Bats test files. Such scripts may produce errors or a misleading
tree.

unbash is a tolerant parser: for malformed, incomplete or excessively nested
input, it recovers where possible and returns a best-effort partial AST with
source-positioned errors for what it detects while parsing.

To parse `process.argv` (`string[]`), use Node.js [`parseArgs`][10] or a library
such as [yargs][11] or [citty][12].

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

See the full AST at [unbash.statichost.page#input=if \[ -f...][13]

Positions are zero-based UTF-16 code-unit offsets forming half-open `[pos, end)`
ranges into the source.

### Visit

`forEachChild(node, callback)` calls the callback once for each direct child,
including word parts such as expansions and the `script` of a substitution,
which resolve on first access. It does not recurse: call it from the callback to
descend, or skip the call to leave a subtree unresolved.

```ts
import { forEachChild, parse, type SyntaxNode } from "unbash";

const source = 'echo "$HOME" $(mktemp -d)';

function visit(node: SyntaxNode): void {
  if (node.type === "Command") console.log(source.slice(node.pos, node.end));
  forEachChild(node, visit);
}

visit(parse(source));
// echo "$HOME" $(mktemp -d)
// mktemp -d
```

The callback receives only the child and its return value is ignored. A nested
script reports its own `errors`, so check them while visiting. See [Migrating
from v5][14] for the node shapes and lazy fields.

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

[tree-sitter-bash][15] is the right choice when you need:

- Incremental parsing
- CST output preserving all tokens and punctuation
- Error recovery with `ERROR` nodes and missing tokens

unbash provides:

- A typed, executable-syntax AST instead of a grammar CST
- A synchronous, zero-dependency TypeScript package with no native addon, WASM
  runtime, parser initialization, or query layer
- Structured word parts, arithmetic and test-expression trees, recursively
  parsed substitutions, and direct source positions
- Best-effort error recovery that preserves a partial AST and collects errors
- Also see [tree-sitter-bash gaps covered by unbash][16]

## unbash vs sh-syntax

[sh-syntax][17] is a WASM wrapper around the robust [mvdan/sh][18] Go parser. It
is highly recommended if you need:

- Support for Bash, POSIX sh, mksh, Bats, and experimental Zsh parsing
- Mature, configurable formatting and pretty-printing

unbash provides:

- A zero-dependency, synchronous TypeScript API without WASM loading
- A smaller, JSON-friendly Bash AST with lazy structured word parts, recursively
  parsed substitutions, and direct source positions
- Best-effort partial ASTs for malformed or incomplete editor and user input
- Also see [sh-syntax gaps covered by unbash][19]

## unbash vs bash-parser

[bash-parser][20] and its fork [@ericcornelissen/bash-parser][21] (community
dependency maintenance fork ❤️ now archived) provide:

- A POSIX-only mode that rejects bash-specific syntax

unbash provides:

- A zero-dependency architecture
- A typed TypeScript API (ESM-only)
- Best-effort error recovery that preserves a partial AST and collects errors
- Structured AST nodes for parameter expansions, arithmetic expressions, and
  `[[ ]]` test expressions; `bash-parser` treats `[[ ]]` as ordinary commands
  and `(( ))` as nested subshells
- Herestrings, C-style `for`, `select`, process substitution, `coproc`, array
  assignments, extglob, `;&`/`;;&` case fallthrough, Bash 5.3 command
  substitutions, and `{variable}` file-descriptor redirects

## Benchmarks

Parse throughput in MB/s; higher is better. Median per-run p75 iteration times
from 11 isolated runs per parser and workload, on Apple M1 Pro/32GB with Node.js
24.19.0. Parentheses show speed relative to unbash v6.

| Parser                       | short (1.1KiB) | advanced (0.9KiB) | medium (150KiB) | large (970KiB) |
| ---------------------------- | -------------: | ----------------: | --------------: | -------------: |
| **unbash v6**                |       **79.2** |          **72.7** |       **102.6** |      **121.2** |
| unbash v5                    |   79.5 (1.00x) |      73.3 (0.99x) |   103.6 (0.99x) |  116.6 (1.04x) |
| unbash v4                    |   80.8 (0.98x) |      73.5 (0.99x) |    99.8 (1.03x) |  114.5 (1.06x) |
| tree-sitter-bash (native)    |     4.23 (19x) |        5.95 (12x) |      15.04 (7x) |    11.88 (10x) |
| tree-sitter-bash (WASM)      |     5.08 (16x) |        5.47 (13x) |      8.50 (12x) |     8.12 (15x) |
| sh-syntax                    |   0.04 (1838x) |      0.06 (1264x) |      8.80 (12x) |     14.32 (8x) |
| bash-parser                  |    0.28 (287x) |               n/a |             n/a |            n/a |
| @ericcornelissen/bash-parser |    0.25 (313x) |               n/a |             n/a |            n/a |

Run the isolated suite using Node.js 24.2+:

```sh
pnpm install
pnpm bench
```

Each run used 500ms of warmup, one V8 GC before timing, and at least one second
and 64 iterations of measurement. Results consume top-level node counts; WASM
tree-sitter timings include disposal of returned trees. Each case runs in a
fresh process, with reversed order on repeats.

## Size

The parser bundle is 100K minified and 26K gzipped.

## Playgrounds

- [unbash.statichost.page][22]
- [ast-explorer.dev][23]

## License

ISC

[1]: https://unba.sh/unba.sh.webp
[2]: https://www.npmx.dev/package/unbash
[3]: https://img.shields.io/npm/v/unbash?color=f56e0f
[4]: https://img.shields.io/badge/dynamic/json?url=https://npm-gapless.webpro.nl/downloads/range/last-month/unbash&query=$.totalCompact&label=downloads&suffix=/month&color=f56e0f
[5]: https://github.com/wonderwhy-er/DesktopCommanderMCP/blob/9a101b17e44577f0baefa4c7120f087881c5cc56/src/utils/posix-commands.ts#L193
[6]: https://github.com/pingdotgg/t3code/blob/504589183e83bd5dc33b8963b393d1977acf4e95/packages/client-runtime/src/work-log/embeddedScripts.ts#L300-L324
[7]: https://github.com/zai-org/ZCode/blob/fec975905a2abd4c07e35c40d51fa097a2258ec9/apps/zcode-cli/packages/core/src/tool/handlers/bash-command-parser.ts#L53-L96
[8]: https://github.com/3f-consulting/spec-controller/blob/83ac34b197db03702ca7503a6a1ffc32f2f90a3d/packages/core/src/inputs/shell.ts
[9]: https://github.com/HazAT/ultimate/blob/08c0b24eacbb5c810c1a4d1db5d8da72a78728c7/extensions/coding-tools/bash-command.ts#L104
[10]: https://nodejs.org/api/util.html#utilparseargsconfig
[11]: https://yargs.js.org/
[12]: https://www.npmjs.com/package/citty
[13]: https://unbash.statichost.page/#input=if%20%5B%20-f%20%22%241%22%20%5D%3B%20then%20cat%20%22%241%22%3B%20fi
[14]: docs/MIGRATION-v5-to-v6.md
[15]: https://github.com/tree-sitter/tree-sitter-bash
[16]: https://github.com/webpro-nl/unbash/issues/6
[17]: https://github.com/un-ts/sh-syntax
[18]: https://github.com/mvdan/sh
[19]: https://github.com/webpro-nl/unbash/issues/7
[20]: https://github.com/vorpaljs/bash-parser
[21]: https://github.com/ericcornelissen/bash-parser
[22]: https://unbash.statichost.page
[23]: https://ast-explorer.dev/#eNoVjDsKwzAQRK8yDK5CyAGS2nVAId02jixZAbFr/Kls393rbh7zeBsrn5xLqpV3jr5X/XVzcYgOKRaD8LoNzffTBqFotgkZf8XtUW14oTdRIHaLq00WYscwpRFtCO8g2psm75n3toPHCdz+Ivg=
