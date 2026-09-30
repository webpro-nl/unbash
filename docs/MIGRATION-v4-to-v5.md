# Migrating from v4

v5 keeps `parse(source)` and `print(ast)` and changes the AST to preserve
command ordering, redirect scope, and source structure. This guide covers
migration from v4.0.12. Parsing remains lazy and returns best-effort partial
trees with script-local errors. Printing remains an opinionated formatter.

## Highlights

- Arguments and redirects in source order.
- Structured declaration assignments, parameter operations, and heredocs.
- Deeply readonly AST types, with source ranges for every word part.

## Main bug fixes

- Redirects retain their order among command arguments.
- Coprocess parsing distinguishes unnamed simple commands from named compound
  commands and keeps following pipes in the outer pipeline.
- Repeated `time` and `!` prefixes retain their order, including bare prefixes
  and `time -p --` options.
- Explicitly empty `for` and `select` lists remain empty when printed, instead
  of becoming omitted lists that iterate positional parameters.
- Heredocs handle continued delimiters and substitution boundaries correctly.
  Printing an unterminated body keeps a trailing continuation from consuming the
  closing delimiter.
- Line-continuation spans between word parts survive resolution and printing.
  Bracketed compound-array elements retain operators and whitespace, as in
  `[1|2]=x`.
- Replacement patterns beginning with `/` retain the correct pattern and
  replacement fields, including their source ranges.
- Printing arithmetic commands and arithmetic `for` headers inserts a space
  after unary `!`. Arithmetic expansions within Words retain their source
  spelling.
- Missing or invalid function bodies report script-local errors while preserving
  partial trees and following statements.

## Commands and redirects

`Command.name` remains directly accessible. `prefix` now contains ordered
Assignment and redirection items before the name. `suffix` contains ordered
Word, Assignment, and redirection items after it. These two lists are the stored
fields. `Command.redirects` is now a derived view: the redirections from
`prefix` followed by those from `suffix`, in source order. `Command.args` is the
matching view of the `suffix` words and declaration assignments without
redirections. Both are lazy prototype getters, cached on first access and absent
from JSON, object spread, and `structuredClone`.

For `A=1 >out export B=2 2>&1`, the prefix contains Assignment then Redirect,
the name is `export`, and the suffix contains Assignment then Redirect. Ordinary
declaration operands and options remain Words.

Narrow each item by `type` before reading its fields:

```ts
import { parse } from "unbash";

const command = parse("export NAME=value").commands[0].command;
if (command.type === "Command") {
  for (const item of command.args) {
    if (item.type === "Assignment" && item.value.type === "Word") {
      console.log(item.name, item.value.value);
    }
  }
}
```

Compound-command redirects belong to a Redirected node with `command` and
`redirects`. Statements no longer own redirects. Function and Coproc nodes own
their redirected bodies; a function's redirect takes effect when the function
runs. Pipeline members are command forms, never Statement wrappers.

A function body is a compound command or a Redirected compound command. A coproc
body is a simple command, a compound command, or a Redirected compound command.
A CompoundList body occurs only in recovery and always comes with a parse error:
a missing body is an empty list, and an invalid body, such as a simple command
after `f()` or a function definition after `coproc`, is kept as that list's
statement. A bare `coproc` now reports an error, as Bash does.

The Redirection union contains Redirect, HereString, and HereDoc. Redirect and
HereString have Word targets, or `undefined` when a target is missing during
recovery. Their optional `descriptor` replaces `fileDescriptor` and
`variableName`: FileDescriptor has a numeric `value`, and FileDescriptorVariable
has a `name`. Both retain source ranges. Dynamic targets such as `2>&$fd` remain
Words.

## Assignment and parameter children

Assignment is shared by command prefixes and declaration operands. Its `name` is
always a string and its `value` is always present, a Word or an ArrayValue;
array elements live in `value.elements`. The separate `array` property is
removed. Assignment fields and array elements resolve lazily and serialize
through `JSON.stringify`.

Assignment and parameter `index` fields are now Words. Read their raw spelling
through `index.text` and nested syntax through `index.parts`; `indexParts` is
removed.

A ParameterExpansion has an optional `operation` instead of separate `operator`,
`operand`, `slice`, and `replace` fields. When present, narrow it by `type`:
Default, Remove, Replace, Slice, CaseModification, Transform, Names, or Unknown
for retained recovery syntax. The operation owns its relevant operand,
pattern/replacement, or offset/length fields. Its range covers the suffix;
`operatorEnd` locates the operator boundary.

`prefix` replaces the `length` and `indirect` booleans: `"#"` means length and
`"!"` means indirection where the grammar recognizes them. `parameterPos` and
`parameterEnd` locate the parameter spelling. These fields describe syntax, not
runtime variable values or array types.

## Heredocs

HereDoc replaces v4's `target` with `delimiter`, a HereDocDelimiter that may be
`undefined` during recovery. It retains `text`, quote-removed `value`, `quoted`,
and its range. It is not a Word and has no executable children.

The always-present `body` is now a HereDocBody instead of a Word. It retains raw
`text`, its range, and lazy `parts` using heredoc expansion rules, but has no
`value`. `content` and `heredocQuoted` are removed. Use `delimiter?.quoted` for
quoting and the `<<-` operator for tab stripping.

The optional `closing` range records a real terminating delimiter; it can have
zero width when the delimiter's value is empty. The HereDoc node's range covers
its header. Body and closing ranges can lie outside the containing command
header, so source edits involving heredocs must account for those components
separately.

## Timing, negation, and loops

Pipeline no longer has `time` or `negated` flags. Time and Negation nodes retain
each ordered prefix around their `command`, including repeated prefixes and
valid bare forms without a child. `keywordEnd` locates the prefix spelling.
Time's optional `posix` and `endOfOptions` ranges preserve `-p` and `--`
respectively.

For and Select use `wordlist: undefined` when `in` is absent and `[]` when `in`
is explicitly empty. Preserve this distinction: omission iterates positional
parameters, while an empty list performs no iterations.

## Types, ranges, and JSON

Word now has `type: "Word"`, and all word parts have `pos` and `end`. Offsets
remain half-open UTF-16 code-unit ranges. CommandNode and PipelineNode describe
command grammar; SyntaxNode includes all tagged syntax. The v4 Node and
DeferredCommandExpansion types are removed.

AssignmentPrefix remains an alias for Assignment. RedirectOperator now covers
ordinary redirects; use `Redirection["operator"]` for all operators, including
`<<`, `<<-`, and `<<<`.

Raw `Word.text` and dequoted `Word.value` remain available. Ordinary command
words print from `text` without resolving `parts`; redirect targets may still
resolve `parts` for quoting. A dequoted value can still contain expansion
spelling and must not be treated as evaluated argv. Internal fields such as
`inner` and `innerStart` are removed from public expansion nodes.

Root and verbatim nested nodes index the caller's source. Decoded backtick
scripts own an enumerable `source` string, now retained by JSON. Their
descendants index that decoded source, not the parent's raw backtick spelling.

Read lazy fields directly or use `JSON.stringify` to include them. Object spread
and `structuredClone` of live nodes do not materialize prototype getters. The
`args` and `redirects` views on Command are getters that JSON omits as well;
after a JSON round trip, derive them from `suffix` and `prefix`. `errors`
remains local to each parsed script; reading root errors alone does not inspect
lazy nested scripts.
