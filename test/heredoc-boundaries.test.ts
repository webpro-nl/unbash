import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "../src/parser.ts";
import { print } from "../src/printer.ts";
import { redirectsOf } from "./ast-helpers.ts";

test("unquoted heredoc delimiters match complete logical lines", () => {
  for (const [source, body, closing, commands] of [
    ["cat <<EOF\nx\nEO\\\nF\necho after", "x\n", { pos: 12, end: 17 }, 2],
    ["cat <<EOF\npre\\\nEOF\nEOF\n", "pre\\\nEOF\n", { pos: 19, end: 22 }, 1],
    ["cat <<EOF\n\\\nEOF\necho after", "", { pos: 12, end: 15 }, 2],
    ["cat <<EOF\nx\nEOF\\\n\necho after", "x\n", { pos: 12, end: 17 }, 2],
    ["cat <<EOF\nx\nEOF\\\n", "x\n", { pos: 12, end: 17 }, 1],
    ["cat <<-EOF\n\\\n\tEOF\necho after", "", { pos: 14, end: 17 }, 2],
    ["cat <<-EOF\n\t\\\n\tEOF\necho after", "", { pos: 15, end: 18 }, 2],
  ] as const) {
    const ast = parse(source);
    const heredoc = redirectsOf(ast.commands[0].command)[0];
    assert.ok(heredoc.type === "HereDoc", source);
    assert.equal(heredoc.body.text, body, source);
    assert.deepEqual(heredoc.closing, closing, source);
    assert.equal(ast.commands.length, commands, source);
    assert.equal(ast.errors, undefined, source);
    assert.equal(print(parse(print(ast))), print(ast), source);
  }
});

test("quoted delimiters keep physical lines and tab stripping keeps continued tabs", () => {
  for (const [source, body] of [
    ["cat <<'EOF'\nx\nEO\\\nF\nEOF\n", "x\nEO\\\nF\n"],
    ["cat <<-EOF\nEO\\\n\tF\nEOF\n", "EO\\\n\tF\n"],
    ["cat <<-EOF\n\tA\\\n\tB\nEOF\n", "\tA\\\n\tB\n"],
  ]) {
    const ast = parse(source);
    const heredoc = redirectsOf(ast.commands[0].command)[0];
    assert.ok(heredoc.type === "HereDoc", source);
    assert.equal(heredoc.body.text, body, source);
    assert.ok(heredoc.closing, source);
    assert.equal(ast.errors, undefined, source);
  }
});

test("substitution EOF recovery excludes delimiter text without reporting a closing delimiter", () => {
  for (const source of ["echo $(cat <<E\nx\nE)", "echo $(cat <<E\nx\nE )", "cat <(cat <<E\nx\nE )"]) {
    const ast = parse(source);
    const command = ast.commands[0].command;
    assert.ok(command.type === "Command", source);
    const word = command.suffix[0];
    assert.ok(word.type === "Word", source);
    const expansion = word.parts?.[0];
    assert.ok(expansion?.type === "CommandExpansion" || expansion?.type === "ProcessSubstitution", source);
    const heredoc = redirectsOf(expansion.script!.commands[0].command)[0];
    assert.ok(heredoc.type === "HereDoc", source);
    assert.equal(heredoc.body.text, "x\n", source);
    assert.equal(heredoc.closing, undefined, source);
    assert.equal(expansion.script?.errors, undefined, source);
    assert.equal(ast.errors, undefined, source);
    assert.equal(print(parse(print(ast))), print(ast), source);
  }
});

test("substitution EOF recovery resumes parsing after a continued delimiter prefix", () => {
  const ast = parse("echo $(cat <<abc\nx\nab\\\nc echo after)");
  const command = ast.commands[0].command;
  assert.ok(command.type === "Command");
  const word = command.suffix[0];
  assert.ok(word.type === "Word");
  const expansion = word.parts?.[0];
  assert.ok(expansion?.type === "CommandExpansion");
  const inner = expansion.script!;
  const heredoc = redirectsOf(inner.commands[0].command)[0];
  assert.ok(heredoc.type === "HereDoc");
  assert.equal(heredoc.body.text, "x\n");
  assert.equal(heredoc.closing, undefined);
  assert.equal(inner.commands.length, 2);
  const following = inner.commands[1].command;
  assert.ok(following.type === "Command");
  assert.equal(following.name?.text, "echo");
  assert.deepEqual(
    following.suffix.map((argument) => argument.type === "Word" && argument.text),
    ["after"],
  );
  assert.equal(inner.errors, undefined);
});

test("backtick EOF remains a real delimiter boundary", () => {
  const ast = parse("echo `cat <<E\nx\nE`");
  const command = ast.commands[0].command;
  assert.ok(command.type === "Command");
  const word = command.suffix[0];
  assert.ok(word.type === "Word");
  const expansion = word.parts?.[0];
  assert.ok(expansion?.type === "CommandExpansion");
  const heredoc = redirectsOf(expansion.script!.commands[0].command)[0];
  assert.ok(heredoc.type === "HereDoc");
  assert.equal(heredoc.body.text, "x\n");
  assert.deepEqual(heredoc.closing, { pos: 16, end: 17 });
});

test("tokens after a recovered delimiter report errors on the nested script", () => {
  const ast = parse("echo $(cat <<E\nx\nE;)");
  const command = ast.commands[0].command;
  assert.ok(command.type === "Command");
  const word = command.suffix[0];
  assert.ok(word.type === "Word");
  const expansion = word.parts?.[0];
  assert.ok(expansion?.type === "CommandExpansion");
  assert.deepEqual(expansion.script?.errors, [{ message: "unexpected token ';'", pos: 18 }]);
  assert.equal(ast.errors, undefined);
});

test("heredoc parts retain erased continuation spans and heredoc escapes", () => {
  const ast = parse("cat <<E\n\\\n$name \\q \\$literal\nE");
  const heredoc = redirectsOf(ast.commands[0].command)[0];
  assert.ok(heredoc.type === "HereDoc");
  assert.deepEqual(
    heredoc.body.parts?.map((part) => [part.type, part.text, part.type === "Literal" ? part.value : undefined]),
    [
      ["Literal", "\\\n", ""],
      ["SimpleExpansion", "$name", undefined],
      ["Literal", " \\q \\$literal\n", " \\q $literal\n"],
    ],
  );
  assert.equal(heredoc.body.parts?.map((part) => part.text).join(""), heredoc.body.text);
});

test("unterminated heredocs print a delimiter after a complete logical line", () => {
  for (const [source, expected] of [
    ["cat <<E\ntext\\", "cat << E\ntext\\\n\nE"],
    ["cat <<E\ntext\\\n", "cat << E\ntext\\\n\nE"],
    ["cat <<E\ntext\\\\", "cat << E\ntext\\\\\nE"],
    ["cat <<'E'\ntext\\", "cat << 'E'\ntext\\\nE"],
    ["cat <<'E'\ntext\\\n", "cat << 'E'\ntext\\\nE"],
  ]) {
    const printed = print(parse(source));
    assert.equal(printed, expected, source);
    assert.equal(print(parse(printed)), expected, source);
  }
});
