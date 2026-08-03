import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "../src/parser.ts";
import type { If } from "../src/types.ts";

// ── Error recovery ──────────────────────────────────────────────────

test("unclosed single quote doesn't throw", () => {
  const ast = parse("echo 'unterminated");
  assert.equal(ast.type, "Script");
});

test("unclosed double quote doesn't throw", () => {
  const ast = parse('echo "unterminated');
  assert.equal(ast.type, "Script");
});

test("unmatched parentheses don't throw", () => {
  const ast = parse("(echo hello");
  assert.equal(ast.type, "Script");
});

test("truncated if (missing fi) doesn't throw", () => {
  const ast = parse("if true; then echo yes");
  assert.equal(ast.type, "Script");
});

test("truncated elif chain keeps valid branch spans", () => {
  const ast = parse("if a; then b; elif c; then d");
  let branch = ast.commands[0].command as If;

  for (;;) {
    assert.ok(branch.end >= branch.pos);
    if (branch.else?.type !== "If") break;
    branch = branch.else;
  }
});

test("truncated for (missing done) doesn't throw", () => {
  const ast = parse("for x in a b; do echo $x");
  assert.equal(ast.type, "Script");
});

test("truncated while (missing done) doesn't throw", () => {
  const ast = parse("while true; do echo loop");
  assert.equal(ast.type, "Script");
});

// ── Error collection ────────────────────────────────────────────────

test("missing fi collects error", () => {
  const ast = parse("if true; then echo yes");
  assert.ok(ast.errors);
  assert.ok(ast.errors.some((e) => e.message.includes("expected 'fi'")));
});

test("missing done collects error", () => {
  const ast = parse("for x in a b; do echo $x");
  assert.ok(ast.errors);
  assert.ok(ast.errors.some((e) => e.message.includes("expected 'done'")));
});

test("missing ) collects error", () => {
  const ast = parse("(echo hello");
  assert.ok(ast.errors);
  assert.ok(ast.errors.some((e) => e.message.includes("expected ')'")));
});

test("unclosed single quote collects error", () => {
  const ast = parse("echo 'unterminated");
  assert.ok(ast.errors);
  assert.ok(ast.errors.some((e) => e.message.includes("unterminated single quote")));
});

test("unclosed double quote collects error", () => {
  const ast = parse('echo "unterminated');
  assert.ok(ast.errors);
  assert.ok(ast.errors.some((e) => e.message.includes("unterminated double quote")));
});

test("unclosed double quote slices its literal fully", () => {
  const ast = parse('echo "abc');
  const command = ast.commands[0].command;
  assert.equal(command.type, "Command");
  const word = command.suffix[0];
  assert.equal(word.value, "abc");
  const quoted = word.parts?.[0];
  assert.equal(quoted?.type, "DoubleQuoted");
  assert.deepEqual(quoted.parts, [{ type: "Literal", value: "abc", text: "abc" }]);
  assert.ok(ast.errors?.some((e) => e.message.includes("unterminated double quote")));
});

test("unclosed locale string slices its literal fully", () => {
  const ast = parse('echo $"abc');
  const command = ast.commands[0].command;
  assert.equal(command.type, "Command");
  const word = command.suffix[0];
  assert.equal(word.value, "abc");
  const quoted = word.parts?.[0];
  assert.equal(quoted?.type, "LocaleString");
  assert.deepEqual(quoted.parts, [{ type: "Literal", value: "abc", text: "abc" }]);
  assert.ok(ast.errors?.some((e) => e.message.includes("unterminated double quote")));
});

test("unclosed double quote slices its trailing literal after expansions", () => {
  const ast = parse('echo "pre$(x) ab');
  const command = ast.commands[0].command;
  assert.equal(command.type, "Command");
  const word = command.suffix[0];
  assert.equal(word.value, "pre$(x) ab");
  const quoted = word.parts?.[0];
  assert.equal(quoted?.type, "DoubleQuoted");
  assert.equal(quoted.parts.length, 3);
  assert.deepEqual(quoted.parts[2], { type: "Literal", value: " ab", text: " ab" });
  assert.ok(ast.errors?.some((e) => e.message.includes("unterminated double quote")));
});

test("unclosed ANSI-C quote terminates at end of input", () => {
  const plain = parse("echo $'abc");
  const plainCommand = plain.commands[0].command;
  assert.equal(plainCommand.type, "Command");
  assert.equal(plainCommand.suffix[0].value, "abc");
  assert.deepEqual(plain.errors, [{ message: "unterminated ANSI-C quote", pos: 6 }]);

  const trailing = parse("echo $'\\");
  const command = trailing.commands[0].command;
  assert.equal(command.type, "Command");
  assert.equal(command.suffix[0].text, "$'\\");
  assert.equal(command.suffix[0].value, "\\");
  assert.deepEqual(trailing.errors, [{ message: "unterminated ANSI-C quote", pos: 6 }]);
});

test("unclosed ANSI-C quotes inside parameter expansions collect both errors", () => {
  const ast = parse("echo ${x:-$'abc}");
  assert.deepEqual(ast.errors, [
    { message: "unterminated ANSI-C quote", pos: 11 },
    { message: "unterminated parameter expansion", pos: 5 },
  ]);
});

test("valid input has no errors", () => {
  const ast = parse("echo hello world");
  assert.equal(ast.errors, undefined);
});

test("valid compound commands have no errors", () => {
  const ast = parse("if true; then echo yes; fi");
  assert.equal(ast.errors, undefined);
});

test("trailing command operators collect errors", () => {
  for (const operator of ["&&", "||", "|", "|&"]) {
    const source = `echo ${operator}`;
    assert.deepEqual(parse(source).errors, [{ message: `expected command after '${operator}'`, pos: source.length }]);
  }
});

test("command operators accept a command after newlines", () => {
  for (const operator of ["&&", "||", "|", "|&"]) {
    assert.equal(parse(`echo ${operator}\nprintf next`).errors, undefined);
  }
});

test("missing redirect targets collect errors", () => {
  for (const source of [
    "echo >",
    "echo >>",
    "echo <",
    "cat <<",
    "cat <<-",
    "echo <<<",
    "echo <>",
    "echo <&",
    "echo >&",
    "echo >|",
    "echo &>",
    "echo &>>",
    "echo 2>",
    "echo {fd}>",
  ]) {
    assert.deepEqual(parse(source).errors, [{ message: "expected redirect target", pos: source.length }], source);
  }
});

test("quoted empty redirect targets are not missing targets", () => {
  for (const source of ['echo >""', "echo >''", 'echo <<< ""', "cat <<''"]) {
    const ast = parse(source);
    assert.equal(ast.errors, undefined, source);
    const target = (ast.commands[0].command as any).redirects[0].target;
    assert.ok(target, source);
    assert.equal(target.value, "", source);
  }
});

test("comments are not redirect targets", () => {
  for (const source of ["echo >#comment", "echo > #comment", "echo &>#comment", "echo <<<#comment", "cat <<#comment"]) {
    assert.deepEqual(
      parse(source).errors,
      [{ message: "expected redirect target", pos: source.indexOf("#") }],
      source,
    );
  }
});

test("multiple errors collected", () => {
  const ast = parse("if true; then (echo hello");
  assert.ok(ast.errors);
  assert.ok(ast.errors.length >= 2, `expected >= 2 errors, got ${ast.errors.length}`);
});

test("error positions are reasonable", () => {
  const input = "for x in a b; do echo $x";
  const ast = parse(input);
  assert.ok(ast.errors);
  for (const err of ast.errors) {
    assert.ok(err.pos >= 0, `pos ${err.pos} should be >= 0`);
    assert.ok(err.pos <= input.length, `pos ${err.pos} should be <= input length ${input.length}`);
  }
});

// ── Edge-case inputs ─────────────────────────────────────────────────

test("empty input returns empty Script", () => {
  const ast = parse("");
  assert.equal(ast.type, "Script");
  assert.equal(ast.commands.length, 0);
});

test("whitespace-only returns empty Script", () => {
  const ast = parse("   \n\n  \t  ");
  assert.equal(ast.type, "Script");
  assert.equal(ast.commands.length, 0);
});

test("comment-only returns empty Script", () => {
  const ast = parse("# just a comment\n# another");
  assert.equal(ast.type, "Script");
  assert.equal(ast.commands.length, 0);
});

test("unclosed command substitution collects error", () => {
  const ast = parse("curl $(foo");
  assert.ok(ast.errors);
  assert.ok(ast.errors.some((e) => e.message.includes("unterminated command substitution")));
});

test("unclosed command substitution inside double quotes collects error", () => {
  const ast = parse('echo "$(foo"');
  assert.ok(ast.errors);
  assert.ok(ast.errors.some((e) => e.message.includes("unterminated command substitution")));
});

test("unclosed process substitution collects error", () => {
  const ast = parse("diff <(foo");
  assert.ok(ast.errors);
  assert.ok(ast.errors.some((e) => e.message.includes("unterminated process substitution")));
});

test("unclosed parameter expansion collects error and preserves the partial word", () => {
  const ast = parse("echo ${");
  const command = ast.commands[0].command;

  assert.equal(command.type, "Command");
  assert.equal(command.suffix[0].text, "${");
  assert.deepEqual(ast.errors, [{ message: "unterminated parameter expansion", pos: 5 }]);
});

test("unclosed parameter expansion preserves its complete partial structure", () => {
  const source = "echo pre${name";
  const ast = parse(source);
  const command = ast.commands[0].command;

  assert.equal(command.type, "Command");
  const word = command.suffix[0];
  assert.equal(word.text, "pre${name");
  assert.deepEqual(
    word.parts?.map((part) => part.type),
    ["Literal", "ParameterExpansion"],
  );
  const expansion = word.parts?.[1];
  assert.equal(expansion?.type, "ParameterExpansion");
  if (expansion?.type === "ParameterExpansion") assert.equal(expansion.parameter, "name");
  assert.deepEqual(ast.errors, [{ message: "unterminated parameter expansion", pos: source.indexOf("$") }]);
});

test("closed and empty parameter expansions do not report parse errors", () => {
  assert.equal(parse("echo ${name}").errors, undefined);
  assert.equal(parse("echo ${}").errors, undefined);
});

test("unclosed command substitution keeps the inner command name intact", () => {
  const ast = parse("curl $(foo");
  const word = ast.commands[0].command.suffix[0];
  const part = word.parts.find((p) => p.type === "CommandExpansion");
  assert.equal(part.script.commands[0].command.name.text, "foo");
});
