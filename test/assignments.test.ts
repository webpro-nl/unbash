import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "../src/parser.ts";
import type { AssignmentPrefix, BraceGroup, Case, Command, Function, If, Pipeline } from "../src/types.ts";
import { computeWordParts } from "../src/parts.ts";

const getAssign = (src: string, i = 0): AssignmentPrefix => {
  const ast = parse(src);
  const cmd = ast.commands[0].command as Command;
  const assigns = cmd.prefix.filter((p) => p.type === "Assignment");
  return assigns[i] as AssignmentPrefix;
};

const assertCommandGroups = (source: string, expected: unknown) => {
  const ast = parse(source);
  assert.equal(ast.errors, undefined, source);
  assert.deepEqual(
    ast.commands.map(({ command, pos, end }) =>
      command.type === "Command"
        ? [command.type, pos, end, command.name?.text, command.prefix.map((assignment) => assignment.name)]
        : [command.type, pos, end],
    ),
    expected,
    source,
  );
  return ast;
};

// --- Basic scalar assignments ---

test("simple scalar assignment", () => {
  const a = getAssign("x=hello");
  assert.equal(a.name, "x");
  assert.equal(a.value?.text, "hello");
  assert.equal(a.append, undefined);
  assert.equal(a.index, undefined);
  assert.equal(a.array, undefined);
});

test("empty value assignment", () => {
  const a = getAssign("IFS=");
  assert.equal(a.name, "IFS");
  assert.equal(a.value?.text, "");
});

test("value with = sign", () => {
  const a = getAssign("a=b=c");
  assert.equal(a.name, "a");
  assert.equal(a.value?.text, "b=c");
});

test("path value", () => {
  const a = getAssign("PATH=/usr/local/bin");
  assert.equal(a.name, "PATH");
  assert.equal(a.value?.text, "/usr/local/bin");
});

test("numeric value", () => {
  const a = getAssign("n=42");
  assert.equal(a.name, "n");
  assert.equal(a.value?.text, "42");
});

// --- Append assignments ---

test("append scalar", () => {
  const a = getAssign("x+=more");
  assert.equal(a.name, "x");
  assert.equal(a.append, true);
  assert.equal(a.value?.text, "more");
});

test("append empty", () => {
  const a = getAssign("x+=");
  assert.equal(a.name, "x");
  assert.equal(a.append, true);
  assert.equal(a.value?.text, "");
});

// --- Indexed assignments ---

test("indexed assignment", () => {
  const a = getAssign("x[0]=val");
  assert.equal(a.name, "x");
  assert.equal(a.index, "0");
  assert.equal(a.value?.text, "val");
});

test("indexed assignment with variable index", () => {
  const a = getAssign("x[idx]=val");
  assert.equal(a.name, "x");
  assert.equal(a.index, "idx");
  assert.equal(a.value?.text, "val");
});

test("indexed append assignment", () => {
  const a = getAssign("x[0]+=val");
  assert.equal(a.name, "x");
  assert.equal(a.index, "0");
  assert.equal(a.append, true);
  assert.equal(a.value?.text, "val");
});

// --- Array assignments ---

test("simple array assignment", () => {
  const a = getAssign("x=(a b c)");
  assert.equal(a.name, "x");
  assert.ok(a.array);
  assert.equal(a.array!.length, 3);
  assert.equal(a.array![0].text, "a");
  assert.equal(a.array![1].text, "b");
  assert.equal(a.array![2].text, "c");
});

test("array append", () => {
  const a = getAssign("x+=(d e)");
  assert.equal(a.name, "x");
  assert.equal(a.append, true);
  assert.ok(a.array);
  assert.equal(a.array!.length, 2);
});

test("empty array", () => {
  const a = getAssign("x=()");
  assert.equal(a.name, "x");
  assert.ok(a.array);
  assert.equal(a.array!.length, 0);
});

test("array with quoted elements", () => {
  const a = getAssign("x=(\"hello world\" 'literal')");
  assert.equal(a.name, "x");
  assert.ok(a.array);
  assert.equal(a.array!.length, 2);
  assert.equal(a.array![0].text, '"hello world"');
  assert.equal(a.array![1].text, "'literal'");
});

test("array element comments are skipped", () => {
  // A `#` starting a word begins a comment; an unpaired quote inside it must not
  // swallow the closing paren.
  for (const comment of ["# don't", '# say "hi', "# `cmd"]) {
    const src = `x=(\n a\n ${comment}\n b\n)\necho after`;
    const ast = parse(src);
    assert.equal(ast.errors, undefined, src);
    assert.equal(ast.commands.length, 2, src);

    const a = getAssign(src);
    assert.equal(a.array!.length, 2, src);
    assert.deepEqual(
      a.array!.map((w) => w.text),
      ["a", "b"],
      src,
    );
  }
});

test("array comment starts only at a word boundary", () => {
  // `#` after `(` or whitespace comments; mid-word or after a quote it is literal.
  assert.deepEqual(
    getAssign("x=(#c\ny)").array!.map((w) => w.text),
    ["y"],
  );
  assert.deepEqual(
    getAssign("x=(a#b)").array!.map((w) => w.text),
    ["a#b"],
  );
  assert.deepEqual(
    getAssign('x=("q"#b)').array!.map((w) => w.text),
    ['"q"#b'],
  );
});

function assertHashLiteralInArray(source: string, expected: string[][]) {
  const ast = parse(source);
  assert.equal(ast.errors, undefined, source);
  assert.equal(ast.commands.length, 2, source);
  const assignment = (ast.commands[0].command as Command).prefix[0];
  assert.equal(assignment.type, "Assignment", source);
  if (assignment.type !== "Assignment") return;
  assert.deepEqual(
    assignment.array?.map((word) => [word.text, word.value]),
    expected,
    source,
  );
  const declare = ast.commands[1].command as Command;
  assert.equal(declare.name?.text, "declare", source);
  assert.deepEqual(
    declare.suffix.map((word) => word.text),
    ["-p", "a"],
    source,
  );
}

test("escaped whitespace keeps a following # literal in arrays (#68)", () => {
  assertHashLiteralInArray("a=(\\ # hi); declare -p a", [
    ["\\ #", " #"],
    ["hi", "hi"],
  ]);
});

test("closing substitution keeps a following # literal in arrays (#68)", () => {
  assertHashLiteralInArray("a=($(true)# hi); declare -p a", [
    ["$(true)#", "$(true)#"],
    ["hi", "hi"],
  ]);
});

test("extglob patterns keep # as literal pattern data", () => {
  // Bash matches `#b` against @(a|#b), so `#` is data here, not a comment.
  const ast = parse('case "#b" in @(a|#b)) echo m;; esac');
  assert.equal(ast.errors, undefined);
  assert.equal(ast.commands[0].command.type, "Case");
});

test("array with command substitution", () => {
  const input = "x=($(seq 1 5))";
  const a = getAssign(input);
  assert.equal(a.name, "x");
  assert.ok(a.array);
  assert.equal(a.array!.length, 1);
  assert.equal(computeWordParts(input, a.array![0])![0].type, "CommandExpansion");
});

test("associative array with index elements", () => {
  const a = getAssign("x=([a]=1 [b]=2)");
  assert.equal(a.name, "x");
  assert.ok(a.array);
  assert.equal(a.array!.length, 2);
});

// --- Value with expansions ---

test("value with simple expansion", () => {
  const input = "x=$HOME/bin";
  const a = getAssign(input);
  assert.equal(a.name, "x");
  assert.equal(a.value?.text, "$HOME/bin");
  assert.ok(computeWordParts(input, a.value!));
  assert.equal(computeWordParts(input, a.value!)![0].type, "SimpleExpansion");
});

test("repeated unquoted expansions stay in one assignment value (#180)", () => {
  const source = "var=$ITEM/word-$ITEM/a/b";
  const ast = parse(source);
  assert.equal(ast.errors, undefined);
  const value = ((ast.commands[0].command as Command).prefix[0] as AssignmentPrefix).value!;
  assert.deepEqual([value.text, value.pos, value.end], ["$ITEM/word-$ITEM/a/b", 4, 24]);
  assert.deepEqual(
    computeWordParts(source, value)?.map(({ type, text }) => [type, text]),
    [
      ["SimpleExpansion", "$ITEM"],
      ["Literal", "/word-"],
      ["SimpleExpansion", "$ITEM"],
      ["Literal", "/a/b"],
    ],
  );
});

test("value with command substitution", () => {
  const input = "y=$(echo hi)";
  const a = getAssign(input);
  assert.equal(a.name, "y");
  assert.equal(computeWordParts(input, a.value!)![0].type, "CommandExpansion");
  assert.ok((computeWordParts(input, a.value!)![0] as any).script);
});

test("value with double-quoted expansion", () => {
  const input = 'z="hello $name"';
  const a = getAssign(input);
  assert.equal(a.name, "z");
  assert.equal(a.value?.text, '"hello $name"');
  assert.ok(computeWordParts(input, a.value!));
  assert.equal(computeWordParts(input, a.value!)![0].type, "DoubleQuoted");
});

test("value with param expansion", () => {
  const input = "x=${var:-default}";
  const a = getAssign(input);
  assert.equal(a.name, "x");
  assert.ok(computeWordParts(input, a.value!));
  assert.equal(computeWordParts(input, a.value!)![0].type, "ParameterExpansion");
});

test("parameter expansion operands keep unquoted pipes (#290)", () => {
  for (const [source, roots, operand] of [
    [
      '#!/usr/bin/env bash\n\nHELLO="${HELLO:-YES|NO}"\n\necho "cool"\n',
      [
        ["Command", 21, 45, undefined, ["HELLO"]],
        ["Command", 47, 58, "echo", []],
      ],
      ["YES|NO", 37, 43],
    ],
    [
      '#!/usr/bin/env bash\n\nHELLO="${HELLO:-YES|NO|MAYBE}"\n\necho "cool"\n',
      [
        ["Command", 21, 51, undefined, ["HELLO"]],
        ["Command", 53, 64, "echo", []],
      ],
      ["YES|NO|MAYBE", 37, 49],
    ],
    [
      '#!/usr/bin/env bash\n\nHELLO="${HELLO:-"YES|NO|MAYBE"}"\n\necho "cool"\n',
      [
        ["Command", 21, 53, undefined, ["HELLO"]],
        ["Command", 55, 66, "echo", []],
      ],
      ['"YES|NO|MAYBE"', 37, 51],
    ],
  ] as const) {
    const ast = assertCommandGroups(source, roots);
    const command = ast.commands[0].command;
    assert.equal(command.type, "Command", source);
    if (command.type !== "Command") continue;
    const assignment = command.prefix[0];
    assert.equal(assignment.type, "Assignment", source);
    if (assignment.type !== "Assignment") continue;
    const quoted = assignment.value?.parts?.[0];
    assert.equal(quoted?.type, "DoubleQuoted", source);
    if (quoted?.type !== "DoubleQuoted") continue;
    const expansion = quoted.parts[0];
    assert.equal(expansion.type, "ParameterExpansion", source);
    if (expansion.type !== "ParameterExpansion") continue;
    assert.deepEqual([expansion.operand?.text, expansion.operand?.pos, expansion.operand?.end], operand, source);
  }
});

// --- Multiple assignments ---

test("multiple assignments", () => {
  const a0 = getAssign("A=1 B=2 cmd", 0);
  const a1 = getAssign("A=1 B=2 cmd", 1);
  assert.equal(a0.name, "A");
  assert.equal(a0.value?.text, "1");
  assert.equal(a1.name, "B");
  assert.equal(a1.value?.text, "2");
});

test("env var prefix with command", () => {
  const ast = parse("NODE_ENV=production node app.js");
  const cmd = ast.commands[0].command as Command;
  const a = cmd.prefix[0] as AssignmentPrefix;
  assert.equal(a.name, "NODE_ENV");
  assert.equal(a.value?.text, "production");
  assert.equal(cmd.name?.text, "node");
});

test("assignment-only commands end at newlines before if (#228)", () => {
  assertCommandGroups("a= c=\nb=\nif true; then true; fi", [
    ["Command", 0, 5, undefined, ["a", "c"]],
    ["Command", 6, 8, undefined, ["b"]],
    ["If", 9, 31],
  ]);
  assertCommandGroups("a= c= b=\nif true; then true; fi", [
    ["Command", 0, 8, undefined, ["a", "c", "b"]],
    ["If", 9, 31],
  ]);
});

test("multiple assignments do not absorb export across a newline (#295)", () => {
  assertCommandGroups("a=a\nb=b c=c\nexport a\nexport b c", [
    ["Command", 0, 3, undefined, ["a"]],
    ["Command", 4, 11, undefined, ["b", "c"]],
    ["Command", 12, 20, "export", []],
    ["Command", 21, 31, "export", []],
  ]);
});

test("negated conditions preserve multiple assignment prefixes (#318)", () => {
  const cases = [
    [
      "if ! IFS=$'\\n' REPLY=$(cat response); then :; else :; fi;",
      56,
      [
        ["IFS", 5, 14],
        ["REPLY", 15, 36],
      ],
    ],
    [
      "if ! FOO='foo' BAR='bar'; then :; else :; fi;",
      44,
      [
        ["FOO", 5, 14],
        ["BAR", 15, 24],
      ],
    ],
  ] as const;

  for (const [source, end, assignments] of cases) {
    const ast = assertCommandGroups(source, [["If", 0, end]]);
    const pipeline = (ast.commands[0].command as If).clause.commands[0].command as Pipeline;
    const command = pipeline.commands[0] as Command;
    assert.deepEqual([pipeline.type, pipeline.negated, command.type], ["Pipeline", true, "Command"], source);
    assert.deepEqual(
      command.prefix.map((assignment) => [assignment.name, assignment.pos, assignment.end]),
      assignments,
      source,
    );
    if (source === cases[0][0]) {
      const expansion = command.prefix[1].value?.parts?.[0];
      assert.equal(expansion?.type, "CommandExpansion", source);
      if (expansion?.type !== "CommandExpansion") return;
      const nested = expansion.script?.commands[0].command as Command;
      assert.deepEqual([expansion.text, nested.name?.text], ["$(cat response)", "cat"], source);
    }
  }
});

test("assignment-only commands end before if inside functions (#342)", () => {
  const source = `handle_mime() {
  mime="$1" uncompressed_filename="$2"

  if [ -z "$decompress" ]; then
    case "$mime" in
    esac
  fi
}`;
  const cases = [
    [source, 123, [58, 121], [92, 116]],
    [source.replace('filename="$2"', 'filename="$2";'), 124, [59, 122], [93, 117]],
  ] as const;

  for (const [source, end, ifSpan, caseSpan] of cases) {
    const ast = assertCommandGroups(source, [["Function", 0, end]]);
    const fn = ast.commands[0].command as Function;
    const body = (fn.body as BraceGroup).body.commands;
    const assignments = body[0].command as Command;
    const caseNode = (body[1].command as If).then.commands[0].command as Case;
    assert.deepEqual(
      [
        fn.body.type,
        body.map(({ command, pos, end }) => [command.type, pos, end]),
        assignments.prefix.map(({ name, pos, end }) => [name, pos, end]),
        [caseNode.type, caseNode.pos, caseNode.end, caseNode.items],
      ],
      [
        "BraceGroup",
        [
          ["Command", 18, 54],
          ["If", ...ifSpan],
        ],
        [
          ["mime", 18, 27],
          ["uncompressed_filename", 28, 54],
        ],
        ["Case", ...caseSpan, []],
      ],
      source,
    );
  }
});

// --- Text field preserved ---

test("text field always present", () => {
  const a = getAssign("x=hello");
  assert.equal(a.text, "x=hello");
});

test("text field for array", () => {
  const a = getAssign("x=(a b c)");
  assert.equal(a.text, "x=(a b c)");
});

test("text field for append", () => {
  const a = getAssign("x+=more");
  assert.equal(a.text, "x+=more");
});

test("text field for indexed", () => {
  const a = getAssign("x[0]=val");
  assert.equal(a.text, "x[0]=val");
});

// --- Assignment as prefix ---

test("assignment prefix on command", () => {
  const ast = parse("NODE_ENV=production program");
  const c = ast.commands[0].command as Command;
  assert.equal(c.name?.text, "program");
  const p = c.prefix[0];
  assert.equal(p.type, "Assignment");
  if (p.type === "Assignment") assert.equal(p.text, "NODE_ENV=production");
});

test("assignment-only (no command)", () => {
  const ast = parse("FOO=bar");
  const c = ast.commands[0].command as Command;
  assert.equal(c.name, undefined);
  const p = c.prefix[0];
  assert.equal(p.type, "Assignment");
  if (p.type === "Assignment") assert.equal(p.text, "FOO=bar");
});

// --- Array assignments ---

test("array assignment in prefix", () => {
  const ast = parse("x=(a b c)");
  const c = ast.commands[0].command as Command;
  assert.equal(c.prefix.length, 1);
  const p = c.prefix[0] as import("../src/types.ts").AssignmentPrefix;
  assert.equal(p.type, "Assignment");
  assert.equal(p.text, "x=(a b c)");
});

test("declare with array assignment", () => {
  const ast = parse("declare -a arr=(one two three)");
  const c = ast.commands[0].command as Command;
  assert.equal(c.name?.text, "declare");
  assert.deepEqual(
    c.suffix.map((s) => s.text),
    ["-a", "arr=(one two three)"],
  );
});

test("associative array assignment", () => {
  const ast = parse("declare -A map=([a]=1 [b]=2)");
  const c = ast.commands[0].command as Command;
  assert.deepEqual(
    c.suffix.map((s) => s.text),
    ["-A", "map=([a]=1 [b]=2)"],
  );
});

test("array append with mixed elements", () => {
  const ast = parse('a+=(foo "bar" $(baz))');
  assert.ok(ast.commands.length > 0);
});

// --- Assignment edge cases (tokenizer) ───────────────────────────────

test("assignment in suffix is a regular word", () => {
  const c = parse("echo FOO=bar").commands[0].command as Command;
  assert.equal(c.name?.text, "echo");
  assert.equal(c.suffix[0].text, "FOO=bar");
});

test("empty assignment before command", () => {
  const c = parse("IFS= read -r line").commands[0].command as Command;
  assert.ok(c.prefix.some((p) => p.type === "Assignment" && p.text === "IFS="));
  assert.equal(c.name?.text, "read");
});

test("a=b=c is single assignment (value is b=c)", () => {
  const c = parse("a=b=c").commands[0].command as Command;
  assert.ok(c.prefix.some((p) => p.type === "Assignment" && p.text === "a=b=c"));
});

test("=a is a regular word (not assignment)", () => {
  const c = parse("echo =a").commands[0].command as Command;
  assert.equal(c.suffix[0].text, "=a");
});

test("multiple assignments before command", () => {
  const c = parse("A=1 B=2 cmd").commands[0].command as Command;
  assert.equal(c.prefix.filter((p) => p.type === "Assignment").length, 2);
  assert.equal(c.name?.text, "cmd");
});

test("quoted assignment name or equals is a command word", () => {
  for (const [source, raw, value] of [
    [String.raw`X\=1 true`, String.raw`X\=1`, "X=1"],
    ['X"="1 true', 'X"="1', "X=1"],
    ['"X"=1 true', '"X"=1', "X=1"],
    ['"array"[key]=value true', '"array"[key]=value', "array[key]=value"],
    [String.raw`array\[key]=value true`, String.raw`array\[key]=value`, "array[key]=value"],
  ]) {
    const c = parse(source).commands[0].command as Command;
    assert.equal(c.prefix.length, 0, source);
    assert.equal(c.name?.text, raw, source);
    assert.equal(c.name?.value, value, source);
    assert.deepEqual(
      c.suffix.map((word) => word.text),
      ["true"],
      source,
    );
  }
});

test("quotes and escapes after an unquoted assignment operator remain assignment syntax", () => {
  for (const source of [String.raw`X=a\ b true`, 'X="a b" true', 'array["key"]=value true', 'X\\\n="v" true']) {
    const c = parse(source).commands[0].command as Command;
    assert.equal(c.prefix.length, 1, source);
    assert.equal(c.prefix[0].type, "Assignment", source);
    assert.equal(c.name?.text, "true", source);
  }
});

test("nested and expanded array indexes remain assignment syntax", () => {
  for (const [source, index] of [
    ["array[nested[0]]=value true", "nested[0]"],
    ["array[i=0]=value true", "i=0"],
    ["array[$((nested[0]))]=value true", "$((nested[0]))"],
    ["array[`echo ]`]=value true", "`echo ]`"],
    ["array[$(echo ] >/dev/null; printf 0)]=value true", "$(echo ] >/dev/null; printf 0)"],
  ]) {
    const c = parse(source).commands[0].command as Command;
    assert.equal(c.prefix.length, 1, source);
    assert.equal(c.prefix[0].type, "Assignment", source);
    if (c.prefix[0].type === "Assignment") {
      assert.equal(c.prefix[0].name, "array", source);
      assert.equal(c.prefix[0].index, index, source);
      assert.equal(c.prefix[0].value?.text, "value", source);
    }
    assert.equal(c.name?.text, "true", source);
  }
});

test("indexed assignments keep command substitutions in the index structured", () => {
  const assignment = getAssign("array[1+$(danger)]=value true");
  assert.equal(Object.getPrototypeOf(assignment), Object.prototype);
  assert.equal(assignment.index, "1+$(danger)");
  const expansion = assignment.indexParts?.find((part) => part.type === "CommandExpansion");
  assert.equal(expansion?.type, "CommandExpansion");
  if (expansion?.type !== "CommandExpansion") return;
  const command = expansion.script?.commands[0].command;
  assert.equal(command?.type, "Command");
  if (command?.type === "Command") assert.equal(command.name?.value, "danger");
  const serialized = JSON.parse(JSON.stringify(assignment));
  assert.ok(serialized.indexParts.some((part: { type: string }) => part.type === "CommandExpansion"));
});

test("line continuations around append assignment operators are ignored", () => {
  for (const [source, index] of [
    ["X\\\n+=value true", undefined],
    ["X+\\\n=value true", undefined],
    ["array[nested[0]]+\\\n=value true", "nested[0]"],
  ]) {
    const c = parse(source).commands[0].command as Command;
    assert.equal(c.prefix[0].type, "Assignment", source);
    if (c.prefix[0].type === "Assignment") {
      assert.equal(c.prefix[0].name, index === undefined ? "X" : "array", source);
      assert.equal(c.prefix[0].index, index, source);
      assert.equal(c.prefix[0].append, true, source);
      assert.equal(c.prefix[0].value?.text, "value", source);
    }
    assert.equal(c.name?.text, "true", source);
  }
});

// --- Command prefixes (assignments and redirects) ---

test("a command prefix demotes the reserved word that follows it", () => {
  // Bash recognizes a reserved word only as the first word of a command, so
  // `FOO=bar for` runs the command `for` and `>/dev/null [[` runs `[[`.
  for (const [source, name, prefixLength, redirectCount] of [
    ["FOO=bar for", "for", 1, 0],
    ["FOO=bar if", "if", 1, 0],
    ["FOO=bar [[ foo == foo ]]", "[[", 1, 0],
    ["FOO=bar ]]", "]]", 1, 0],
    ["FOO=bar {", "{", 1, 0],
    ["FOO=bar time", "time", 1, 0],
    [">/dev/null for", "for", 0, 1],
    ["FOO=bar 2>/dev/null while", "while", 1, 1],
  ] as const) {
    const c = parse(source).commands[0].command as Command;
    assert.equal(c.type, "Command", source);
    assert.equal(c.name?.text, name, source);
    assert.equal(c.prefix.length, prefixLength, source);
    assert.equal(c.redirects.length, redirectCount, source);
    assert.equal(parse(source).errors, undefined, source);
  }
});

test("reserved words stay reserved without a prefix", () => {
  for (const [source, type] of [
    ["for x in a; do :; done", "For"],
    ["[[ foo == foo ]]", "TestCommand"],
    ["{ :; }", "BraceGroup"],
    ["if :; then :; fi", "If"],
    ["while false; do :; done", "While"],
  ] as const)
    assert.equal(parse(source).commands[0].command.type, type, source);
});

test("assignments and redirects interleave in a command prefix", () => {
  const c = parse("A=1 >/dev/null B=2 2>&1 C=3 cmd arg").commands[0].command as Command;
  assert.equal(c.name?.text, "cmd");
  assert.deepEqual(
    c.prefix.map((p) => (p.type === "Assignment" ? `${p.name}=${p.value?.text}` : p.type)),
    ["A=1", "B=2", "C=3"],
  );
  assert.deepEqual(
    c.redirects.map((r) => r.operator),
    [">", ">&"],
  );
  assert.deepEqual(
    c.suffix.map((w) => w.text),
    ["arg"],
  );
});

test("an array subscript in assignment position runs to its matching bracket", () => {
  // Bash reads a[...] as a matched pair there, so metacharacters inside are ordinary
  // text: `a[1 + 2]=7` sets index 3, not three separate words.
  for (const [source, index, value] of [
    ["a[1 + 2]=7", "1 + 2", "7"],
    ["a[3|4]=8", "3|4", "8"],
    ["a[(1+2)*3]=9", "(1+2)*3", "9"],
    ["a[x[(1)]]=9", "x[(1)]", "9"],
    ["a[1 && 2]=9", "1 && 2", "9"],
    ["a[1 > 2]=9", "1 > 2", "9"],
    ['a["x y"]=9', '"x y"', "9"],
  ] as const) {
    const c = parse(source).commands[0].command as Command;
    assert.equal(c.prefix.length, 1, source);
    assert.equal(c.prefix[0].type, "Assignment", source);
    if (c.prefix[0].type === "Assignment") {
      assert.equal(c.prefix[0].name, "a", source);
      assert.equal(c.prefix[0].index, index, source);
      assert.equal(c.prefix[0].value?.text, value, source);
    }
    assert.equal(c.redirects.length, 0, source);
    assert.equal(parse(source).errors, undefined, source);
  }
});

test("a subscript stays a matched pair after another prefix element", () => {
  for (const source of ["x=1 a[1 + 2]=7", ">/dev/null a[1 + 2]=7"]) {
    const c = parse(source).commands[0].command as Command;
    const assignment = c.prefix.find((p) => p.type === "Assignment" && p.name === "a");
    assert.equal(assignment?.type, "Assignment", source);
    if (assignment?.type === "Assignment") assert.equal(assignment.index, "1 + 2", source);
  }
});

test("outside assignment position a subscript is not a matched pair", () => {
  // `echo a[3|4]=8` is a pipeline in bash, and `echo a[(1+2)*3]=9` is a syntax error.
  const pipeline = parse("echo a[3|4]=8").commands[0].command;
  assert.equal(pipeline.type, "Pipeline");
  assert.equal(parse("echo a[1 + 2]=7").commands[0].command.suffix?.length, 3);
  assert.ok(parse("echo a[(1+2)*3]=9").errors);
});

test("an unclosed subscript does not swallow the rest of the script", () => {
  const script = parse("a[1 + 2\necho hi");
  assert.equal(script.commands.length, 2);
  assert.equal(script.commands[1].command.name?.text, "echo");
});
