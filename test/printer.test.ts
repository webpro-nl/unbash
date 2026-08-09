import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "../src/parser.ts";
import { print } from "../src/printer.ts";

const fmt = (s: string) => print(parse(s));

// --- Shebang ---

test("shebang preserved", () => {
  assert.equal(fmt("#!/bin/bash\necho hello"), "#!/bin/bash\n\necho hello");
});

test("shebang with env", () => {
  assert.equal(fmt("#!/usr/bin/env bash\necho hello"), "#!/usr/bin/env bash\n\necho hello");
});

test("no shebang for plain comment", () => {
  assert.equal(fmt("echo hello"), "echo hello");
});

// --- Simple commands ---

test("simple command", () => {
  assert.equal(fmt("echo hello world"), "echo hello world");
});

test("command with quoted args", () => {
  assert.equal(fmt("echo \"hello world\" 'foo'"), "echo \"hello world\" 'foo'");
});

test("assignment-only command", () => {
  assert.equal(fmt("x=1 y=2"), "x=1 y=2");
});

test("assignment with command", () => {
  assert.equal(fmt("PATH=/bin ls"), "PATH=/bin ls");
});

test("empty command (bare assignment)", () => {
  assert.equal(fmt("x=hello"), "x=hello");
});

// --- Redirects ---

test("output redirect", () => {
  assert.equal(fmt("echo hi > file"), "echo hi > file");
});

test("append redirect", () => {
  assert.equal(fmt("echo hi >> file"), "echo hi >> file");
});

test("input redirect", () => {
  assert.equal(fmt("cat < file"), "cat < file");
});

test("fd redirect", () => {
  assert.equal(fmt("cmd 2>&1"), "cmd 2>&1");
});

test("fd redirect with dup", () => {
  assert.equal(fmt("cmd 2>/dev/null"), "cmd 2> /dev/null");
});

test("herestring", () => {
  assert.equal(fmt("cat <<< hello"), "cat <<< hello");
});

// --- Pipelines ---

test("simple pipeline", () => {
  assert.equal(fmt("cat file | grep foo"), "cat file | grep foo");
});

test("pipeline with |&", () => {
  assert.equal(fmt("cmd1 |& cmd2"), "cmd1 |& cmd2");
});

test("negated pipeline", () => {
  assert.equal(fmt("! cmd"), "! cmd");
});

test("time pipeline", () => {
  assert.equal(fmt("time cmd"), "time cmd");
});

test("bare time has no trailing whitespace", () => {
  assert.equal(fmt("time"), "time");
  assert.equal(fmt("time -p"), "time");
});

// --- And/Or ---

test("and list", () => {
  assert.equal(fmt("cmd1 && cmd2"), "cmd1 && cmd2");
});

test("or list", () => {
  assert.equal(fmt("cmd1 || cmd2"), "cmd1 || cmd2");
});

test("mixed and/or", () => {
  assert.equal(fmt("a && b || c"), "a && b || c");
});

// --- If ---

test("if/then/fi", () => {
  assert.equal(fmt("if true; then echo yes; fi"), ["if true; then", "  echo yes", "fi"].join("\n"));
});

test("if/else/fi", () => {
  assert.equal(
    fmt("if test -f x; then echo y; else echo n; fi"),
    ["if test -f x; then", "  echo y", "else", "  echo n", "fi"].join("\n"),
  );
});

test("if/elif/else/fi", () => {
  assert.equal(
    fmt("if a; then b; elif c; then d; else e; fi"),
    ["if a; then", "  b", "elif c; then", "  d", "else", "  e", "fi"].join("\n"),
  );
});

test("nested if", () => {
  assert.equal(
    fmt("if a; then if b; then c; fi; fi"),
    ["if a; then", "  if b; then", "    c", "  fi", "fi"].join("\n"),
  );
});

// --- For ---

test("for loop", () => {
  assert.equal(fmt("for x in a b c; do echo $x; done"), ["for x in a b c; do", "  echo $x", "done"].join("\n"));
});

test("for loop without wordlist", () => {
  assert.equal(fmt("for x; do echo $x; done"), ["for x; do", "  echo $x", "done"].join("\n"));
});

// --- While / Until ---

test("while loop", () => {
  assert.equal(fmt("while true; do echo loop; done"), ["while true; do", "  echo loop", "done"].join("\n"));
});

test("until loop", () => {
  assert.equal(fmt("until false; do echo loop; done"), ["until false; do", "  echo loop", "done"].join("\n"));
});

// --- Case ---

test("case statement", () => {
  assert.equal(
    fmt("case $x in a) echo a;; b) echo b;; esac"),
    ["case $x in", "  a)", "    echo a", "    ;;", "  b)", "    echo b", "    ;;", "esac"].join("\n"),
  );
});

test("case with multiple patterns", () => {
  assert.equal(
    fmt("case $x in a|b) echo ab;; esac"),
    ["case $x in", "  a | b)", "    echo ab", "    ;;", "esac"].join("\n"),
  );
});

// --- Function ---

test("function definition", () => {
  assert.equal(fmt("foo() { echo hello; }"), ["foo() {", "  echo hello", "}"].join("\n"));
});

test("function with keyword", () => {
  assert.equal(fmt("function bar { echo hi; }"), ["bar() {", "  echo hi", "}"].join("\n"));
});

// --- Subshell ---

test("subshell single command", () => {
  assert.equal(fmt("(echo hello)"), "(echo hello)");
});

test("subshell multi command", () => {
  assert.equal(fmt("(echo a; echo b)"), ["(", "  echo a", "  echo b", ")"].join("\n"));
});

test("nested subshells stay distinct from arithmetic commands", () => {
  const cases = [
    ["( (ls) )", "( (ls))", "Subshell"],
    ["( ((ls)) )", "( (( ls )))", "ArithmeticCommand"],
    ["( (echo x; echo y) )", ["( (", "  echo x", "  echo y", "))"].join("\n"), "Subshell"],
  ];

  for (const [source, expected, innerType] of cases) {
    const printed = fmt(source);
    assert.equal(printed, expected, source);
    assert.equal(fmt(printed), printed, source);

    const outer = parse(printed).commands[0]?.command;
    assert.equal(outer?.type, "Subshell", source);
    if (outer?.type !== "Subshell") assert.fail(source);
    assert.equal(outer.body.commands[0]?.command.type, innerType, source);
  }
});

// --- Brace group ---

test("brace group", () => {
  assert.equal(fmt("{ echo a; echo b; }"), ["{", "  echo a", "  echo b", "}"].join("\n"));
});

// --- Test command ---

test("test unary", () => {
  assert.equal(fmt("[[ -f file ]]"), "[[ -f file ]]");
});

test("test binary", () => {
  assert.equal(fmt("[[ $x = hello ]]"), "[[ $x = hello ]]");
});

test("test logical", () => {
  assert.equal(fmt("[[ -f a && -d b ]]"), "[[ -f a && -d b ]]");
});

test("test not", () => {
  assert.equal(fmt("[[ ! -f a ]]"), "[[ ! -f a ]]");
});

// --- Arithmetic command ---

test("arithmetic command", () => {
  assert.equal(fmt("(( x + 1 ))"), "(( x + 1 ))");
});

test("arithmetic command normalizes spacing", () => {
  assert.equal(fmt("((x+1))"), "(( x + 1 ))");
});

// --- Arithmetic for ---

test("arithmetic for loop", () => {
  assert.equal(
    fmt("for ((i=0; i<10; i++)); do echo $i; done"),
    ["for (( i = 0; i < 10; i++ )); do", "  echo $i", "done"].join("\n"),
  );
});

// --- Coproc ---

test("coproc with name", () => {
  assert.equal(fmt("coproc myproc { echo hello; }"), ["coproc myproc {", "  echo hello", "}"].join("\n"));
});

test("coproc without name", () => {
  assert.equal(fmt("coproc { echo hello; }"), ["coproc {", "  echo hello", "}"].join("\n"));
});

// --- Background ---

test("background command", () => {
  assert.equal(fmt("sleep 10 &"), "sleep 10 &");
});

// --- Multiple statements ---

test("multiple statements", () => {
  assert.equal(fmt("echo a; echo b; echo c"), ["echo a", "echo b", "echo c"].join("\n"));
});

// --- Heredoc ---

test("heredoc", () => {
  const src = "cat <<EOF\nhello\nworld\nEOF";
  assert.equal(fmt(src), "cat << EOF\nhello\nworld\nEOF");
});

test("unterminated heredoc without a final newline prints stably", () => {
  const printed = fmt("cat <<EOF\nno end marker");
  assert.equal(printed, "cat << EOF\nno end marker\nEOF");
  assert.equal(print(parse(printed)), printed);
});

test("empty heredoc body stays empty", () => {
  assert.equal(fmt("cat <<EOF\nEOF"), "cat << EOF\nEOF");
});

test("heredoc target at end of input has an empty body", () => {
  assert.equal(fmt("cat <<EOF"), "cat << EOF\nEOF");
});

test("escaped redirect target is requoted", () => {
  assert.equal(fmt("echo hi > fi\\ le"), "echo hi > 'fi le'");
  const command = parse(fmt("echo hi > fi\\ le")).commands[0].command as any;
  assert.equal(command.redirects[0].target?.value, "fi le");
  assert.equal(command.suffix.length, 1);
});

test("single quote inside decoded redirect target is escaped", () => {
  const printed = fmt("echo hi > a\\'b");
  assert.equal(printed, "echo hi > 'a'\\''b'");
  const command = parse(printed).commands[0].command as any;
  assert.equal(command.redirects[0].target?.value, "a'b");
});

test("glob redirect target stays unquoted", () => {
  assert.equal(fmt("echo hi > fi*"), "echo hi > fi*");
});

test("escaped redirect syntax stays literal", () => {
  for (const [target, value] of [
    ["fi\\*", "fi*"],
    ["\\$HOME", "$HOME"],
    ["\\~", "~"],
    ["\\#file", "#file"],
  ] as const) {
    const printed = fmt(`echo hi > ${target}`);
    const command = parse(printed).commands[0].command as any;
    const reparsed = command.redirects[0].target;
    assert.equal(reparsed?.value, value, target);
    assert.equal(
      reparsed?.parts?.some((part: any) =>
        ["SimpleExpansion", "ParameterExpansion", "CommandExpansion", "ArithmeticExpansion"].includes(part.type),
      ) ?? false,
      false,
      target,
    );
  }
});

test("escaped heredoc delimiter prints requoted", () => {
  const printed = fmt("cat <<E\\ OF\nline $HOME\nE OF");
  assert.equal(printed, "cat << 'E OF'\nline $HOME\nE OF");
  const redirect = (parse(printed).commands[0].command as any).redirects[0];
  assert.equal(redirect.heredocQuoted, true);
});

test("quoted heredoc delimiter with space round-trips", () => {
  const printed = fmt("cat <<'E OF'\nline $HOME\nE OF");
  assert.equal(printed, "cat << 'E OF'\nline $HOME\nE OF");
  const redirect = (parse(printed).commands[0].command as any).redirects[0];
  assert.equal(redirect.heredocQuoted, true);
});

test("mixed-quoted heredoc delimiters print their decoded closing line", () => {
  const printed = fmt('cat <<E"O"F\nbody\nEOF');
  assert.equal(printed, "cat << 'EOF'\nbody\nEOF");
  const redirect = (parse(printed).commands[0].command as any).redirects[0];
  assert.equal(redirect.target?.value, "EOF");
  assert.equal(redirect.heredocQuoted, true);
});

test("escaped heredoc delimiters stay quoted after printing", () => {
  const printed = fmt("cat <<E\\OF\nbody\nEOF");
  assert.equal(printed, "cat << 'EOF'\nbody\nEOF");
  const redirect = (parse(printed).commands[0].command as any).redirects[0];
  assert.equal(redirect.heredocQuoted, true);
});

// --- Re-parse validity ---
// Print then re-parse — the output should parse without errors

function reparsesClean(label: string, src: string) {
  test(`re-parse: ${label}`, () => {
    const printed = fmt(src);
    const ast2 = parse(printed);
    assert.equal((ast2 as any).errors, undefined, `re-parse errors for: ${printed}`);
  });
}

reparsesClean("simple cmd", "echo hello");
reparsesClean("pipeline", "cat f | grep x | head");
reparsesClean("and/or", "a && b || c");
reparsesClean("if/elif/else", "if a; then b; elif c; then d; else e; fi");
reparsesClean("for loop", "for x in 1 2 3; do echo $x; done");
reparsesClean("while loop", "while read line; do echo $line; done");
reparsesClean("case", "case $x in a) echo a;; b|c) echo bc;; esac");
reparsesClean("function", "foo() { echo hi; bar; }");
reparsesClean("subshell", "(echo a; echo b)");
reparsesClean("brace group", "{ echo a; echo b; }");
reparsesClean("test command", "[[ -f file && $x = y ]]");
reparsesClean("arithmetic", "(( x + 1 ))");
reparsesClean("nested", "if true; then for x in a b; do echo $x; done; fi");
reparsesClean("redirects", "echo hi > file 2>&1");
reparsesClean("background", "sleep 10 &");
reparsesClean("complex", 'if [[ -f "$file" ]]; then cat "$file" | grep pattern > out; else echo missing; fi');
reparsesClean("arithmetic for", "for ((i=0; i<10; i++)); do echo $i; done");
reparsesClean("coproc", "coproc myproc { echo hello; }");

// --- Heredoc body placement ---

// Bash reads a heredoc body from the line after the one holding `<<`, so a redirect nested in
// a pipeline, and-or list, inline subshell or loop/if condition must still flush its body
// before the next line starts.
test("heredoc bodies survive nesting and print where bash expects them", () => {
  for (const [source, expected] of [
    ["cat <<'PY' | tr a-z A-Z\nbody\nPY", "cat << 'PY' | tr a-z A-Z\nbody\nPY"],
    ["cat <<'PY' && echo ok\nbody\nPY", "cat << 'PY' && echo ok\nbody\nPY"],
    ["(cat <<'PY'\nbody\nPY\n)", "(cat << 'PY')\nbody\nPY"],
    ["if cat <<'PY'; then\nbody\nPY\n  echo ran\nfi", "if cat << 'PY'; then\nbody\nPY\n  echo ran\nfi"],
    ["while cat <<'PY'; do\nbody\nPY\n  break\ndone", "while cat << 'PY'; do\nbody\nPY\n  break\ndone"],
    ["until cat <<'PY'; do\nbody\nPY\n  break\ndone", "until cat << 'PY'; do\nbody\nPY\n  break\ndone"],
  ]) {
    assert.equal(fmt(source), expected, source);
  }
});

test("multiple heredocs in one condition keep source order", () => {
  assert.equal(
    fmt("if cat <<'A' && cat <<'B'; then\naaa\nA\nbbb\nB\n  echo ran\nfi"),
    "if cat << 'A' && cat << 'B'; then\naaa\nA\nbbb\nB\n  echo ran\nfi",
  );
});

test("condition and body heredocs each flush at their own line", () => {
  assert.equal(
    fmt("if cat <<'A'; then\naaa\nA\n  cat <<'B'\nbbb\nB\nfi"),
    "if cat << 'A'; then\naaa\nA\n  cat << 'B'\nbbb\nB\nfi",
  );
});

test("heredoc in an elif condition flushes after its then", () => {
  assert.equal(
    fmt("if false; then\n  echo no\nelif cat <<'PY'; then\nbody\nPY\n  echo ran\nfi"),
    "if false; then\n  echo no\nelif cat << 'PY'; then\nbody\nPY\n  echo ran\nfi",
  );
});

// A multi-line compound in the same pipeline pushes the statement onto several lines, but the
// earlier `<<` still sits on the first one; a redirect attached after that compound does not.
test("heredoc bodies flush at the line their redirect prints on", () => {
  assert.equal(
    fmt("cat <<'A' | while read -r l; do echo \"$l\"; done\naaa\nA"),
    "cat << 'A' | while read -r l; do\naaa\nA\n  echo \"$l\"\ndone",
  );
  assert.equal(fmt("cat <<'A' | { cat <<'B'; }\naaa\nA\nbbb\nB"), "cat << 'A' | {\naaa\nA\n  cat << 'B'\nbbb\nB\n}");
  assert.equal(
    fmt("while read -r l; do echo \"$l\"; done <<'A'\naaa\nA"),
    "while read -r l; do\n  echo \"$l\"\ndone << 'A'\naaa\nA",
  );
  assert.equal(
    fmt("cat <<'A' | while read -r l; do echo \"$l\"; done <<'B'\naaa\nA\nbbb\nB"),
    "cat << 'A' | while read -r l; do\naaa\nA\n  echo \"$l\"\ndone << 'B'\nbbb\nB",
  );
});

test("printing is idempotent for nested heredocs", () => {
  for (const source of [
    "cat <<'PY' | tr a-z A-Z\nbody\nPY",
    "if cat <<'PY'; then\nbody\nPY\n  echo ran\nfi",
    "cat <<'A' | while read -r l; do echo \"$l\"; done\naaa\nA",
    "cat <<'A' | while read -r l; do echo \"$l\"; done <<'B'\naaa\nA\nbbb\nB",
  ]) {
    const once = fmt(source);
    assert.equal(print(parse(once)), once, source);
  }
});

// A lazy getter on a consumer-built AST can re-enter print() midway through an outer print.
// The inner call must not consume the outer call's pending heredocs.
test("re-entrant print does not steal pending heredoc bodies", () => {
  const inner = parse("echo nested");
  const outer = parse("cat <<'EOF' | tee f\nbody\nEOF");
  const pipeline = outer.commands[0].command;
  assert.equal(pipeline.type, "Pipeline");
  const second = pipeline.type === "Pipeline" ? (pipeline.commands[1] as { name?: unknown }) : undefined;
  const realName = second!.name;
  Object.defineProperty(second!, "name", {
    configurable: true,
    get() {
      print(inner);
      return realName;
    },
  });

  const printed = print(outer);
  assert.equal(printed, "cat << 'EOF' | tee f\nbody\nEOF");
  assert.ok(!printed.includes(String.fromCharCode(0)), "marker must not leak into output");
});

// Bash accepts a reserved word as a function name only in the `function name` form —
// `if() { …; }` is a syntax error — so the printer cannot always emit the POSIX form.
test("reserved-word function names print with the function keyword", () => {
  const reserved = [
    "if",
    "then",
    "else",
    "elif",
    "fi",
    "do",
    "done",
    "for",
    "while",
    "until",
    "in",
    "case",
    "esac",
    "function",
    "select",
    "coproc",
    "!",
    "{",
    "}",
    "time",
    "[[",
    "]]",
  ];
  for (const name of reserved) {
    const source = `function ${name} { echo shadowed; }`;
    const printed = fmt(source);
    assert.ok(printed.startsWith(`function ${name} {`), `${source} -> ${printed}`);
    assert.equal(parse(printed).errors, undefined, printed);
  }
  // An ordinary name keeps the POSIX form.
  assert.ok(fmt("function f { :; }").startsWith("f() {"));
  assert.ok(fmt("f() { :; }").startsWith("f() {"));
});
