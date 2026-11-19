import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { parse } from "../src/parser.ts";
import { print } from "../src/printer.ts";
import { nodeOfType } from "./ast-helpers.ts";
import { verify } from "./verify.ts";

function characterReads(source: string): number {
  const charCodeAt = String.prototype.charCodeAt;
  let count = 0;
  String.prototype.charCodeAt = function (index: number): number {
    count++;
    return charCodeAt.call(this, index);
  };
  try {
    const ast = parse(source);
    assert.equal(ast.errors, undefined);
    JSON.stringify(ast);
  } finally {
    String.prototype.charCodeAt = charCodeAt;
  }
  return count;
}

test("ANSI-C quotes preserve command and process substitution boundaries (#15)", () => {
  for (const [word, value] of [
    [String.raw`$'\''`, "'"],
    [String.raw`$'\')\''`, "')'"],
    [String.raw`$'\c\''`, "\x1c'"],
    [String.raw`$'\\'`, "\\"],
    [String.raw`$'a'`, "a"],
    [String.raw`$$$'\''`, "$$'"],
  ]) {
    for (const [open, close] of [
      ["$(", ")"],
      ['"$(', ')"'],
      ["<(", ")"],
      [">(", ")"],
    ]) {
      const source = `echo ${open}echo ${word}${close}; X`;
      const ast = parse(source);
      assert.equal(ast.errors, undefined, source);
      assert.equal(ast.commands.length, 2, source);
      assert.equal(nodeOfType(ast.commands[1].command, "Command").name?.text, "X", source);
      const argument = nodeOfType(nodeOfType(ast.commands[0].command, "Command").args[0], "Word");
      const first = argument.parts?.[0];
      const expansion = nodeOfType(
        first?.type === "DoubleQuoted" ? first.parts[0] : first,
        "CommandExpansion",
        "ProcessSubstitution",
      );
      const inner = expansion.script!;
      assert.equal(inner.errors, undefined, source);
      assert.equal(inner.commands.length, 1, source);
      const quoted = nodeOfType(nodeOfType(inner.commands[0].command, "Command").args[0], "Word");
      assert.equal(quoted.text, word, source);
      assert.equal(quoted.value, value, source);
      assert.equal(verify(source, ast), source);
      assert.equal(print(ast), `echo ${open}echo ${word}${close}\nX`);
    }
  }
});

test("literal and consumed dollars do not open ANSI-C quotes in substitutions", () => {
  for (const [word, value] of [
    [String.raw`'\'`, "\\"],
    [String.raw`\$'\'`, "$\\"],
    [String.raw`$$'\'`, "$$\\"],
    [String.raw`$$$$'\'`, "$$$$\\"],
    [String.raw`"$'\'"`, "$'\\'"],
  ]) {
    for (const [open, close] of [
      ["$(", ")"],
      ['"$(', ')"'],
    ]) {
      const source = `echo ${open}echo ${word}${close}; X`;
      const ast = parse(source);
      assert.equal(ast.errors, undefined, source);
      assert.equal(ast.commands.length, 2, source);
      const first = nodeOfType(nodeOfType(ast.commands[0].command, "Command").args[0], "Word").parts?.[0];
      const expansion = nodeOfType(first?.type === "DoubleQuoted" ? first.parts[0] : first, "CommandExpansion");
      assert.equal(expansion.script?.errors, undefined, source);
      const inner = nodeOfType(expansion.script!.commands[0].command, "Command");
      assert.equal(inner.args[0].text, word, source);
      assert.equal(inner.args[0].value, value, source);
      assert.equal(verify(source, ast), source);
      assert.equal(print(ast), `echo ${open}echo ${word}${close}\nX`);
    }
  }
});

test("nested quoted substitutions resume after an ANSI-C quote", () => {
  const source = String.raw`echo "$(echo "$(echo $'\'')")"; X`;
  const ast = parse(source);
  assert.equal(ast.errors, undefined);
  assert.equal(ast.commands.length, 2);
  assert.equal(nodeOfType(ast.commands[1].command, "Command").name?.text, "X");
  let script = ast;
  for (let depth = 0; depth < 2; depth++) {
    const word = nodeOfType(nodeOfType(script.commands[0].command, "Command").args[0], "Word");
    const quoted = nodeOfType(word.parts?.[0], "DoubleQuoted");
    script = nodeOfType(quoted.parts[0], "CommandExpansion").script!;
    assert.equal(script.errors, undefined);
    assert.equal(script.commands.length, 1);
  }
  assert.equal(nodeOfType(script.commands[0].command, "Command").args[0].value, "'");
  assert.equal(verify(source, ast), source);
  assert.equal(print(ast), String.raw`echo "$(echo "$(echo $'\'')")"` + "\nX");
});

test("unfinished ANSI-C quotes inside substitutions retain diagnostics", () => {
  assert.deepEqual(parse("echo $(echo $'abc").errors, [
    { message: "unterminated command substitution", pos: 5 },
    { message: "unterminated ANSI-C quote", pos: 13 },
  ]);
  assert.deepEqual(parse("echo \"$(echo $'abc").errors, [
    { message: "unterminated double quote", pos: 5 },
    { message: "unterminated command substitution", pos: 6 },
    { message: "unterminated ANSI-C quote", pos: 14 },
  ]);
});

test("a comment after a negated subshell does not close the command substitution", () => {
  const source = "echo $(!(echo inside)# )\necho after)";
  const ast = parse(source);
  assert.equal(ast.errors, undefined);
  assert.equal(ast.commands.length, 1);
  const command = nodeOfType(ast.commands[0].command, "Command");
  const word = nodeOfType(command.args[0], "Word");
  const expansion = nodeOfType(word.parts?.[0], "CommandExpansion");
  assert.deepEqual([expansion.pos, expansion.end], [5, 36]);
  const script = expansion.script!;
  assert.equal(script.errors, undefined);
  assert.deepEqual([script.pos, script.end], [7, 35]);
  assert.equal(script.commands.length, 2);
  const negation = nodeOfType(script.commands[0].command, "Pipeline");
  assert.equal(negation.prefixes[0].type, "Negation");
  const subshell = nodeOfType(negation.commands[0], "Subshell");
  assert.equal(nodeOfType(subshell.body.commands[0].command, "Command").name?.text, "echo");
  const after = nodeOfType(script.commands[1].command, "Command");
  assert.deepEqual(
    after.args.map((arg) => arg.text),
    ["after"],
  );
  assert.equal(verify(source, ast), source);
});

test("quoted defaults do not treat escaped or consumed dollars as nested expansions", () => {
  for (const word of ['"${x:-\\${a}"', '"${x:-$${a}"', '"${x:-$$${a}}"', '"${x:-${a}}"']) {
    for (const opener of ["$(", "<("]) {
      const source = `echo ${opener}echo ${word}) tail`;
      const ast = parse(source);
      assert.equal(ast.errors, undefined, source);
      const command = nodeOfType(ast.commands[0].command, "Command");
      const expansion = nodeOfType(
        nodeOfType(command.args[0], "Word").parts?.[0],
        "CommandExpansion",
        "ProcessSubstitution",
      );
      const script = expansion.script!;
      assert.equal(script.errors, undefined, source);
      assert.equal(nodeOfType(script.commands[0].command, "Command").args[0].text, word, source);
      assert.equal(nodeOfType(command.args[1], "Word").text, "tail", source);
      assert.equal(verify(source, ast), source);
    }
  }
});

test("escaped dollars inside quoted substitution text stay literal", () => {
  // Bash 5.3: `\$` in double quotes is a literal dollar, so `\$(` opens nothing there.
  for (const [source, operand] of [
    ['echo ${x:-"\\$(foo"} tail', "$(foo"],
    ['echo ${x:-"${y}\\$(foo"} tail', "${y}$(foo"],
    ['echo ${x:-"$\\$(foo"} tail', "$$(foo"],
  ] as const) {
    const ast = parse(source);
    assert.equal(ast.errors, undefined, source);
    const command = nodeOfType(ast.commands[0].command, "Command");
    const parameter = nodeOfType(nodeOfType(command.args[0], "Word").parts?.[0], "ParameterExpansion");
    assert.equal(parameter.operation?.type, "Default", source);
    if (parameter.operation?.type === "Default") assert.equal(parameter.operation.operand.value, operand, source);
    assert.equal(nodeOfType(command.args[1], "Word").text, "tail", source);
    assert.equal(verify(source, ast), source);
  }
  for (const source of [
    'echo {a,"\\$(b"} tail',
    'echo ${a["\\$(k"]} tail',
    'echo $(( "\\$(" )) tail',
    'echo $(echo "\\$(x") tail',
  ]) {
    const ast = parse(source);
    assert.equal(ast.errors, undefined, source);
    const command = nodeOfType(ast.commands[0].command, "Command");
    assert.equal(nodeOfType(command.args[1], "Word").text, "tail", source);
    assert.equal(verify(source, ast), source);
  }
  const array = parse('a=("\\$(foo" bar); echo after');
  assert.equal(array.errors, undefined);
  const value = nodeOfType(nodeOfType(array.commands[0].command, "Command").prefix[0], "Assignment").value;
  assert.deepEqual(
    nodeOfType(value, "ArrayValue").elements.map((element) => element.value),
    ["$(foo", "bar"],
  );
  assert.equal(nodeOfType(array.commands[1].command, "Command").name?.value, "echo");
  const nested = parse("echo $(echo \\$(x)) tail");
  assert.equal(nested.errors, undefined);
  const expansion = nodeOfType(nodeOfType(nested.commands[0].command, "Command").args[0], "Word").parts?.[0];
  assert.deepEqual(nodeOfType(expansion, "CommandExpansion").script?.errors, [
    { message: "unexpected token '('", pos: 14 },
  ]);
  // `$$(` still reads as `$` followed by `$(`, as Bash's quote scanner does.
  assert.equal(parse('echo ${x:-"$$(x"} tail').errors?.[0].message, "unterminated parameter expansion");
  assert.equal(parse('echo ${x:-"$$(x)"} tail').errors, undefined);
});

test("command and process substitution boundaries use function and assignment grammar", () => {
  for (const body of [
    "!(echo inside)\\\n# )\necho after",
    "function x@(echo inside)# )\necho after",
    "function x!(echo inside)# )\necho after",
    "function x+(echo inside)# )\necho after",
    "function x*(echo inside)# )\necho after",
    "function x?(echo inside)# )\necho after",
    "function x=(echo inside)# )\necho after",
    "x@()# )\n{ echo inside; }; echo after",
    "a[(1)#x]=x; echo after",
    "a[(1) #x]=x; echo after",
    "a[(1)]=x; !(echo inside)# )\necho after",
    "!(cat <<EOF\n)\nEOF\n)# )\necho after",
  ]) {
    for (const opener of ["$(", "<("]) {
      const source = `echo ${opener}${body}) tail`;
      const ast = parse(source);
      assert.equal(ast.errors, undefined, source);
      assert.equal(ast.commands.length, 1, source);
      const command = nodeOfType(ast.commands[0].command, "Command");
      const word = nodeOfType(command.args[0], "Word");
      const expansion = nodeOfType(word.parts?.[0], "CommandExpansion", "ProcessSubstitution");
      const script = expansion.script!;
      assert.equal(script.errors, undefined, source);
      assert.equal(source.slice(script.pos, script.end), body, source);
      const after = nodeOfType(script.commands.at(-1)?.command, "Command");
      assert.deepEqual(
        after.args.map((arg) => arg.text),
        ["after"],
        source,
      );
      assert.equal(nodeOfType(command.args[1], "Word").text, "tail", source);
      assert.equal(verify(source, ast), source);
    }
  }
});

test("hashes adjacent to extglob operands remain word data", () => {
  for (const body of [
    "echo !(x)#literal; echo after",
    "A=1 !(x)#literal; echo after",
    ">out !(x)#literal; echo after",
    "echo !\\\n(x)#literal; echo after",
    "case x in !(bad)) echo match;; esac; echo after",
  ]) {
    const source = `echo $(${body}) tail`;
    const ast = parse(source);
    assert.equal(ast.errors, undefined, source);
    const command = nodeOfType(ast.commands[0].command, "Command");
    const expansion = nodeOfType(nodeOfType(command.args[0], "Word").parts?.[0], "CommandExpansion");
    assert.equal(expansion.script?.errors, undefined, source);
    assert.equal(source.slice(expansion.script!.pos, expansion.script!.end), body, source);
    assert.equal(nodeOfType(command.args[1], "Word").text, "tail", source);
  }
});

test("ambiguous substitution boundaries retain the shared nesting limit", () => {
  const source = "echo $(".repeat(512) + "!(echo inside)# )\necho after" + ")".repeat(512);
  const ast = parse(source);
  assert.deepEqual(ast.errors?.[0], { message: "maximum command substitution nesting depth exceeded", pos: 1797 });
  assert.equal(nodeOfType(ast.commands[0].command, "Command").name?.value, "echo");
  assert.ok(JSON.parse(JSON.stringify(ast)).commands.length);
});

test("nested ambiguous boundaries do not depend on a warmed-up call stack", () => {
  const parser = new URL("../src/parser.ts", import.meta.url).href;
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { parse } from ${JSON.stringify(parser)};
     import assert from "node:assert/strict";
     for (const command of ["echo", "coproc worker"]) {
       let source = "echo leaf";
       for (let i = 0; i < 256; i++) source = command + " $(!(" + source + ")# )\\necho tail)";
       const ast = parse(source);
       assert.equal(ast.errors, undefined);
       const node = ast.commands[0].command;
       const call = node.type === "Coproc" ? node.body : node;
       const script = call.args[0].parts[0].script;
       assert.equal(script.errors, undefined);
       assert.equal(script.commands[0].command.type, "Pipeline");
       assert.equal(script.commands[0].command.prefixes[0].type, "Negation");
       JSON.stringify(ast);
     }
     const compound = ":; " + "( ".repeat(256) + "echo $(!(echo leaf)# )\\necho tail)" + " )".repeat(256);
     const mixed = parse("echo $(echo $(" + compound + "); echo $(!(echo sibling)# )\\necho tail))");
     assert.equal(mixed.errors, undefined);
     JSON.stringify(mixed);
     console.log("ok");`,
    ],
    { encoding: "utf8", timeout: 10000 },
  );
  assert.equal(result.status, 0, result.stderr || result.error?.message || `exit status ${result.status}`);
  assert.equal(result.stdout, "ok\n");
});

test("materializing nested substitutions does not repeatedly scan every enclosing script", () => {
  const reads = (depth: number): number => {
    let source = "echo leaf";
    for (let i = 0; i < depth; i++) source = "echo $(! (" + source + ")# )\necho tail)";
    return characterReads(source);
  };
  const small = reads(32);
  const large = reads(64);
  assert.ok(large < small * 5, `doubling nesting increased character reads from ${small} to ${large}`);
});

test("sibling substitution boundaries do not repeatedly parse preceding commands", () => {
  const sibling = "echo $(!(echo leaf)# )\necho tail); ";
  for (const [open, close] of [
    ["", ""],
    ["{ ", "}"],
    ["if :; then ", "fi"],
    ["for x in y; do ", "done"],
  ]) {
    const small = characterReads("echo $(" + open + sibling.repeat(32) + close + ")");
    const large = characterReads("echo $(" + open + sibling.repeat(64) + close + ")");
    assert.ok(large < small * 3, `doubling siblings increased character reads from ${small} to ${large}`);
  }
  const ast = parse("echo $({ " + sibling.repeat(512) + "})");
  assert.equal(ast.errors, undefined);
  const command = nodeOfType(ast.commands[0].command, "Command");
  const expansion = nodeOfType(nodeOfType(command.args[0], "Word").parts?.[0], "CommandExpansion");
  assert.equal(expansion.script?.errors, undefined);
  const group = nodeOfType(expansion.script?.commands[0].command, "BraceGroup");
  assert.equal(group.body.commands.length, 512);
});

test("nested script scopes isolate arithmetic, case patterns, and pending heredocs", () => {
  const arithmetic = parse("echo $(echo $((1 + $(!(printf 1)# )\nprintf 2))); echo $(!(echo sibling)# )\necho tail))");
  const commandCounts: number[] = [];
  JSON.stringify(arithmetic, (key, value) => {
    if (key === "errors") assert.equal(value, undefined);
    if (value?.type === "Script") commandCounts.push(value.commands.length);
    return value;
  });
  assert.deepEqual(commandCounts, [1, 2, 2, 2]);
  for (const source of [
    "echo $(echo $((case + 1)))",
    "echo $(case x in x) echo $(!(echo inner)# )\necho tail);; esac; echo after)",
    "echo $(case x in x) echo $(case y in y) !(echo inner)# )\necho tail;; esac);; esac; echo after)",
    "echo $(case x in $(case y in y) echo x;; esac)) echo matched;; esac)",
    "echo $(cat <<EOF $(!(echo inner)# )\necho tail)\nbody\nEOF\n)",
    "echo $(echo <(!(echo inner)# )\necho tail); echo after)",
    "echo $(echo >(!(echo inner)# )\necho tail); echo after)",
    "echo $(echo $\\\n(!(echo inner)# )\necho tail); echo after)",
    "echo $(echo $((1<(2)))); echo after",
  ]) {
    const ast = parse(source);
    JSON.stringify(ast, (key, value) => {
      if (key === "errors") assert.equal(value, undefined, source);
      return value;
    });
    assert.equal(verify(source, ast), source);
  }
});

test("nested substitution boundaries survive every lazy container", () => {
  let inner = "echo leaf";
  for (let i = 0; i < 4; i++) inner = "echo $(! (" + inner + ")# )\necho tail)";
  const expansion = inner.slice(5);
  for (const source of [
    "value=" + expansion,
    "array[" + expansion + "]=value",
    "array=(" + expansion + ")",
    "array=([" + expansion + "]=value)",
    "((" + expansion + "))",
    'for ((i="' + expansion + '";i<3;i++)); do :; done',
    "cat <<EOF\n" + expansion + "\nEOF",
    "[[ x =~ " + expansion + " ]]",
    "echo >" + expansion,
    'echo "${value:-' + expansion + '}"',
  ]) {
    const ast = parse(source);
    let substitutions = 0;
    JSON.stringify(ast, (key, value) => {
      if (key === "errors") assert.equal(value, undefined, source);
      if (value?.type === "CommandExpansion" || value?.type === "ArithmeticCommandExpansion") substitutions++;
      return value;
    });
    assert.equal(substitutions, 4, source);
    assert.equal(verify(source, ast), source);
  }
});

test("decoded backticks keep an independent source after an ambiguous substitution", () => {
  const source = "echo $(!(echo first)# )\necho last) `echo \\$(!(echo inner)# )\necho tail)`";
  const ast = parse(source);
  assert.equal(ast.errors, undefined);
  const command = nodeOfType(ast.commands[0].command, "Command");
  const backtick = nodeOfType(nodeOfType(command.args[1], "Word").parts?.[0], "CommandExpansion");
  assert.equal(backtick.script?.source, "echo $(!(echo inner)# )\necho tail)");
  const decoded = backtick.script!;
  assert.equal(decoded.errors, undefined);
  const nested = nodeOfType(nodeOfType(decoded.commands[0].command, "Command").args[0], "Word");
  const expansion = nodeOfType(nested.parts?.[0], "CommandExpansion");
  assert.deepEqual([expansion.pos, expansion.end], [5, 34]);
  assert.equal(expansion.script?.errors, undefined);
  assert.equal(expansion.script?.commands.length, 2);
  assert.equal(verify(source, ast), source);
});

test("<< inside an unquoted parameter expansion is pattern text, not a heredoc (#18)", () => {
  for (const body of [
    "echo ${x#<<}\n",
    "echo ${x%<<-}\n",
    "echo ${x/<</a}\n",
    "echo ${x:-<<}\n",
    "echo ${x#<<EOF}\nEOF\n",
    "echo ${x#<<\n}",
    "echo ${x#<<} ${y}\n",
    "echo ${x/b/)}\n",
    "echo ${#x}\n",
    "echo ${x:-$'\\''}\n",
    "echo ${ cat <<EOF\n'\nEOF\n}\n",
    "echo ${| cat <<EOF\n'\nEOF\n}\n",
    "echo ${\tcat <<EOF\n'\nEOF\n}\n",
    'echo "${ echo ")"; }"\n',
    'echo "${| echo ")"; }"\n',
  ]) {
    for (const [open, close] of [
      ["$(", ")"],
      ["<(", ")"],
      [">(", ")"],
    ]) {
      const source = `echo ${open}${body}${close}\necho after`;
      const ast = parse(source);
      assert.equal(ast.errors, undefined, source);
      assert.equal(ast.commands.length, 2, source);
      const argument = nodeOfType(nodeOfType(ast.commands[0].command, "Command").args[0], "Word");
      const expansion = nodeOfType(argument.parts?.[0], "CommandExpansion", "ProcessSubstitution");
      const script = expansion.script!;
      assert.equal(script.errors, undefined, source);
      assert.equal(source.slice(script.pos, script.end), body, source);
      const after = nodeOfType(ast.commands[1].command, "Command");
      assert.equal(after.name?.text, "echo", source);
      assert.equal(verify(source, ast), source);
    }
  }
});

test("heredocs beside and inside unquoted parameter expansions in $() still consume their bodies (#18)", () => {
  for (const [source, bodies] of [
    ["x=$(echo ${x#<<} <<EOF\nbody\nEOF\n)\necho after", ["body\n"]],
    ["x=$(echo ${x#$(cat <<EOF\nbody\nEOF\n)}\n)\necho after", ["body\n"]],
    ["x=$(echo ${x#<<} <<A <<B\na\nA\nb\nB\n)\necho after", ["a\n", "b\n"]],
    ["x=$(${ cat <<EOF\nbody\nEOF\n})\necho after", ["body\n"]],
  ] as const) {
    const ast = parse(source);
    assert.equal(ast.errors, undefined, source);
    assert.equal(ast.commands.length, 2, source);
    const found: string[] = [];
    JSON.stringify(ast, (key, value) => {
      if (key === "errors") assert.equal(value, undefined, source);
      if (value?.type === "HereDoc") found.push(source.slice(value.body.pos, value.body.end));
      return value;
    });
    assert.deepEqual(found, bodies, source);
    assert.equal(verify(source, ast), source);
  }
});

test("an unterminated parameter expansion inside $() is reported at the substitution (#18)", () => {
  const source = "x=$(echo ${x\n)\necho after";
  const ast = parse(source);
  assert.deepEqual(
    ast.errors?.map((error) => error.message),
    ["unterminated command substitution"],
  );
  assert.equal(ast.commands.length, 1);
  assert.equal(verify(source, ast), source);
});
