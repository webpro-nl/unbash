import { nodeOfType, redirectsOf } from "./ast-helpers.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "../src/parser.ts";

// ── Error recovery ──────────────────────────────────────────────────

test("unclosed subscript recovery has linear character-read growth", () => {
  for (const line of ["a[x y\n", "a[$x y\n", 'a["x" y\n', "a[${x} y\n", "a[$(echo x) y\n"]) {
    for (const closer of ["", "]"]) {
      const counts = [64, 128, 256].map((count) => {
        const source = line.repeat(count) + closer;
        const charCodeAt = String.prototype.charCodeAt;
        let reads = 0;
        String.prototype.charCodeAt = function (index: number): number {
          if (this === source) reads++;
          return charCodeAt.call(this, index);
        };
        let script;
        try {
          script = parse(source);
        } finally {
          String.prototype.charCodeAt = charCodeAt;
        }
        assert.equal(script.commands.length, count, source);
        assert.deepEqual(
          script.errors,
          Array.from({ length: count - (closer ? 1 : 0) }, (_, index) => ({
            message: "unterminated array subscript",
            pos: index * line.length + 1,
          })),
        );
        const last = nodeOfType(script.commands[count - 1].command, "Command");
        assert.equal(last.name?.text, closer ? line + closer : line.slice(0, line.lastIndexOf(" ")));
        return reads;
      });
      for (let i = 1; i < counts.length; i++) {
        assert.ok(counts[i] < counts[i - 1] * 2.2, `${JSON.stringify({ line, closer, counts })}`);
      }
    }
  }
});

test("an unclosed subscript preserves later assignments across recovery boundaries", () => {
  for (const [suffix, index] of [
    ["a[$x y\nb[z w]=1", "z w"],
    ['a[$x y # "\nb[$x z]=1\n# "', "$x z"],
    ["a[$x y # '\nb[$x z]=1\n# '", "$x z"],
  ] as const) {
    for (const prefix of ["", "a[$x y\n"]) {
      const source = prefix + suffix;
      const script = parse(source);
      const failures = prefix ? 2 : 1;
      assert.deepEqual(
        script.errors,
        Array.from({ length: failures }, (_, index) => ({
          message: "unterminated array subscript",
          pos: index * prefix.length + 1,
        })),
        source,
      );
      assert.equal(script.commands.length, failures + 1, source);
      const first = nodeOfType(script.commands[0].command, "Command");
      assert.equal(first.name?.text, "a[$x", source);
      assert.deepEqual(
        first.suffix.map((part) => nodeOfType(part, "Word").text),
        ["y"],
        source,
      );
      const next = nodeOfType(script.commands[failures].command, "Command");
      const assignment = nodeOfType(next.prefix[0], "Assignment");
      assert.equal(assignment.name, "b", source);
      assert.equal(assignment.index?.text, index, source);
    }
  }
});

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
  const command = nodeOfType(ast.commands[0].command, "If");

  for (const branch of [command, ...(command.elif ?? [])]) {
    assert.ok(branch.end >= branch.pos);
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
  assert.equal(nodeOfType(word, "Assignment", "Word").value, "abc");
  const quoted = nodeOfType(word, "Word").parts?.[0];
  assert.equal(quoted?.type, "DoubleQuoted");
  assert.deepEqual(quoted.parts, [{ type: "Literal", pos: 6, end: 9, value: "abc", text: "abc" }]);
  assert.ok(ast.errors?.some((e) => e.message.includes("unterminated double quote")));
});

test("unclosed locale string slices its literal fully", () => {
  const ast = parse('echo $"abc');
  const command = ast.commands[0].command;
  assert.equal(command.type, "Command");
  const word = command.suffix[0];
  assert.equal(nodeOfType(word, "Assignment", "Word").value, "abc");
  const quoted = nodeOfType(word, "Word").parts?.[0];
  assert.equal(quoted?.type, "LocaleString");
  assert.deepEqual(quoted.parts, [{ type: "Literal", pos: 7, end: 10, value: "abc", text: "abc" }]);
  assert.ok(ast.errors?.some((e) => e.message.includes("unterminated double quote")));
});

test("unclosed double quote slices its trailing literal after expansions", () => {
  const ast = parse('echo "pre$(x) ab');
  const command = ast.commands[0].command;
  assert.equal(command.type, "Command");
  const word = command.suffix[0];
  assert.equal(nodeOfType(word, "Assignment", "Word").value, "pre$(x) ab");
  const quoted = nodeOfType(word, "Word").parts?.[0];
  assert.equal(quoted?.type, "DoubleQuoted");
  assert.equal(quoted.parts.length, 3);
  assert.deepEqual(quoted.parts[2], { type: "Literal", pos: 13, end: 16, value: " ab", text: " ab" });
  assert.ok(ast.errors?.some((e) => e.message.includes("unterminated double quote")));
});

test("unclosed ANSI-C quote terminates at end of input", () => {
  const plain = parse("echo $'abc");
  const plainCommand = plain.commands[0].command;
  assert.equal(plainCommand.type, "Command");
  assert.equal(nodeOfType(plainCommand.suffix[0], "Assignment", "Word").value, "abc");
  assert.deepEqual(plain.errors, [{ message: "unterminated ANSI-C quote", pos: 6 }]);

  const trailing = parse("echo $'\\");
  const command = trailing.commands[0].command;
  assert.equal(command.type, "Command");
  assert.equal(nodeOfType(command.suffix[0], "Assignment", "Word").text, "$'\\");
  assert.equal(nodeOfType(command.suffix[0], "Assignment", "Word").value, "\\");
  assert.deepEqual(trailing.errors, [{ message: "unterminated ANSI-C quote", pos: 6 }]);
});

test("unclosed ANSI-C quotes inside parameter expansions collect both errors", () => {
  const ast = parse("echo ${x:-$'abc}");
  assert.deepEqual(ast.errors, [
    { message: "unterminated parameter expansion", pos: 5 },
    { message: "unterminated ANSI-C quote", pos: 11 },
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

test("comment-only then body collects an error (#321)", () => {
  const source = `if [[ "\${tmp}" = *"-----BEGIN CERTIFICATE-----"* ]]; then
  # ...
fi`;

  assert.deepEqual(parse(source).errors, [{ message: "expected command after 'then'", pos: 66 }]);

  const valid = `if [[ "\${tmp}" = *"-----BEGIN CERTIFICATE-----"* ]]; then
  # ...
  :
fi`;
  assert.equal(parse(valid).errors, undefined);
});

test("unexpected root list terminators collect errors and recover", () => {
  for (const terminator of ["then", "else", "elif", "fi", "do", "done", "in", "esac", ")", "}", ";;", ";&", ";;&"]) {
    const source = `safe\n${terminator}; recovered`;
    const ast = parse(source);

    assert.deepEqual(
      ast.errors,
      [{ message: `unexpected token '${terminator}'`, pos: source.indexOf(terminator) }],
      source,
    );
    assert.equal(ast.commands.length, 2, source);
    assert.equal(ast.commands[0].command.type === "Command" && ast.commands[0].command.name?.value, "safe", source);
    assert.equal(
      ast.commands[1].command.type === "Command" && ast.commands[1].command.name?.value,
      "recovered",
      source,
    );
  }
});

test("valid trailing separators, comments, and whitespace reach EOF", () => {
  for (const source of ["safe;", "safe &", "safe\n", "safe; # comment\n\n\t# final comment"]) {
    const ast = parse(source);
    assert.equal(ast.errors, undefined, source);
    assert.equal(ast.commands.length, 1, source);
  }
});

test("root recovery appends large statement lists without exceeding the argument limit", () => {
  const statementCount = 130_000;
  const ast = parse("fi;\n" + "x\n".repeat(statementCount));

  assert.deepEqual(ast.errors, [{ message: "unexpected token 'fi'", pos: 0 }]);
  assert.equal(ast.commands.length, statementCount);
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
  for (const source of [
    'echo >""',
    "echo >''",
    "echo >$''",
    'echo >$""',
    'echo <<< ""',
    "echo <<< $''",
    'echo <<< $""',
    "cat <<''",
  ]) {
    const ast = parse(source);
    assert.equal(ast.errors, undefined, source);
    const redirect = redirectsOf(nodeOfType(ast.commands[0].command, "Command"))[0];
    const target = redirect.type === "HereDoc" ? redirect.delimiter : redirect.target;
    assert.ok(target, source);
    assert.equal(target.value, "", source);
  }
});

test("process substitutions are here-string targets", () => {
  for (const [source, target] of [
    ["cat <<< <(f)", "<(f)"],
    ["cat <<< >(f)", ">(f)"],
    ["cat <<<<(f)", "<(f)"],
    ["cat <<<>(f)", ">(f)"],
  ]) {
    const ast = parse(source);
    assert.equal(ast.errors, undefined, source);
    const redirect = nodeOfType(
      redirectsOf(nodeOfType(ast.commands[0].command, "Command"))[0],
      "HereString",
      "Redirect",
    );
    assert.equal(redirect.operator, "<<<", source);
    assert.equal(redirect.target?.text, target, source);
    assert.equal(redirect.target?.parts?.[0]?.type, "ProcessSubstitution", source);
  }
});

test("comments are not redirect targets", () => {
  for (const source of ["echo >#comment", "echo > #comment", "echo &>#comment", "echo <<<#comment", "cat <<#comment"]) {
    assert.deepEqual(parse(source).errors, [{ message: "expected redirect target", pos: source.indexOf("#") }], source);
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
  assert.equal(nodeOfType(command.suffix[0], "Assignment", "Word").text, "${");
  assert.deepEqual(ast.errors, [{ message: "unterminated parameter expansion", pos: 5 }]);
});

test("unclosed parameter expansion preserves its complete partial structure", () => {
  const source = "echo pre${name";
  const ast = parse(source);
  const command = ast.commands[0].command;

  assert.equal(command.type, "Command");
  const word = command.suffix[0];
  assert.equal(nodeOfType(word, "Assignment", "Word").text, "pre${name");
  assert.deepEqual(
    nodeOfType(word, "Word").parts?.map((part) => part.type),
    ["Literal", "ParameterExpansion"],
  );
  const expansion = nodeOfType(word, "Word").parts?.[1];
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
  const word = nodeOfType(nodeOfType(ast.commands[0].command, "Command").suffix[0], "Word");
  const part = word.parts?.find((p) => p.type === "CommandExpansion");
  assert.equal(nodeOfType(part?.script?.commands[0].command, "Command").name?.text, "foo");
});

test("errors are ordered by source position", () => {
  // Recovery and lexer errors are appended after earlier parser errors, so the list has to
  // be sorted before it is handed to consumers.
  const ast = parse("for i 'in' a; do echo $i; done");
  const positions = ast.errors!.map((e) => e.pos);
  assert.deepEqual(
    positions,
    [...positions].sort((a, b) => a - b),
    JSON.stringify(ast.errors),
  );

  const mixed = parse("safe\nfi; echo ok\n;;\necho done");
  const mixedPositions = mixed.errors!.map((e) => e.pos);
  assert.deepEqual(
    mixedPositions,
    [...mixedPositions].sort((a, b) => a - b),
    JSON.stringify(mixed.errors),
  );
});

test("empty brace groups and subshells report a missing command", () => {
  for (const [source, message, pos] of [
    ["{ }", "expected command in brace group", 0],
    ["( )", "expected command in subshell", 0],
    ["f() { }", "expected command in brace group", 4],
    ["{ # comment\n}", "expected command in brace group", 0],
  ] as const) {
    assert.deepEqual(parse(source).errors, [{ message, pos }], source);
  }
  for (const source of ["{ :; }", "( : )", "echo $( )", "x=$( )"]) {
    assert.equal(parse(source).errors, undefined, source);
  }
});

test("empty conditions and loop or else bodies report a missing command", () => {
  for (const [source, message, pos] of [
    ["if; then :; fi", "expected command after 'if'", 2],
    ["if true; then :; elif; then :; fi", "expected command after 'elif'", 21],
    ["if true; then :; else fi", "expected command after 'else'", 22],
    ["while; do :; done", "expected command after 'while'", 5],
    ["until\ndo :; done", "expected command after 'until'", 6],
    ["while # c\ndo :; done", "expected command after 'while'", 10],
    ["while false; do\ndone", "expected command after 'do'", 16],
    ["for x in a; do done", "expected command after 'do'", 15],
    ["for ((;;)); do done", "expected command after 'do'", 15],
    ["select x in a; do done", "expected command after 'do'", 18],
  ] as const) {
    assert.deepEqual(parse(source).errors, [{ message, pos }], source);
  }
  for (const source of [
    "while :; do :; done",
    "until false; do :; done",
    "if a; then b; elif c; then d; else e; fi",
    "if true; then :; else # c\n:; fi",
    "for x; do :; done",
    "for ((;;)) { :; }",
  ]) {
    assert.equal(parse(source).errors, undefined, source);
  }
});

test("case, for and select require a word after the keyword", () => {
  for (const [source, message, pos] of [
    ["case\nin esac", "expected word after 'case'", 4],
    ["for ; do :; done", "expected word after 'for'", 4],
    ["select ; do :; done", "expected word after 'select'", 7],
  ] as const) {
    assert.deepEqual(parse(source).errors, [{ message, pos }], source);
  }
});

test("case items need pattern words separated by '|' and a terminator before the next pattern", () => {
  for (const [source, pos] of [
    ["case x in a b) echo;; esac", 12],
    ["case x in ) echo;; esac", 10],
    ["case x in a | ) echo;; esac", 14],
    ["case x in a) echo;; | b) ;; esac", 20],
    ["case x in a |\nb) ;; esac", 13],
    ["case x in a) b) echo;; esac", 14],
    ["case x in a) ; b) ;; esac", 13],
    ["case x in a) echo\nb) echo;; esac", 19],
  ] as const) {
    const token = source[pos] === "\n" ? "newline" : source[pos];
    assert.deepEqual(parse(source).errors, [{ message: `unexpected token '${token}'`, pos }], source);
  }
  for (const source of [
    "case x in a) echo ;; b) esac",
    "case x in (a) ;; esac",
    "case x in a|b) echo;; (c|d) echo;& e) ;;& esac",
    'case x in a|"b c"|$y) ;; esac',
    "case x in\n# c\na) ;; esac",
    "case x in a) # c\n;; esac",
    "case x in a) echo\n;;\nesac",
    "case in in in) echo;; esac",
  ]) {
    assert.equal(parse(source).errors, undefined, source);
  }
});
