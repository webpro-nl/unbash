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
