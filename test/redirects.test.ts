import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "../src/parser.ts";
import type { Command } from "../src/types.ts";
import { computeWordParts } from "../src/parts.ts";

const getCmd = (ast: ReturnType<typeof parse>, i = 0) => ast.commands[i].command as Command;
const wp = (s: string, w: import("../src/types.ts").Word) => computeWordParts(s, w);

// --- Basic redirects ---

test("simple > redirect captured", () => {
  const c = getCmd(parse("echo hello > out.txt"));
  assert.equal(c.name?.text, "echo");
  assert.deepEqual(
    c.suffix.map((s) => s.text),
    ["hello"],
  );
  assert.equal(c.redirects?.length, 1);
  assert.equal(c.redirects![0].operator, ">");
  assert.equal(c.redirects![0].target?.text, "out.txt");
});

test(">> append redirect", () => {
  const c = getCmd(parse("echo x >> log"));
  assert.equal(c.redirects?.length, 1);
  assert.equal(c.redirects![0].operator, ">>");
  assert.equal(c.redirects![0].target?.text, "log");
});

test("< input redirect", () => {
  const c = getCmd(parse("sort < data.txt"));
  assert.equal(c.redirects?.length, 1);
  assert.equal(c.redirects![0].operator, "<");
  assert.equal(c.redirects![0].target?.text, "data.txt");
});

test("multiple redirects on one command", () => {
  const c = getCmd(parse("cmd < in.txt > out.txt 2>&1"));
  assert.equal(c.redirects?.length, 3);
  assert.equal(c.redirects![0].operator, "<");
  assert.equal(c.redirects![1].operator, ">");
  assert.equal(c.redirects![2].operator, ">&");
});

test("redirections not in suffix", () => {
  const c = getCmd(parse("echo hello > out.txt"));
  assert.equal(c.name?.text, "echo");
  assert.deepEqual(
    c.suffix.map((s) => s.text),
    ["hello"],
  );
  assert.equal(c.redirects?.length, 1);
});

test("missing redirect targets do not reuse word state", () => {
  const redirect = getCmd(parse("echo >")).redirects?.[0];
  assert.equal(redirect?.target, undefined);
});

test("redirect-only command keeps its redirects", () => {
  const c = getCmd(parse("< input.txt"));
  assert.equal(c.name, undefined);
  assert.equal(c.prefix.length, 0);
  assert.equal(c.redirects?.length, 1);
  assert.equal(c.redirects![0].operator, "<");
  assert.equal(c.redirects![0].target?.text, "input.txt");

  const t = getCmd(parse("> out.txt"));
  assert.equal(t.redirects?.length, 1);
  assert.equal(t.redirects![0].operator, ">");
  assert.equal(t.redirects![0].target?.text, "out.txt");
});

test("escaped and quoted hashes remain redirect targets", () => {
  for (const source of ["echo >\\#file", "echo >'#file'", 'echo >"#file"']) {
    const ast = parse(source);
    assert.equal(ast.errors, undefined, source);
    assert.equal(getCmd(ast).redirects?.[0].target?.value, "#file", source);
  }
});

// --- &> and &>> redirects ---

test("&> redirect captured", () => {
  const c = getCmd(parse("cmd &> /dev/null"));
  assert.equal(c.redirects?.length, 1);
  assert.equal(c.redirects![0].operator, "&>");
  assert.equal(c.redirects![0].target?.text, "/dev/null");
});

test("&> does not background command", () => {
  const ast = parse("cmd &> /dev/null");
  assert.equal(ast.commands.length, 1);
  assert.equal(getCmd(ast).name?.text, "cmd");
});

test("&>> does not background command", () => {
  const ast = parse("cmd &>> log");
  assert.equal(ast.commands.length, 1);
  assert.equal(getCmd(ast).name?.text, "cmd");
});

// --- FD and varname redirects ---

test("FD redirect 2>&1", () => {
  const c = getCmd(parse("cmd 2>&1"));
  assert.equal(c.redirects?.length, 1);
  assert.equal(c.redirects![0].operator, ">&");
  assert.equal(c.redirects![0].fileDescriptor, 2);
});

test("{fd}>file redirect with varname", () => {
  const c = getCmd(parse("cmd {fd}>out.txt"));
  assert.equal(c.redirects?.length, 1);
  assert.equal(c.redirects![0].operator, ">");
  assert.equal(c.redirects![0].variableName, "fd");
  assert.equal(c.redirects![0].target?.text, "out.txt");
});

test("{fd}<file redirect with varname", () => {
  const c = getCmd(parse("cmd {myfd}<input.txt"));
  assert.equal(c.redirects?.length, 1);
  assert.equal(c.redirects![0].operator, "<");
  assert.equal(c.redirects![0].variableName, "myfd");
  assert.equal(c.redirects![0].target?.text, "input.txt");
});

test("{fd}>>file append redirect with varname", () => {
  const c = getCmd(parse("cmd {fd}>>log.txt"));
  assert.equal(c.redirects?.length, 1);
  assert.equal(c.redirects![0].operator, ">>");
  assert.equal(c.redirects![0].variableName, "fd");
});

test("{fd}>&- close redirect with varname", () => {
  const c = getCmd(parse("cmd {fd}>&-"));
  assert.equal(c.redirects?.length, 1);
  assert.equal(c.redirects![0].operator, ">&");
  assert.equal(c.redirects![0].variableName, "fd");
});

test("multiple fd redirections on one command", () => {
  const c = getCmd(parse("foo >&2 <&0 2>file"));
  assert.ok((c.redirects?.length ?? 0) >= 3);
});

test("exec close file descriptors", () => {
  const ast = parse("exec <&- >&-");
  assert.ok(ast.commands.length > 0);
});

// --- Heredocs ---

test("heredoc body not in suffix", () => {
  const c = getCmd(parse("cat <<EOF\nbody\nEOF"));
  assert.equal(c.name?.text, "cat");
  assert.equal(c.suffix.length, 0);
});

test("heredoc redirect captured with body", () => {
  const c = getCmd(parse("cat << EOF\nhello\nworld\nEOF"));
  assert.equal(c.redirects?.length, 1);
  assert.equal(c.redirects![0].operator, "<<");
  assert.equal(c.redirects![0].target?.text, "EOF");
  assert.equal(c.redirects![0].content, "hello\nworld\n");
});

test("heredoc strip (<<-) captures body", () => {
  const c = getCmd(parse("cat <<-END\n\tindented\nEND"));
  assert.equal(c.redirects![0].operator, "<<-");
  assert.equal(c.redirects![0].content, "\tindented\n");
});

test("heredoc empty delimiter captures body", () => {
  const c = getCmd(parse('cat <<""\nhello\n'));
  assert.equal(c.redirects![0].target?.text, "");
  assert.equal(c.redirects![0].content, "hello\n");
});

test("heredoc with quoted delimiter", () => {
  const ast = parse("cat << 'EOF'\na=$b\nEOF");
  assert.ok(ast.commands.length > 0);
});

test("heredoc with redirect", () => {
  const ast = parse("cat <<EOF > $tmpfile\nhello\nEOF");
  assert.ok(ast.commands.length > 0);
});

test("heredoc in pipeline", () => {
  const ast = parse("one <<EOF | grep two\nthree\nEOF");
  assert.ok(ast.commands.length > 0);
});

test("heredoc in logical expression", () => {
  const ast = parse('cat <<-_EOF_ || die "failed"\n\techo hello\n_EOF_');
  assert.ok(ast.commands.length > 0);
});

test("heredoc piped to next command", () => {
  const ast = parse("cat <<EOF |\n1\n2\n3\nEOF\ntac");
  assert.ok(ast.commands.length > 0);
});

test("nested heredocs", () => {
  const ast = parse("cat <<OUTER\nOuter\n$(cat <<INNER\nInner\nINNER)\nOUTER");
  assert.ok(ast.commands.length > 0);
});

test("multiple heredocs in while loop", () => {
  const ast = parse("while cat <<E1; do cat <<E2; break; done\n1\nE1\n2\nE2");
  assert.ok(ast.commands.length > 0);
});

// --- Herestrings ---

test("herestring consumed", () => {
  const c = getCmd(parse("cmd <<< value"));
  assert.equal(c.name?.text, "cmd");
  assert.equal(c.suffix.length, 0);
  assert.equal(c.redirects?.length, 1);
  assert.equal(c.redirects![0].operator, "<<<");
});

test("herestring redirect captured", () => {
  const c = getCmd(parse("cmd <<< value"));
  assert.equal(c.redirects?.length, 1);
  assert.equal(c.redirects![0].operator, "<<<");
  assert.equal(c.redirects![0].target?.text, "value");
});

test("herestring with double-quoted variable", () => {
  const ast = parse('cat <<<"$ENTRIES"');
  assert.ok(ast.commands.length > 0);
});

test("herestring before command name", () => {
  const ast = parse("<<<string cmd arg");
  assert.ok(ast.commands.length > 0);
});

test("herestring with complex quoting", () => {
  const ast = parse('caddy run --config - <<< \'{"apps":{"http":{"servers":{"srv0":{"listen":[":8003"]}}}}}\'');
  assert.ok(ast.commands.length > 0);
});

// --- Compound command redirects ---

test("brace group with redirect", () => {
  const stmt = parse("{ echo a; } >&2").commands[0];
  assert.equal(stmt.command.type, "BraceGroup");
  assert.equal(stmt.redirects.length, 1);
  assert.equal(stmt.redirects[0].operator, ">&");
});

test("subshell with redirect", () => {
  const stmt = parse("(cmd1) > out.txt").commands[0];
  assert.equal(stmt.command.type, "Subshell");
  assert.equal(stmt.redirects.length, 1);
  assert.equal(stmt.redirects[0].operator, ">");
});

test("function with redirect", () => {
  const fn = parse("function f { echo ok; } 2>&1").commands[0].command as import("../src/types.ts").Function;
  assert.equal(fn.type, "Function");
  assert.equal(fn.redirects.length, 1);
});

test("while loop with input redirect", () => {
  const ast = parse('while IFS= read -r line; do\n    echo "$line"\ndone < input.txt');
  const stmt = ast.commands[0];
  assert.equal(stmt.command.type, "While");
  assert.equal(stmt.redirects.length, 1);
});

// --- Redirect target word parts ---

test("redirect target carries parts for variable expansion", () => {
  const src = "echo hello > $outfile";
  const c = getCmd(parse(src));
  assert.equal(c.redirects![0].target?.text, "$outfile");
  assert.ok(wp(src, c.redirects![0].target!));
  assert.equal(wp(src, c.redirects![0].target!)![0].type, "SimpleExpansion");
});

test("redirect target carries parts for param expansion", () => {
  const src = "echo hello > ${dir}/out.txt";
  const c = getCmd(parse(src));
  assert.equal(wp(src, c.redirects![0].target!)![0].type, "ParameterExpansion");
});

test("redirect target carries parts for command substitution", () => {
  const src = "echo hello > $(mktemp)";
  const c = getCmd(parse(src));
  assert.equal(wp(src, c.redirects![0].target!)![0].type, "CommandExpansion");
  assert.ok((wp(src, c.redirects![0].target!)![0] as any).script);
});

test("redirect target carries parts for quoted string", () => {
  const src = 'echo hello > "out file.txt"';
  const c = getCmd(parse(src));
  assert.equal(wp(src, c.redirects![0].target!)![0].type, "DoubleQuoted");
});

test("herestring target carries parts", () => {
  const src = 'cmd <<< "$value"';
  const c = getCmd(parse(src));
  assert.equal(c.redirects![0].operator, "<<<");
  assert.ok(wp(src, c.redirects![0].target!));
  assert.equal(wp(src, c.redirects![0].target!)![0].type, "DoubleQuoted");
});

test("&> redirect target carries parts", () => {
  const src = "cmd &> $logfile";
  const c = getCmd(parse(src));
  assert.equal(c.redirects![0].operator, "&>");
  assert.ok(wp(src, c.redirects![0].target!));
  assert.equal(wp(src, c.redirects![0].target!)![0].type, "SimpleExpansion");
});

test("plain redirect target has no parts", () => {
  const src = "echo hello > out.txt";
  const c = getCmd(parse(src));
  assert.equal(c.redirects![0].target?.text, "out.txt");
  assert.equal(wp(src, c.redirects![0].target!), undefined);
});

// --- FD number before redirect (tokenizer) ───────────────────────────

test("digit before > becomes fd redirect", () => {
  const c = getCmd(parse("echo 2>/dev/null"));
  assert.equal(c.redirects?.[0].fileDescriptor, 2);
  assert.equal(c.redirects?.[0].operator, ">");
});

test("digit before < becomes fd redirect", () => {
  const c = getCmd(parse("cmd 0<input"));
  assert.equal(c.redirects?.[0].fileDescriptor, 0);
  assert.equal(c.redirects?.[0].operator, "<");
});

test("multi-digit fd", () => {
  const c = getCmd(parse("cmd 10>file"));
  assert.equal(c.redirects?.[0].fileDescriptor, 10);
});

test("a trailing backslash is a literal redirect target", () => {
  // Bash escapes nothing with a backslash at end of input: `>\` writes to a file named `\`.
  const command = parse(">\\").commands[0].command as Command;
  assert.equal(command.redirects.length, 1);
  assert.equal(command.redirects[0].operator, ">");
  assert.equal(command.redirects[0].target?.text, "\\");
  assert.equal(parse(">\\").errors, undefined);

  const read = parse("cat <a\\").commands[0].command as Command;
  assert.equal(read.redirects[0].target?.text, "a\\");

  assert.equal((parse("echo a\\").commands[0].command as Command).suffix[0].text, "a\\");
  assert.equal((parse("cat <<x\\").commands[0].command as Command).redirects[0].target?.text, "x\\");
});
