import { nodeOfType } from "./ast-helpers.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "../src/parser.ts";
import type { Assignment, Command, ParameterExpansionPart, ParameterOperation, Word } from "../src/types.ts";
import { computeWordParts } from "../src/parts.ts";

const getCmd = (ast: ReturnType<typeof parse>, i = 0) => nodeOfType(ast.commands[i].command, "Command");
const getPart = (input: string): ParameterExpansionPart => {
  const c = getCmd(parse(input));
  const parts = computeWordParts(input, c.suffix[0])!;
  return nodeOfType(parts[0], "ParameterExpansion");
};
const getAssignment = (ast: ReturnType<typeof parse>, i = 0): Assignment => {
  return nodeOfType(getCmd(ast, i).prefix[0], "Assignment");
};
const getParam = (word: Word): ParameterExpansionPart => {
  return nodeOfType(word.parts?.[0], "ParameterExpansion");
};
const getQuotedParam = (word: Word): ParameterExpansionPart => {
  const quoted = nodeOfType(word.parts?.[0], "DoubleQuoted");
  return nodeOfType(quoted.parts[0], "ParameterExpansion");
};

function getOperand(part: ParameterExpansionPart): Word | undefined {
  const operation = part.operation;
  assert.ok(operation && "operand" in operation);
  return operation.operand;
}

function getOperation<T extends ParameterOperation["type"]>(part: ParameterExpansionPart, type: T) {
  return nodeOfType(part.operation, type);
}

// --- Simple expansions ---

test("simple ${var}", () => {
  const p = getPart("echo ${var}");
  assert.equal(p.type, "ParameterExpansion");
  assert.equal(p.parameter, "var");
  assert.equal(p.text, "${var}");
  assert.equal(p.operation?.operator, undefined);
  assert.equal(p.prefix, undefined);
});

test("${#} special variable", () => {
  const p = getPart("echo ${#}");
  assert.equal(p.parameter, "#");
  assert.equal(p.prefix, undefined);
});

test("${@} special variable", () => {
  const p = getPart("echo ${@}");
  assert.equal(p.parameter, "@");
});

test("${?} special variable", () => {
  const p = getPart("echo ${?}");
  assert.equal(p.parameter, "?");
});

// --- Default/assign/error/alt with colon ---

test("${var:-default}", () => {
  const p = getPart("echo ${var:-default}");
  assert.equal(p.parameter, "var");
  assert.equal(p.operation?.operator, ":-");
  assert.equal(getOperand(p)!.text, "default");
});

test("ANSI-C \\c operand ends where the skip and decode paths agree", () => {
  const src = "echo ${u:-$'\\c'} x";
  const c = getCmd(parse(src));
  const p = computeWordParts(src, c.suffix[0])![0] as ParameterExpansionPart;
  assert.equal(p.text, "${u:-$'\\c'}");
  assert.equal(getOperand(p)!.text, "$'\\c'");
  assert.deepEqual(getOperand(p)!.parts, [{ type: "AnsiCQuoted", pos: 10, end: 15, text: "$'\\c'", value: "\\c" }]);
  assert.equal(nodeOfType(c.suffix[1], "Assignment", "Word").value, "x");

  const pairSrc = "echo ${u:-$'\\c\\\\'} y";
  const c2 = getCmd(parse(pairSrc));
  const p2 = computeWordParts(pairSrc, c2.suffix[0])![0] as ParameterExpansionPart;
  assert.equal(p2.text, "${u:-$'\\c\\\\'}");
  assert.deepEqual(getOperand(p2)!.parts, [
    { type: "AnsiCQuoted", pos: 10, end: 17, text: "$'\\c\\\\'", value: "\x1c" },
  ]);
  assert.equal(nodeOfType(c2.suffix[1], "Assignment", "Word").value, "y");

  const escapedQuoteSrc = "echo ${u:-$'\\c\\''} z";
  const c3 = getCmd(parse(escapedQuoteSrc));
  const p3 = computeWordParts(escapedQuoteSrc, c3.suffix[0])![0] as ParameterExpansionPart;
  assert.equal(p3.text, "${u:-$'\\c\\''}");
  assert.deepEqual(getOperand(p3)!.parts, [
    { type: "AnsiCQuoted", pos: 10, end: 17, text: "$'\\c\\''", value: "\x1c'" },
  ]);
  assert.equal(nodeOfType(c3.suffix[1], "Assignment", "Word").value, "z");
});

test("${var:=assigned}", () => {
  const p = getPart("echo ${var:=assigned}");
  assert.equal(p.parameter, "var");
  assert.equal(p.operation?.operator, ":=");
  assert.equal(getOperand(p)!.text, "assigned");
});

test("${var:+alternate}", () => {
  const p = getPart("echo ${var:+alternate}");
  assert.equal(p.parameter, "var");
  assert.equal(p.operation?.operator, ":+");
  assert.equal(getOperand(p)!.text, "alternate");
});

test("semicolon in parameter expansion operand (#267)", () => {
  for (const [source, end, operandEnd, literal] of [
    ["${a:+$a;}", 9, 8, ";"],
    ["${a:+$a; }", 10, 9, "; "],
  ] as const) {
    const ast = parse(source);
    assert.equal(ast.errors, undefined, source);
    assert.equal(ast.end, end, source);
    const word = getCmd(ast).name;
    assert.equal(word?.text, source, source);
    const part = word?.parts?.[0];
    assert.equal(part?.type, "ParameterExpansion", source);
    if (part?.type !== "ParameterExpansion") continue;
    assert.equal(part.parameter, "a", source);
    assert.equal(part.operation?.operator, ":+", source);
    assert.deepEqual(
      [getOperand(part)?.pos, getOperand(part)?.end, getOperand(part)?.text],
      [5, operandEnd, `$a${literal}`],
      source,
    );
    assert.deepEqual(
      getOperand(part)?.parts,
      [
        { type: "SimpleExpansion", pos: 5, end: 7, text: "$a" },
        { type: "Literal", pos: 7, end: operandEnd, value: literal, text: literal },
      ],
      source,
    );
  }
});

test("${var:?error msg}", () => {
  const p = getPart("echo ${var:?error msg}");
  assert.equal(p.parameter, "var");
  assert.equal(p.operation?.operator, ":?");
  assert.equal(getOperand(p)!.text, "error msg");
});

test("punctuation remains part of parameter operands (#280)", () => {
  const source = [
    "#!/usr/bin/env bash",
    "",
    ": ${ASDF:=qwer-zxcv}",
    ": ${ASDF:=qwer}",
    "ASDF=${ASDF:-qwer-zxcv}",
    ": ${ASDF:?qwer+zxcv}",
    ": ${ASDF:?qwer#zxcv}",
    ": ${ASDF:?qwer@zxcv}",
    ": ${ASDF:?qwer=zxcv}",
    ": ${ASDF:+qwer-asdf}",
    "",
  ].join("\n");
  const ast = parse(source);
  const words = ast.commands.map((_, i) => (i === 2 ? getAssignment(ast, i).value : getCmd(ast, i).suffix[0]));

  assert.equal(ast.errors, undefined);
  assert.deepEqual(
    words.map((word) => {
      const part = getParam(nodeOfType(word, "Word"));
      return [
        part.operation?.operator,
        getOperand(part)?.text,
        getOperand(part)?.pos,
        getOperand(part)?.end,
        getOperand(part)?.parts,
      ];
    }),
    [
      [":=", "qwer-zxcv", 31, 40, undefined],
      [":=", "qwer", 52, 56, undefined],
      [":-", "qwer-zxcv", 71, 80, undefined],
      [":?", "qwer+zxcv", 92, 101, undefined],
      [":?", "qwer#zxcv", 113, 122, undefined],
      [":?", "qwer@zxcv", 134, 143, undefined],
      [":?", "qwer=zxcv", 155, 164, undefined],
      [":+", "qwer-asdf", 176, 185, undefined],
    ],
  );
});

// --- Default/assign/error/alt without colon ---

test("${var-default}", () => {
  const p = getPart("echo ${var-default}");
  assert.equal(p.parameter, "var");
  assert.equal(p.operation?.operator, "-");
  assert.equal(getOperand(p)!.text, "default");
});

test("${var=default}", () => {
  const p = getPart("echo ${var=default}");
  assert.equal(p.parameter, "var");
  assert.equal(p.operation?.operator, "=");
  assert.equal(getOperand(p)!.text, "default");
});

test("${var+alt}", () => {
  const p = getPart("echo ${var+alt}");
  assert.equal(p.parameter, "var");
  assert.equal(p.operation?.operator, "+");
  assert.equal(getOperand(p)!.text, "alt");
});

test("${var?err}", () => {
  const p = getPart("echo ${var?err}");
  assert.equal(p.parameter, "var");
  assert.equal(p.operation?.operator, "?");
  assert.equal(getOperand(p)!.text, "err");
});

// --- Length ---

test("${#var} length", () => {
  const p = getPart("echo ${#var}");
  assert.equal(p.parameter, "var");
  assert.equal(p.prefix, "#");
  assert.equal(p.operation?.operator, undefined);
});

test("${#arr[@]} array length", () => {
  const p = getPart("echo ${#arr[@]}");
  assert.equal(p.parameter, "arr");
  assert.equal(p.index?.text, "@");
  assert.equal(p.prefix, "#");
});

test("${#path} length of path var", () => {
  const p = getPart("echo ${#path}");
  assert.equal(p.parameter, "path");
  assert.equal(p.prefix, "#");
});

// --- Prefix strip ---

test("${path#*/} shortest prefix strip", () => {
  const p = getPart("echo ${path#*/}");
  assert.equal(p.parameter, "path");
  assert.equal(p.operation?.operator, "#");
  assert.equal(getOperand(p)!.text, "*/");
});

test("${path##*/} longest prefix strip", () => {
  const p = getPart("echo ${path##*/}");
  assert.equal(p.parameter, "path");
  assert.equal(p.operation?.operator, "##");
  assert.equal(getOperand(p)!.text, "*/");
});

// --- Suffix strip ---

test("${path%/*} shortest suffix strip", () => {
  const p = getPart("echo ${path%/*}");
  assert.equal(p.parameter, "path");
  assert.equal(p.operation?.operator, "%");
  assert.equal(getOperand(p)!.text, "/*");
});

test("${path%%/*} longest suffix strip", () => {
  const p = getPart("echo ${path%%/*}");
  assert.equal(p.parameter, "path");
  assert.equal(p.operation?.operator, "%%");
  assert.equal(getOperand(p)!.text, "/*");
});

test("escaped braces remain complete strip operands (#259)", () => {
  const source = 'name="${value#\\{sd.cicd.}"\necho "${name%\\}}"';
  const ast = parse(source);
  const operands = [
    getQuotedParam(nodeOfType(getAssignment(ast).value, "Word")),
    getQuotedParam(nodeOfType(getCmd(ast, 1).suffix[0], "Word")),
  ];

  assert.equal(ast.errors, undefined);
  assert.deepEqual(
    operands.map((part) => [
      part.operation?.operator,
      getOperand(part)?.text,
      getOperand(part)?.value,
      getOperand(part)?.pos,
      getOperand(part)?.end,
    ]),
    [
      ["#", "\\{sd.cicd.", "{sd.cicd.", 14, 24],
      ["%", "\\}", "}", 40, 42],
    ],
  );
});

test("a quoted expansion remains inside a quoted suffix pattern (#254)", () => {
  const source = 'echo "${1%"$2"*}"';
  const ast = parse(source);
  const word = nodeOfType(getCmd(ast).suffix[0], "Word");
  const part = getQuotedParam(word);

  assert.equal(ast.errors, undefined);
  assert.deepEqual(
    [
      part.parameter,
      part.operation?.operator,
      getOperand(part)?.text,
      getOperand(part)?.value,
      getOperand(part)?.pos,
      getOperand(part)?.end,
    ],
    ["1", "%", '"$2"*', "$2*", 10, 15],
  );
  assert.deepEqual(getOperand(part)?.parts, [
    {
      type: "DoubleQuoted",
      pos: 10,
      end: 14,
      text: '"$2"',
      parts: [{ type: "SimpleExpansion", pos: 11, end: 13, text: "$2" }],
    },
    { type: "Literal", pos: 14, end: 15, value: "*", text: "*" },
  ]);
});

test("closing brackets stay in suffix operands without swallowing later roots (#274, #285)", () => {
  for (const { source, roots, assignmentIndex, assignment, operand } of [
    {
      source: [
        "#!/bin/bash",
        "",
        "# comment is grey — syntax highlighting works",
        'temp="${temp%]*}"',
        "",
        "# comment is not grey — syntax highlighting is broken here",
        "",
        ': "$"',
        "# comment is grey again — syntax highlighting somehow restored",
        "",
      ].join("\n"),
      roots: [
        ["Command", 59, 76],
        ["Command", 138, 143],
      ],
      assignmentIndex: 0,
      assignment: ["temp", 59, 76],
      operand: ["]*", 72, 74],
    },
    {
      source: [
        "#!/bin/bash",
        "",
        "a='abc[]'",
        "",
        'a="${a%]}"',
        'printf "Something broke here!\\n"',
        "",
        "if false; then",
        "    echo 'Just showing some further code'",
        "    echo 'Ooops!'",
        "fi",
        "",
      ].join("\n"),
      roots: [
        ["Command", 13, 22],
        ["Command", 24, 34],
        ["Command", 35, 67],
        ["If", 69, 146],
      ],
      assignmentIndex: 1,
      assignment: ["a", 24, 34],
      operand: ["]", 31, 32],
    },
  ] as const) {
    const ast = parse(source);
    const assigned = getAssignment(ast, assignmentIndex);
    const part = getQuotedParam(nodeOfType(assigned.value, "Word"));

    assert.equal(ast.errors, undefined, source);
    assert.deepEqual(
      ast.commands.map(({ command }) => [command.type, command.pos, command.end]),
      roots,
      source,
    );
    assert.deepEqual([assigned.name, assigned.pos, assigned.end], assignment, source);
    assert.deepEqual([getOperand(part)?.text, getOperand(part)?.pos, getOperand(part)?.end], operand, source);
  }
});

// --- Replacement ---

test("${var/pat/rep} replace first", () => {
  const p = getPart("echo ${version/beta/rc}");
  assert.equal(p.parameter, "version");
  assert.equal(p.operation?.operator, "/");
  assert.equal(getOperation(p, "Replace")!.pattern.text, "beta");
  assert.equal(getOperation(p, "Replace")!.replacement.text, "rc");
});

test("${var//pat/rep} replace all", () => {
  const p = getPart("echo ${version//./,}");
  assert.equal(p.parameter, "version");
  assert.equal(p.operation?.operator, "//");
  assert.equal(getOperation(p, "Replace")!.pattern.text, ".");
  assert.equal(getOperation(p, "Replace")!.replacement.text, ",");
});

test("literal slash replacement patterns own their spelling and ranges", () => {
  for (const [source, pattern, patternEnd, replacement, replacementPos, replacementEnd] of [
    ["echo ${v////X}", "/", 11, "X", 12, 13],
    ["echo ${v///X}", "/X", 12, "", 12, 12],
    ["echo ${v///}", "/", 11, "", 11, 11],
    ["echo ${v////}", "/", 11, "", 12, 12],
    ["echo ${v//}", "", 10, "", 10, 10],
    ["echo ${v//\\\n//X}", "\\\n/", 13, "X", 14, 15],
  ] as const) {
    const operation = getOperation(getPart(source), "Replace");
    assert.equal(operation.operator, "//", source);
    assert.equal(operation.operatorEnd, 10, source);
    assert.deepEqual(
      [operation.pattern.text, operation.pattern.pos, operation.pattern.end],
      [pattern, 10, patternEnd],
      source,
    );
    assert.deepEqual(
      [operation.replacement.text, operation.replacement.pos, operation.replacement.end],
      [replacement, replacementPos, replacementEnd],
      source,
    );
  }
});

test("slash pattern handling preserves escaped, quoted, and empty anchored patterns", () => {
  for (const [source, operator, pattern, replacement] of [
    ["echo ${v//\\//X}", "//", "\\/", "X"],
    ['echo ${v//"/"/X}', "//", '"/"', "X"],
    ["echo ${v/#/X}", "/#", "", "X"],
    ["echo ${v/#//X}", "/#", "", "/X"],
    ["echo ${v/%/X}", "/%", "", "X"],
    ["echo ${v/%//X}", "/%", "", "/X"],
  ] as const) {
    const operation = getOperation(getPart(source), "Replace");
    assert.deepEqual(
      [operation.operator, operation.pattern.text, operation.replacement.text],
      [operator, pattern, replacement],
    );
  }
});

test("slash patterns retain nested syntax in their replacement", () => {
  const source = 'echo "${v////$(printf X)}"';
  const ast = parse(source);
  assert.equal(ast.errors, undefined);
  const operation = getOperation(getQuotedParam(nodeOfType(getCmd(ast).suffix[0], "Word")), "Replace");
  assert.deepEqual([operation.pattern.text, operation.pattern.pos, operation.pattern.end], ["/", 11, 12]);
  assert.deepEqual(
    [operation.replacement.text, operation.replacement.pos, operation.replacement.end],
    ["$(printf X)", 13, 24],
  );
  const part = operation.replacement.parts?.[0];
  assert.equal(part?.type, "CommandExpansion");
  if (part?.type !== "CommandExpansion" || !part.script) assert.fail();
  assert.equal(getCmd(part.script).name?.text, "printf");
  const serialized = JSON.parse(JSON.stringify(ast));
  const restored = serialized.commands[0].command.suffix[0].parts[0].parts[0].operation;
  assert.equal(restored.pattern.text, "/");
  assert.equal(restored.replacement.parts[0].script.commands[0].command.name.text, "printf");
});

test("${var/#pat/rep} replace prefix", () => {
  const p = getPart("echo ${paths/#/-i }");
  assert.equal(p.parameter, "paths");
  assert.equal(p.operation?.operator, "/#");
  assert.equal(getOperation(p, "Replace")!.pattern.text, "");
  assert.equal(getOperation(p, "Replace")!.replacement.text, "-i ");
});

test("${var/%pat/rep} replace suffix", () => {
  const p = getPart("echo ${paths/%/-end}");
  assert.equal(p.parameter, "paths");
  assert.equal(p.operation?.operator, "/%");
  assert.equal(getOperation(p, "Replace")!.pattern.text, "");
  assert.equal(getOperation(p, "Replace")!.replacement.text, "-end");
});

test("${var/pat} replace with empty", () => {
  const p = getPart("echo ${pv/\\.}");
  assert.equal(p.parameter, "pv");
  assert.equal(p.operation?.operator, "/");
  assert.equal(getOperation(p, "Replace")!.pattern.text, "\\."); // raw source span
  assert.equal(getOperation(p, "Replace")!.replacement.text, "");
});

test("a terminal ampersand remains in a quoted replacement (#279)", () => {
  const source = "echo \"${LIST[@]/*/'prefix'&}\"";
  const ast = parse(source);
  const word = getCmd(ast).suffix[0];
  const part = getQuotedParam(nodeOfType(word, "Word"));

  assert.equal(ast.errors, undefined);
  assert.deepEqual(
    [ast.commands.length, nodeOfType(word, "Assignment", "Word").text, word.pos, word.end],
    [1, "\"${LIST[@]/*/'prefix'&}\"", 5, 29],
  );
  assert.deepEqual(
    [
      part.parameter,
      part.index?.text,
      part.operation?.operator,
      getOperation(part, "Replace")?.pattern.text,
      getOperation(part, "Replace")?.pattern.pos,
      getOperation(part, "Replace")?.pattern.end,
    ],
    ["LIST", "@", "/", "*", 16, 17],
  );
  assert.deepEqual(
    [
      getOperation(part, "Replace")?.replacement.text,
      getOperation(part, "Replace")?.replacement.pos,
      getOperation(part, "Replace")?.replacement.end,
    ],
    ["'prefix'&", 18, 27],
  );
  assert.deepEqual(getOperation(part, "Replace")?.replacement.parts, [
    { type: "SingleQuoted", pos: 18, end: 26, value: "prefix", text: "'prefix'" },
    { type: "Literal", pos: 26, end: 27, value: "&", text: "&" },
  ]);
});

// --- Substring/slice ---

test("${var:0:5} substring", () => {
  const p = getPart("echo ${var:0:5}");
  assert.equal(p.parameter, "var");
  assert.equal(getOperation(p, "Slice")!.offset.text, "0");
  assert.equal(getOperation(p, "Slice")!.length!.text, "5");
});

test("${var:6} substring offset only", () => {
  const p = getPart("echo ${var:6}");
  assert.equal(p.parameter, "var");
  assert.equal(getOperation(p, "Slice")!.offset.text, "6");
  assert.equal(getOperation(p, "Slice")!.length, undefined);
});

test("${var:1:4} substring", () => {
  const p = getPart("echo ${path:1:4}");
  assert.equal(p.parameter, "path");
  assert.equal(getOperation(p, "Slice")!.offset.text, "1");
  assert.equal(getOperation(p, "Slice")!.length!.text, "4");
});

test("${PN::-1} empty offset, negative length", () => {
  const p = getPart("echo ${PN::-1}");
  assert.equal(p.parameter, "PN");
  assert.equal(getOperation(p, "Slice")!.offset.text, "");
  assert.equal(getOperation(p, "Slice")!.length!.text, "-1");
});

test("${parameter: -1} space before negative offset", () => {
  const p = getPart("echo ${parameter: -1}");
  assert.equal(p.parameter, "parameter");
  assert.equal(getOperation(p, "Slice")!.offset.text, " -1");
});

test("${parameter:(-1)} parens for negative offset", () => {
  const p = getPart("echo ${parameter:(-1)}");
  assert.equal(p.parameter, "parameter");
  assert.equal(getOperation(p, "Slice")!.offset.text, "(-1)");
});

for (const [label, source, expectedOffset, expectedLength] of [
  [
    "A",
    "address=${address: ${#address} < 8 ? 0 : -8} # Limit to 32-bit",
    [" ${#address} < 8 ? 0 : -8", 18, 43],
    undefined,
  ],
  ["B", "echo ${FOO: 0 : 1 ? 2 : 3}", [" 0 ", 11, 14], [" 1 ? 2 : 3", 15, 25]],
  ["C", "echo ${FOO: 1 ? 2 : 3 : 4}", [" 1 ? 2 : 3 ", 11, 22], [" 4", 23, 25]],
  ["D", "echo ${FOO: 1 ? 2 ? 3 : 4 : 5 : 2}", [" 1 ? 2 ? 3 : 4 : 5 ", 11, 30], [" 2", 31, 33]],
  ["E", "echo ${FOO:$(f a?b):2}", ["$(f a?b)", 11, 19], ["2", 20, 21]],
  ["F", "echo ${FOO:`f a?b`:2}", ["`f a?b`", 11, 18], ["2", 19, 20]],
  ["G", "echo ${FOO:(1?2:3):2}", ["(1?2:3)", 11, 18], ["2", 19, 20]],
  [
    "H",
    "echo ${FOO:$(case x in x) : a?b;; esac; printf 1):2}",
    ["$(case x in x) : a?b;; esac; printf 1)", 11, 49],
    ["2", 50, 51],
  ],
  ["I", 'echo ${FOO:"$(f "a?b")":2}', ['"$(f "a?b")"', 11, 23], ["2", 24, 25]],
  ["J", 'echo ${FOO:"${x:-"a?b"}":2}', ['"${x:-"a?b"}"', 11, 24], ["2", 25, 26]],
] as const) {
  test(`ternary expression in slice ${label} (#317)`, () => {
    const ast = parse(source);
    assert.equal(ast.errors, undefined);
    const word = nodeOfType(label === "A" ? getAssignment(ast).value : getCmd(ast).suffix[0], "Word");
    const slice = getOperation(getParam(word), "Slice")!;
    assert.deepEqual([slice.offset.text, slice.offset.pos, slice.offset.end], expectedOffset);
    assert.deepEqual(slice.length && [slice.length.text, slice.length.pos, slice.length.end], expectedLength);
  });
}

// --- Case modification ---

test("${var^} capitalize first", () => {
  const p = getPart("echo ${var^}");
  assert.equal(p.parameter, "var");
  assert.equal(p.operation?.operator, "^");
});

test("${var^^} capitalize all", () => {
  const p = getPart("echo ${var^^}");
  assert.equal(p.parameter, "var");
  assert.equal(p.operation?.operator, "^^");
});

test("${var,} lowercase first", () => {
  const p = getPart("echo ${var,}");
  assert.equal(p.parameter, "var");
  assert.equal(p.operation?.operator, ",");
});

test("${var,,} lowercase all", () => {
  const p = getPart("echo ${var,,}");
  assert.equal(p.parameter, "var");
  assert.equal(p.operation?.operator, ",,");
});

test("${var,,[pattern]} case with pattern", () => {
  const p = getPart("echo ${H,,[I]}");
  assert.equal(p.parameter, "H");
  assert.equal(p.operation?.operator, ",,");
  assert.equal(getOperand(p)!.text, "[I]");
});

test("${var^^[pattern]} case with pattern", () => {
  const p = getPart("echo ${K^^[L]}");
  assert.equal(p.parameter, "K");
  assert.equal(p.operation?.operator, "^^");
  assert.equal(getOperand(p)!.text, "[L]");
});

// --- Transform ---

test("${var@Q} transform", () => {
  const p = getPart("echo ${var@Q}");
  assert.equal(p.parameter, "var");
  assert.equal(p.operation?.operator, "@");
  assert.equal(getOperand(p)!.text, "Q");
});

test("${var@E} transform", () => {
  const p = getPart("echo ${var@E}");
  assert.equal(p.parameter, "var");
  assert.equal(p.operation?.operator, "@");
  assert.equal(getOperand(p)!.text, "E");
});

test("${var@A} transform", () => {
  const p = getPart("echo ${var@A}");
  assert.equal(p.parameter, "var");
  assert.equal(p.operation?.operator, "@");
  assert.equal(getOperand(p)!.text, "A");
});

// --- Array ---

test("${arr[@]} array all", () => {
  const p = getPart("echo ${arr[@]}");
  assert.equal(p.parameter, "arr");
  assert.equal(p.index?.text, "@");
  assert.equal(p.operation?.operator, undefined);
});

test("${arr[*]} array all joined", () => {
  const p = getPart("echo ${arr[*]}");
  assert.equal(p.parameter, "arr");
  assert.equal(p.index?.text, "*");
});

test("${arr[0]} array index", () => {
  const p = getPart("echo ${arr[0]}");
  assert.equal(p.parameter, "arr");
  assert.equal(p.index?.text, "0");
});

test("${arr[index]} keeps command substitutions in the index structured", () => {
  const p = getPart("echo ${arr[1+$(danger)]}");
  assert.equal(p.index?.text, "1+$(danger)");
  const expansion = p.index?.parts?.find((part) => part.type === "CommandExpansion");
  assert.equal(expansion?.type, "CommandExpansion");
  if (expansion?.type !== "CommandExpansion") return;
  const command = expansion.script?.commands[0].command;
  assert.equal(command?.type, "Command");
  if (command?.type === "Command") assert.equal(command.name?.value, "danger");
});

test("${arr[index]} keeps nested parameter expansions inside the index", () => {
  const p = getPart("echo ${arr[${x:-]}+$(danger)]}");
  assert.equal(p.index?.text, "${x:-]}+$(danger)");
  assert.deepEqual(
    p.index?.parts?.map((part) => part.type),
    ["ParameterExpansion", "Literal", "CommandExpansion"],
  );
  const expansion = p.index?.parts?.find((part) => part.type === "CommandExpansion");
  assert.equal(expansion?.type, "CommandExpansion");
  if (expansion?.type !== "CommandExpansion") return;
  const command = expansion.script?.commands[0].command;
  assert.equal(command?.type, "Command");
  if (command?.type === "Command") assert.equal(command.name?.value, "danger");
});

test("${#arr[index]} keeps quoted closing brackets inside substitutions", () => {
  const p = getPart('echo ${#arr[$(printf "]")]}');
  assert.equal(p.index?.text, '$(printf "]")');
  const expansion = p.index?.parts?.find((part) => part.type === "CommandExpansion");
  assert.equal(expansion?.type, "CommandExpansion");
  if (expansion?.type !== "CommandExpansion") return;
  const command = expansion.script?.commands[0].command;
  assert.equal(command?.type, "Command");
  if (command?.type === "Command") assert.equal(command.name?.value, "printf");
});

test("${map[name]} assoc array", () => {
  const p = getPart("echo ${map[name]}");
  assert.equal(p.parameter, "map");
  assert.equal(p.index?.text, "name");
});

test("${arr[@]:2:3} array slice", () => {
  const p = getPart("echo ${arr[@]:2:3}");
  assert.equal(p.parameter, "arr");
  assert.equal(p.index?.text, "@");
  assert.equal(getOperation(p, "Slice")!.offset.text, "2");
  assert.equal(getOperation(p, "Slice")!.length!.text, "3");
});

test("${arr[@]^^} array case mod", () => {
  const p = getPart("echo ${arr[@]^^}");
  assert.equal(p.parameter, "arr");
  assert.equal(p.index?.text, "@");
  assert.equal(p.operation?.operator, "^^");
});

test("${arr[@]/a/A} array replace", () => {
  const p = getPart("echo ${arr[@]/a/A}");
  assert.equal(p.parameter, "arr");
  assert.equal(p.index?.text, "@");
  assert.equal(p.operation?.operator, "/");
  assert.equal(getOperation(p, "Replace")!.pattern.text, "a");
  assert.equal(getOperation(p, "Replace")!.replacement.text, "A");
});

test("${arr[@]%o*} array strip", () => {
  const p = getPart("echo ${arr[@]%o*}");
  assert.equal(p.parameter, "arr");
  assert.equal(p.index?.text, "@");
  assert.equal(p.operation?.operator, "%");
  assert.equal(getOperand(p)!.text, "o*");
});

// --- Indirect ---

test("${!var} indirect", () => {
  const p = getPart("echo ${!var}");
  assert.equal(p.parameter, "var");
  assert.equal(p.prefix, "!");
});

test("${!prefix*} indirect prefix matching", () => {
  const p = getPart("echo ${!BASH*}");
  assert.equal(p.parameter, "BASH");
  assert.equal(p.prefix, "!");
});

test("${!arr[@]} array keys", () => {
  const p = getPart("echo ${!map[@]}");
  assert.equal(p.parameter, "map");
  assert.equal(p.index?.text, "@");
  assert.equal(p.prefix, "!");
});

test("${!#} indirect last positional", () => {
  const p = getPart("echo ${!#}");
  assert.equal(p.parameter, "#");
  assert.equal(p.prefix, "!");
});

// --- Edge cases ---

test("${#} is special var, not length", () => {
  const p = getPart("echo ${#}");
  assert.equal(p.parameter, "#");
  assert.equal(p.prefix, undefined);
});

test("${##} is the length of # (Bash 5.3.20)", () => {
  const p = getPart("echo ${##}");
  assert.equal(p.parameter, "#");
  assert.equal(p.prefix, "#");
  assert.equal(p.operation, undefined);
});

test("${##pattern} is # with ## strip", () => {
  // ${##/} = param '#', op '#', operand '/'
  const p = getPart("echo ${##/}");
  assert.equal(p.parameter, "#");
  assert.equal(p.operation?.operator, "#");
  assert.equal(getOperand(p)!.text, "/");
});

test("${abc:- } default with space", () => {
  const p = getPart("echo ${abc:- }");
  assert.equal(p.parameter, "abc");
  assert.equal(p.operation?.operator, ":-");
  assert.equal(getOperand(p)!.text, " ");
});

test("${B[0]# } strip space from array element", () => {
  const p = getPart("echo ${B[0]# }");
  assert.equal(p.parameter, "B");
  assert.equal(p.index?.text, "0");
  assert.equal(p.operation?.operator, "#");
  assert.equal(getOperand(p)!.text, " ");
});

test("${p_key#*=} strip up to equals", () => {
  const p = getPart("echo ${p_key#*=}");
  assert.equal(p.parameter, "p_key");
  assert.equal(p.operation?.operator, "#");
  assert.equal(getOperand(p)!.text, "*=");
});

test("text field always preserved", () => {
  const p = getPart("echo ${var:-default}");
  assert.equal(p.text, "${var:-default}");
});

test("nested expansion in operand", () => {
  const p = getPart("echo ${A:-$B/c}");
  assert.equal(p.parameter, "A");
  assert.equal(p.operation?.operator, ":-");
  assert.equal(getOperand(p)!.text, "$B/c");
});

test("replace with quoted pattern", () => {
  const p = getPart("echo ${f%'-roff2html'*}");
  assert.equal(p.parameter, "f");
  assert.equal(p.operation?.operator, "%");
  assert.equal(getOperand(p)!.text, "'-roff2html'*"); // raw source span
  assert.equal(getOperand(p)!.value, "-roff2html*"); // interpreted (quotes resolved)
  assert.equal(getOperand(p)!.parts![0].type, "SingleQuoted");
});

test("${comp[@]:start:end*2-start} complex slice", () => {
  const p = getPart("echo ${comp[@]:start:end*2-start}");
  assert.equal(p.parameter, "comp");
  assert.equal(p.index?.text, "@");
  assert.equal(getOperation(p, "Slice")!.offset.text, "start");
  assert.equal(getOperation(p, "Slice")!.length!.text, "end*2-start");
});

test("${2+ ${2}} positional with alternate", () => {
  const p = getPart("echo ${2+ ${2}}");
  assert.equal(p.parameter, "2");
  assert.equal(p.operation?.operator, "+");
  assert.equal(getOperand(p)!.text, " ${2}");
});

// --- Structured operand tests ---

test("nested param expansion in operand", () => {
  const p = getPart("echo ${var:-${other:-fallback}}");
  assert.equal(getOperand(p)!.text, "${other:-fallback}");
  assert.equal(getOperand(p)!.parts![0].type, "ParameterExpansion");
  const inner = getOperand(p)!.parts![0] as ParameterExpansionPart;
  assert.equal(inner.parameter, "other");
  assert.equal(inner.operation?.operator, ":-");
  assert.equal(getOperand(inner)!.text, "fallback");
});

test("double-quoted operand with expansion", () => {
  const p = getPart('echo ${var:-"default $value"}');
  assert.equal(getOperand(p)!.parts![0].type, "DoubleQuoted");
  const dq = getOperand(p)!.parts![0] as import("../src/types.ts").DoubleQuotedPart;
  assert.equal(dq.parts[0].type, "Literal");
  assert.equal(dq.parts[1].type, "SimpleExpansion");
});

test("command substitution in operand", () => {
  const p = getPart("echo ${var:-$(whoami)}");
  assert.equal(getOperand(p)!.parts![0].type, "CommandExpansion");
  assert.ok((getOperand(p)!.parts![0] as import("../src/types.ts").CommandExpansionPart).script);
});

test("simple expansion in operand", () => {
  const p = getPart("echo ${var:-$HOME/bin}");
  assert.equal(getOperand(p)!.text, "$HOME/bin");
  assert.equal(getOperand(p)!.parts![0].type, "SimpleExpansion");
  assert.equal(getOperand(p)!.parts![1].type, "Literal");
});

test("expansion in replace pattern", () => {
  const p = getPart("echo ${var//$pat/rep}");
  assert.equal(getOperation(p, "Replace")!.pattern.parts![0].type, "SimpleExpansion");
  assert.equal(getOperation(p, "Replace")!.replacement.text, "rep");
});

test("expansion in replace replacement", () => {
  const p = getPart("echo ${var//old/$new}");
  assert.equal(getOperation(p, "Replace")!.pattern.text, "old");
  assert.equal(getOperation(p, "Replace")!.replacement.parts![0].type, "SimpleExpansion");
});

test("expansion in slice length", () => {
  const p = getPart("echo ${var:0:${#var}}");
  assert.equal(getOperation(p, "Slice")!.offset.text, "0");
  assert.equal(getOperation(p, "Slice")!.length!.parts![0].type, "ParameterExpansion");
  const inner = getOperation(p, "Slice")!.length!.parts![0] as ParameterExpansionPart;
  assert.equal(inner.parameter, "var");
  assert.equal(inner.prefix, "#");
});

test("empty operand is Word with empty text", () => {
  const p = getPart("echo ${var:-}");
  assert.equal(getOperand(p)!.text, "");
  assert.equal(getOperand(p)!.parts, undefined);
});

test("plain operand has no parts", () => {
  const p = getPart("echo ${var:-default}");
  assert.equal(getOperand(p)!.text, "default");
  assert.equal(getOperand(p)!.parts, undefined);
});

test("deeply nested param expansion", () => {
  const p = getPart("echo ${a:-${b:-${c}}}");
  const b = getOperand(p)!.parts![0] as ParameterExpansionPart;
  assert.equal(b.parameter, "b");
  const c = getOperand(b)!.parts![0] as ParameterExpansionPart;
  assert.equal(c.parameter, "c");
});

// --- Bulk expansion tests ---

test("parameter expansions parse without errors", () => {
  const scripts = [
    "echo ${var1#*#}",
    "echo ${!abc}",
    "echo ${abc:-def}",
    "echo ${abc:+ghi}",
    "echo ${abc,?}",
    "echo ${abc^^b}",
    "echo ${abc@U}",
    'F="${G%% *}"',
    "A=${B//:;;/$'\\n'}",
    'echo "${kw}? ( ${cond:+${cond}? (} ${baseuri}-${ver} ${cond:+) })"',
    'echo "${IMAGE,,}"',
  ];
  for (const script of scripts) {
    const ast = parse(script);
    assert.ok(ast.commands.length > 0, `Failed: ${script}`);
  }
});

// --- Array operations ---

test("array element access", () => {
  const ast = parse("echo ${a[@]}");
  const c = ast.commands[0].command as import("../src/types.ts").Command;
  assert.equal(c.name?.text, "echo");
});

test("array length", () => {
  const ast = parse("echo ${#b[@]}");
  const c = ast.commands[0].command as import("../src/types.ts").Command;
  assert.equal(c.name?.text, "echo");
});

test("$$ consumes its own second dollar, so a following brace is literal", () => {
  // `${$${}` closes at the first `}` in bash: $$ is the PID and the `{` is ordinary text.
  for (const source of ["${$${}", "${$${x}", "echo ${a[$${]}"]) assert.equal(parse(source).errors, undefined, source);
  // A third `$` does open a nested expansion, so that one still needs its own `}`.
  assert.ok(parse("${x:-$$${}").errors);
});

test("a parameter expansion scans over nested command substitutions", () => {
  // A `}` inside `$( )` or backticks belongs to that body, so it must not close the
  // expansion: bash reads `${x:-$(<})}` as a read-file substitution named `}`.
  for (const [source, text] of [
    ["echo ${x:-$(<})}", "${x:-$(<})}"],
    ["echo ${foo:-$({ ls /bin/ls; })}", "${foo:-$({ ls /bin/ls; })}"],
    ["echo ${x:-$(echo })}", "${x:-$(echo })}"],
    ["echo ${x:-`echo }`}", "${x:-`echo }`}"],
    ["echo ${x#$({ a; })}", "${x#$({ a; })}"],
    ["echo ${x:-$((1+2))}", "${x:-$((1+2))}"],
  ] as const) {
    const command = parse(source).commands[0].command as Command;
    assert.equal(nodeOfType(command.suffix[0], "Assignment", "Word").text, text, source);
    assert.equal(computeWordParts(source, command.suffix[0])?.[0].type, "ParameterExpansion", source);
    assert.equal(parse(source).errors, undefined, source);
  }
});

test("an unterminated substitution inside an expansion is still reported", () => {
  assert.ok(parse("echo ${x:-$(a}").errors);
});
