import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "../src/parser.ts";
import type { Assignment, Command, ParameterExpansionPart, Word } from "../src/types.ts";
import { computeWordParts } from "../src/parts.ts";

const getCmd = (ast: ReturnType<typeof parse>, i = 0) => ast.commands[i].command as Command;
const getPart = (input: string): ParameterExpansionPart => {
  const c = getCmd(parse(input));
  const parts = computeWordParts(input, c.suffix[0])!;
  return parts[0] as ParameterExpansionPart;
};
const getAssignment = (ast: ReturnType<typeof parse>, i = 0): Assignment => {
  const assignment = getCmd(ast, i).prefix[0];
  assert.equal(assignment?.type, "Assignment");
  return assignment as Assignment;
};
const getParam = (word: Word): ParameterExpansionPart => {
  const part = word.parts?.[0];
  assert.equal(part?.type, "ParameterExpansion");
  return part as ParameterExpansionPart;
};
const getQuotedParam = (word: Word): ParameterExpansionPart => {
  const quoted = word.parts?.[0];
  assert.equal(quoted?.type, "DoubleQuoted");
  const part = quoted?.type === "DoubleQuoted" ? quoted.parts[0] : undefined;
  assert.equal(part?.type, "ParameterExpansion");
  return part as ParameterExpansionPart;
};

// --- Simple expansions ---

test("simple ${var}", () => {
  const p = getPart("echo ${var}");
  assert.equal(p.type, "ParameterExpansion");
  assert.equal(p.parameter, "var");
  assert.equal(p.text, "${var}");
  assert.equal(p.operator, undefined);
  assert.equal(p.indirect, undefined);
  assert.equal(p.length, undefined);
});

test("${#} special variable", () => {
  const p = getPart("echo ${#}");
  assert.equal(p.parameter, "#");
  assert.equal(p.length, undefined);
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
  assert.equal(p.operator, ":-");
  assert.equal(p.operand!.text, "default");
});

test("ANSI-C \\c operand ends where the skip and decode paths agree", () => {
  const src = "echo ${u:-$'\\c'} x";
  const c = getCmd(parse(src));
  const p = computeWordParts(src, c.suffix[0])![0] as ParameterExpansionPart;
  assert.equal(p.text, "${u:-$'\\c'}");
  assert.equal(p.operand!.text, "$'\\c'");
  assert.deepEqual(p.operand!.parts, [{ type: "AnsiCQuoted", text: "$'\\c'", value: "\\c" }]);
  assert.equal(c.suffix[1].value, "x");

  const pairSrc = "echo ${u:-$'\\c\\\\'} y";
  const c2 = getCmd(parse(pairSrc));
  const p2 = computeWordParts(pairSrc, c2.suffix[0])![0] as ParameterExpansionPart;
  assert.equal(p2.text, "${u:-$'\\c\\\\'}");
  assert.deepEqual(p2.operand!.parts, [{ type: "AnsiCQuoted", text: "$'\\c\\\\'", value: "\x1c" }]);
  assert.equal(c2.suffix[1].value, "y");

  const escapedQuoteSrc = "echo ${u:-$'\\c\\''} z";
  const c3 = getCmd(parse(escapedQuoteSrc));
  const p3 = computeWordParts(escapedQuoteSrc, c3.suffix[0])![0] as ParameterExpansionPart;
  assert.equal(p3.text, "${u:-$'\\c\\''}");
  assert.deepEqual(p3.operand!.parts, [{ type: "AnsiCQuoted", text: "$'\\c\\''", value: "\x1c'" }]);
  assert.equal(c3.suffix[1].value, "z");
});

test("${var:=assigned}", () => {
  const p = getPart("echo ${var:=assigned}");
  assert.equal(p.parameter, "var");
  assert.equal(p.operator, ":=");
  assert.equal(p.operand!.text, "assigned");
});

test("${var:+alternate}", () => {
  const p = getPart("echo ${var:+alternate}");
  assert.equal(p.parameter, "var");
  assert.equal(p.operator, ":+");
  assert.equal(p.operand!.text, "alternate");
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
    assert.equal(part.operator, ":+", source);
    assert.deepEqual(
      [part.operand?.pos, part.operand?.end, part.operand?.text],
      [5, operandEnd, `$a${literal}`],
      source,
    );
    assert.deepEqual(
      part.operand?.parts,
      [
        { type: "SimpleExpansion", text: "$a" },
        { type: "Literal", value: literal, text: literal },
      ],
      source,
    );
  }
});

test("${var:?error msg}", () => {
  const p = getPart("echo ${var:?error msg}");
  assert.equal(p.parameter, "var");
  assert.equal(p.operator, ":?");
  assert.equal(p.operand!.text, "error msg");
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
  const words = ast.commands.map((_, i) => (i === 2 ? getAssignment(ast, i).value! : getCmd(ast, i).suffix[0]));

  assert.equal(ast.errors, undefined);
  assert.deepEqual(
    words.map((word) => {
      const part = getParam(word);
      return [part.operator, part.operand?.text, part.operand?.pos, part.operand?.end, part.operand?.parts];
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
  assert.equal(p.operator, "-");
  assert.equal(p.operand!.text, "default");
});

test("${var=default}", () => {
  const p = getPart("echo ${var=default}");
  assert.equal(p.parameter, "var");
  assert.equal(p.operator, "=");
  assert.equal(p.operand!.text, "default");
});

test("${var+alt}", () => {
  const p = getPart("echo ${var+alt}");
  assert.equal(p.parameter, "var");
  assert.equal(p.operator, "+");
  assert.equal(p.operand!.text, "alt");
});

test("${var?err}", () => {
  const p = getPart("echo ${var?err}");
  assert.equal(p.parameter, "var");
  assert.equal(p.operator, "?");
  assert.equal(p.operand!.text, "err");
});

// --- Length ---

test("${#var} length", () => {
  const p = getPart("echo ${#var}");
  assert.equal(p.parameter, "var");
  assert.equal(p.length, true);
  assert.equal(p.operator, undefined);
});

test("${#arr[@]} array length", () => {
  const p = getPart("echo ${#arr[@]}");
  assert.equal(p.parameter, "arr");
  assert.equal(p.index, "@");
  assert.equal(p.length, true);
});

test("${#path} length of path var", () => {
  const p = getPart("echo ${#path}");
  assert.equal(p.parameter, "path");
  assert.equal(p.length, true);
});

// --- Prefix strip ---

test("${path#*/} shortest prefix strip", () => {
  const p = getPart("echo ${path#*/}");
  assert.equal(p.parameter, "path");
  assert.equal(p.operator, "#");
  assert.equal(p.operand!.text, "*/");
});

test("${path##*/} longest prefix strip", () => {
  const p = getPart("echo ${path##*/}");
  assert.equal(p.parameter, "path");
  assert.equal(p.operator, "##");
  assert.equal(p.operand!.text, "*/");
});

// --- Suffix strip ---

test("${path%/*} shortest suffix strip", () => {
  const p = getPart("echo ${path%/*}");
  assert.equal(p.parameter, "path");
  assert.equal(p.operator, "%");
  assert.equal(p.operand!.text, "/*");
});

test("${path%%/*} longest suffix strip", () => {
  const p = getPart("echo ${path%%/*}");
  assert.equal(p.parameter, "path");
  assert.equal(p.operator, "%%");
  assert.equal(p.operand!.text, "/*");
});

test("escaped braces remain complete strip operands (#259)", () => {
  const source = 'name="${value#\\{sd.cicd.}"\necho "${name%\\}}"';
  const ast = parse(source);
  const operands = [getQuotedParam(getAssignment(ast).value!), getQuotedParam(getCmd(ast, 1).suffix[0])];

  assert.equal(ast.errors, undefined);
  assert.deepEqual(
    operands.map((part) => [
      part.operator,
      part.operand?.text,
      part.operand?.value,
      part.operand?.pos,
      part.operand?.end,
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
  const word = getCmd(ast).suffix[0];
  const part = getQuotedParam(word);

  assert.equal(ast.errors, undefined);
  assert.deepEqual(
    [part.parameter, part.operator, part.operand?.text, part.operand?.value, part.operand?.pos, part.operand?.end],
    ["1", "%", '"$2"*', "$2*", 10, 15],
  );
  assert.deepEqual(part.operand?.parts, [
    {
      type: "DoubleQuoted",
      text: '"$2"',
      parts: [{ type: "SimpleExpansion", text: "$2" }],
    },
    { type: "Literal", value: "*", text: "*" },
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
    const part = getQuotedParam(assigned.value!);

    assert.equal(ast.errors, undefined, source);
    assert.deepEqual(
      ast.commands.map(({ command }) => [command.type, command.pos, command.end]),
      roots,
      source,
    );
    assert.deepEqual([assigned.name, assigned.pos, assigned.end], assignment, source);
    assert.deepEqual([part.operand?.text, part.operand?.pos, part.operand?.end], operand, source);
  }
});

// --- Replacement ---

test("${var/pat/rep} replace first", () => {
  const p = getPart("echo ${version/beta/rc}");
  assert.equal(p.parameter, "version");
  assert.equal(p.operator, "/");
  assert.equal(p.replace!.pattern.text, "beta");
  assert.equal(p.replace!.replacement.text, "rc");
});

test("${var//pat/rep} replace all", () => {
  const p = getPart("echo ${version//./,}");
  assert.equal(p.parameter, "version");
  assert.equal(p.operator, "//");
  assert.equal(p.replace!.pattern.text, ".");
  assert.equal(p.replace!.replacement.text, ",");
});

test("${var/#pat/rep} replace prefix", () => {
  const p = getPart("echo ${paths/#/-i }");
  assert.equal(p.parameter, "paths");
  assert.equal(p.operator, "/#");
  assert.equal(p.replace!.pattern.text, "");
  assert.equal(p.replace!.replacement.text, "-i ");
});

test("${var/%pat/rep} replace suffix", () => {
  const p = getPart("echo ${paths/%/-end}");
  assert.equal(p.parameter, "paths");
  assert.equal(p.operator, "/%");
  assert.equal(p.replace!.pattern.text, "");
  assert.equal(p.replace!.replacement.text, "-end");
});

test("${var/pat} replace with empty", () => {
  const p = getPart("echo ${pv/\\.}");
  assert.equal(p.parameter, "pv");
  assert.equal(p.operator, "/");
  assert.equal(p.replace!.pattern.text, "\\."); // raw source span
  assert.equal(p.replace!.replacement.text, "");
});

test("a terminal ampersand remains in a quoted replacement (#279)", () => {
  const source = "echo \"${LIST[@]/*/'prefix'&}\"";
  const ast = parse(source);
  const word = getCmd(ast).suffix[0];
  const part = getQuotedParam(word);

  assert.equal(ast.errors, undefined);
  assert.deepEqual([ast.commands.length, word.text, word.pos, word.end], [1, "\"${LIST[@]/*/'prefix'&}\"", 5, 29]);
  assert.deepEqual(
    [
      part.parameter,
      part.index,
      part.operator,
      part.replace?.pattern.text,
      part.replace?.pattern.pos,
      part.replace?.pattern.end,
    ],
    ["LIST", "@", "/", "*", 16, 17],
  );
  assert.deepEqual(
    [part.replace?.replacement.text, part.replace?.replacement.pos, part.replace?.replacement.end],
    ["'prefix'&", 18, 27],
  );
  assert.deepEqual(part.replace?.replacement.parts, [
    { type: "SingleQuoted", value: "prefix", text: "'prefix'" },
    { type: "Literal", value: "&", text: "&" },
  ]);
});

// --- Substring/slice ---

test("${var:0:5} substring", () => {
  const p = getPart("echo ${var:0:5}");
  assert.equal(p.parameter, "var");
  assert.equal(p.slice!.offset.text, "0");
  assert.equal(p.slice!.length!.text, "5");
});

test("${var:6} substring offset only", () => {
  const p = getPart("echo ${var:6}");
  assert.equal(p.parameter, "var");
  assert.equal(p.slice!.offset.text, "6");
  assert.equal(p.slice!.length, undefined);
});

test("${var:1:4} substring", () => {
  const p = getPart("echo ${path:1:4}");
  assert.equal(p.parameter, "path");
  assert.equal(p.slice!.offset.text, "1");
  assert.equal(p.slice!.length!.text, "4");
});

test("${PN::-1} empty offset, negative length", () => {
  const p = getPart("echo ${PN::-1}");
  assert.equal(p.parameter, "PN");
  assert.equal(p.slice!.offset.text, "");
  assert.equal(p.slice!.length!.text, "-1");
});

test("${parameter: -1} space before negative offset", () => {
  const p = getPart("echo ${parameter: -1}");
  assert.equal(p.parameter, "parameter");
  assert.equal(p.slice!.offset.text, " -1");
});

test("${parameter:(-1)} parens for negative offset", () => {
  const p = getPart("echo ${parameter:(-1)}");
  assert.equal(p.parameter, "parameter");
  assert.equal(p.slice!.offset.text, "(-1)");
});

// --- Case modification ---

test("${var^} capitalize first", () => {
  const p = getPart("echo ${var^}");
  assert.equal(p.parameter, "var");
  assert.equal(p.operator, "^");
});

test("${var^^} capitalize all", () => {
  const p = getPart("echo ${var^^}");
  assert.equal(p.parameter, "var");
  assert.equal(p.operator, "^^");
});

test("${var,} lowercase first", () => {
  const p = getPart("echo ${var,}");
  assert.equal(p.parameter, "var");
  assert.equal(p.operator, ",");
});

test("${var,,} lowercase all", () => {
  const p = getPart("echo ${var,,}");
  assert.equal(p.parameter, "var");
  assert.equal(p.operator, ",,");
});

test("${var,,[pattern]} case with pattern", () => {
  const p = getPart("echo ${H,,[I]}");
  assert.equal(p.parameter, "H");
  assert.equal(p.operator, ",,");
  assert.equal(p.operand!.text, "[I]");
});

test("${var^^[pattern]} case with pattern", () => {
  const p = getPart("echo ${K^^[L]}");
  assert.equal(p.parameter, "K");
  assert.equal(p.operator, "^^");
  assert.equal(p.operand!.text, "[L]");
});

// --- Transform ---

test("${var@Q} transform", () => {
  const p = getPart("echo ${var@Q}");
  assert.equal(p.parameter, "var");
  assert.equal(p.operator, "@");
  assert.equal(p.operand!.text, "Q");
});

test("${var@E} transform", () => {
  const p = getPart("echo ${var@E}");
  assert.equal(p.parameter, "var");
  assert.equal(p.operator, "@");
  assert.equal(p.operand!.text, "E");
});

test("${var@A} transform", () => {
  const p = getPart("echo ${var@A}");
  assert.equal(p.parameter, "var");
  assert.equal(p.operator, "@");
  assert.equal(p.operand!.text, "A");
});

// --- Array ---

test("${arr[@]} array all", () => {
  const p = getPart("echo ${arr[@]}");
  assert.equal(p.parameter, "arr");
  assert.equal(p.index, "@");
  assert.equal(p.operator, undefined);
});

test("${arr[*]} array all joined", () => {
  const p = getPart("echo ${arr[*]}");
  assert.equal(p.parameter, "arr");
  assert.equal(p.index, "*");
});

test("${arr[0]} array index", () => {
  const p = getPart("echo ${arr[0]}");
  assert.equal(p.parameter, "arr");
  assert.equal(p.index, "0");
});

test("${arr[index]} keeps command substitutions in the index structured", () => {
  const p = getPart("echo ${arr[1+$(danger)]}");
  assert.equal(p.index, "1+$(danger)");
  const expansion = p.indexParts?.find((part) => part.type === "CommandExpansion");
  assert.equal(expansion?.type, "CommandExpansion");
  if (expansion?.type !== "CommandExpansion") return;
  const command = expansion.script?.commands[0].command;
  assert.equal(command?.type, "Command");
  if (command?.type === "Command") assert.equal(command.name?.value, "danger");
});

test("${arr[index]} keeps nested parameter expansions inside the index", () => {
  const p = getPart("echo ${arr[${x:-]}+$(danger)]}");
  assert.equal(p.index, "${x:-]}+$(danger)");
  assert.deepEqual(
    p.indexParts?.map((part) => part.type),
    ["ParameterExpansion", "Literal", "CommandExpansion"],
  );
  const expansion = p.indexParts?.find((part) => part.type === "CommandExpansion");
  assert.equal(expansion?.type, "CommandExpansion");
  if (expansion?.type !== "CommandExpansion") return;
  const command = expansion.script?.commands[0].command;
  assert.equal(command?.type, "Command");
  if (command?.type === "Command") assert.equal(command.name?.value, "danger");
});

test("${#arr[index]} keeps quoted closing brackets inside substitutions", () => {
  const p = getPart('echo ${#arr[$(printf "]")]}');
  assert.equal(p.index, '$(printf "]")');
  const expansion = p.indexParts?.find((part) => part.type === "CommandExpansion");
  assert.equal(expansion?.type, "CommandExpansion");
  if (expansion?.type !== "CommandExpansion") return;
  const command = expansion.script?.commands[0].command;
  assert.equal(command?.type, "Command");
  if (command?.type === "Command") assert.equal(command.name?.value, "printf");
});

test("${map[name]} assoc array", () => {
  const p = getPart("echo ${map[name]}");
  assert.equal(p.parameter, "map");
  assert.equal(p.index, "name");
});

test("${arr[@]:2:3} array slice", () => {
  const p = getPart("echo ${arr[@]:2:3}");
  assert.equal(p.parameter, "arr");
  assert.equal(p.index, "@");
  assert.equal(p.slice!.offset.text, "2");
  assert.equal(p.slice!.length!.text, "3");
});

test("${arr[@]^^} array case mod", () => {
  const p = getPart("echo ${arr[@]^^}");
  assert.equal(p.parameter, "arr");
  assert.equal(p.index, "@");
  assert.equal(p.operator, "^^");
});

test("${arr[@]/a/A} array replace", () => {
  const p = getPart("echo ${arr[@]/a/A}");
  assert.equal(p.parameter, "arr");
  assert.equal(p.index, "@");
  assert.equal(p.operator, "/");
  assert.equal(p.replace!.pattern.text, "a");
  assert.equal(p.replace!.replacement.text, "A");
});

test("${arr[@]%o*} array strip", () => {
  const p = getPart("echo ${arr[@]%o*}");
  assert.equal(p.parameter, "arr");
  assert.equal(p.index, "@");
  assert.equal(p.operator, "%");
  assert.equal(p.operand!.text, "o*");
});

// --- Indirect ---

test("${!var} indirect", () => {
  const p = getPart("echo ${!var}");
  assert.equal(p.parameter, "var");
  assert.equal(p.indirect, true);
});

test("${!prefix*} indirect prefix matching", () => {
  const p = getPart("echo ${!BASH*}");
  assert.equal(p.parameter, "BASH");
  assert.equal(p.indirect, true);
});

test("${!arr[@]} array keys", () => {
  const p = getPart("echo ${!map[@]}");
  assert.equal(p.parameter, "map");
  assert.equal(p.index, "@");
  assert.equal(p.indirect, true);
});

test("${!#} indirect last positional", () => {
  const p = getPart("echo ${!#}");
  assert.equal(p.parameter, "#");
  assert.equal(p.indirect, true);
});

// --- Edge cases ---

test("${#} is special var, not length", () => {
  const p = getPart("echo ${#}");
  assert.equal(p.parameter, "#");
  assert.equal(p.length, undefined);
});

test("${##} is # with # strip", () => {
  const p = getPart("echo ${##}");
  assert.equal(p.parameter, "#");
  assert.equal(p.operator, "#");
  assert.equal(p.operand!.text, "");
});

test("${##pattern} is # with ## strip", () => {
  // ${##/} = param '#', op '#', operand '/'
  const p = getPart("echo ${##/}");
  assert.equal(p.parameter, "#");
  assert.equal(p.operator, "#");
  assert.equal(p.operand!.text, "/");
});

test("${abc:- } default with space", () => {
  const p = getPart("echo ${abc:- }");
  assert.equal(p.parameter, "abc");
  assert.equal(p.operator, ":-");
  assert.equal(p.operand!.text, " ");
});

test("${B[0]# } strip space from array element", () => {
  const p = getPart("echo ${B[0]# }");
  assert.equal(p.parameter, "B");
  assert.equal(p.index, "0");
  assert.equal(p.operator, "#");
  assert.equal(p.operand!.text, " ");
});

test("${p_key#*=} strip up to equals", () => {
  const p = getPart("echo ${p_key#*=}");
  assert.equal(p.parameter, "p_key");
  assert.equal(p.operator, "#");
  assert.equal(p.operand!.text, "*=");
});

test("text field always preserved", () => {
  const p = getPart("echo ${var:-default}");
  assert.equal(p.text, "${var:-default}");
});

test("nested expansion in operand", () => {
  const p = getPart("echo ${A:-$B/c}");
  assert.equal(p.parameter, "A");
  assert.equal(p.operator, ":-");
  assert.equal(p.operand!.text, "$B/c");
});

test("replace with quoted pattern", () => {
  const p = getPart("echo ${f%'-roff2html'*}");
  assert.equal(p.parameter, "f");
  assert.equal(p.operator, "%");
  assert.equal(p.operand!.text, "'-roff2html'*"); // raw source span
  assert.equal(p.operand!.value, "-roff2html*"); // interpreted (quotes resolved)
  assert.equal(p.operand!.parts![0].type, "SingleQuoted");
});

test("${comp[@]:start:end*2-start} complex slice", () => {
  const p = getPart("echo ${comp[@]:start:end*2-start}");
  assert.equal(p.parameter, "comp");
  assert.equal(p.index, "@");
  assert.equal(p.slice!.offset.text, "start");
  assert.equal(p.slice!.length!.text, "end*2-start");
});

test("${2+ ${2}} positional with alternate", () => {
  const p = getPart("echo ${2+ ${2}}");
  assert.equal(p.parameter, "2");
  assert.equal(p.operator, "+");
  assert.equal(p.operand!.text, " ${2}");
});

// --- Structured operand tests ---

test("nested param expansion in operand", () => {
  const p = getPart("echo ${var:-${other:-fallback}}");
  assert.equal(p.operand!.text, "${other:-fallback}");
  assert.equal(p.operand!.parts![0].type, "ParameterExpansion");
  const inner = p.operand!.parts![0] as ParameterExpansionPart;
  assert.equal(inner.parameter, "other");
  assert.equal(inner.operator, ":-");
  assert.equal(inner.operand!.text, "fallback");
});

test("double-quoted operand with expansion", () => {
  const p = getPart('echo ${var:-"default $value"}');
  assert.equal(p.operand!.parts![0].type, "DoubleQuoted");
  const dq = p.operand!.parts![0] as import("../src/types.ts").DoubleQuotedPart;
  assert.equal(dq.parts[0].type, "Literal");
  assert.equal(dq.parts[1].type, "SimpleExpansion");
});

test("command substitution in operand", () => {
  const p = getPart("echo ${var:-$(whoami)}");
  assert.equal(p.operand!.parts![0].type, "CommandExpansion");
  assert.ok((p.operand!.parts![0] as import("../src/types.ts").CommandExpansionPart).script);
});

test("simple expansion in operand", () => {
  const p = getPart("echo ${var:-$HOME/bin}");
  assert.equal(p.operand!.text, "$HOME/bin");
  assert.equal(p.operand!.parts![0].type, "SimpleExpansion");
  assert.equal(p.operand!.parts![1].type, "Literal");
});

test("expansion in replace pattern", () => {
  const p = getPart("echo ${var//$pat/rep}");
  assert.equal(p.replace!.pattern.parts![0].type, "SimpleExpansion");
  assert.equal(p.replace!.replacement.text, "rep");
});

test("expansion in replace replacement", () => {
  const p = getPart("echo ${var//old/$new}");
  assert.equal(p.replace!.pattern.text, "old");
  assert.equal(p.replace!.replacement.parts![0].type, "SimpleExpansion");
});

test("expansion in slice length", () => {
  const p = getPart("echo ${var:0:${#var}}");
  assert.equal(p.slice!.offset.text, "0");
  assert.equal(p.slice!.length!.parts![0].type, "ParameterExpansion");
  const inner = p.slice!.length!.parts![0] as ParameterExpansionPart;
  assert.equal(inner.parameter, "var");
  assert.equal(inner.length, true);
});

test("empty operand is Word with empty text", () => {
  const p = getPart("echo ${var:-}");
  assert.equal(p.operand!.text, "");
  assert.equal(p.operand!.parts, undefined);
});

test("plain operand has no parts", () => {
  const p = getPart("echo ${var:-default}");
  assert.equal(p.operand!.text, "default");
  assert.equal(p.operand!.parts, undefined);
});

test("deeply nested param expansion", () => {
  const p = getPart("echo ${a:-${b:-${c}}}");
  const b = p.operand!.parts![0] as ParameterExpansionPart;
  assert.equal(b.parameter, "b");
  const c = b.operand!.parts![0] as ParameterExpansionPart;
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
    assert.equal(command.suffix[0].text, text, source);
    assert.equal(computeWordParts(source, command.suffix[0])?.[0].type, "ParameterExpansion", source);
    assert.equal(parse(source).errors, undefined, source);
  }
});

test("an unterminated substitution inside an expansion is still reported", () => {
  assert.ok(parse("echo ${x:-$(a}").errors);
});
