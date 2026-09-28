import { argumentsOf, nodeOfType, redirectsOf } from "./ast-helpers.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "../src/parser.ts";
import { print } from "../src/printer.ts";
import { computeWordParts } from "../src/parts.ts";

const getCmd = (ast: ReturnType<typeof parse>, i = 0) => nodeOfType(ast.commands[i].command, "Command");
const wp = (s: string, w: import("../src/types.ts").Word) => computeWordParts(s, w);

// --- Basic redirects ---

test("simple > redirect captured", () => {
  const c = getCmd(parse("echo hello > out.txt"));
  assert.equal(c.name?.text, "echo");
  assert.deepEqual(
    argumentsOf(c).map((s) => s.text),
    ["hello"],
  );
  assert.equal(redirectsOf(c)?.length, 1);
  assert.equal(redirectsOf(c)![0].operator, ">");
  assert.equal(nodeOfType(redirectsOf(c)![0], "HereString", "Redirect").target?.text, "out.txt");
});

test(">> append redirect", () => {
  const c = getCmd(parse("echo x >> log"));
  assert.equal(redirectsOf(c)?.length, 1);
  assert.equal(redirectsOf(c)![0].operator, ">>");
  assert.equal(nodeOfType(redirectsOf(c)![0], "HereString", "Redirect").target?.text, "log");
});

test("< input redirect", () => {
  const c = getCmd(parse("sort < data.txt"));
  assert.equal(redirectsOf(c)?.length, 1);
  assert.equal(redirectsOf(c)![0].operator, "<");
  assert.equal(nodeOfType(redirectsOf(c)![0], "HereString", "Redirect").target?.text, "data.txt");
});

test("multiple redirects on one command", () => {
  const c = getCmd(parse("cmd < in.txt > out.txt 2>&1"));
  assert.equal(redirectsOf(c)?.length, 3);
  assert.equal(redirectsOf(c)![0].operator, "<");
  assert.equal(redirectsOf(c)![1].operator, ">");
  assert.equal(redirectsOf(c)![2].operator, ">&");
});

test("redirect items remain distinct from arguments", () => {
  const c = getCmd(parse("echo hello > out.txt"));
  assert.equal(c.name?.text, "echo");
  assert.deepEqual(
    argumentsOf(c).map((s) => s.text),
    ["hello"],
  );
  assert.equal(redirectsOf(c)?.length, 1);
});

test("single-bracket commands stay separate around a redirect (#316)", () => {
  const source = "[ 2 -lt 3 ]\necho >1\n[ ]\n";
  const ast = parse(source);
  assert.equal(ast.errors, undefined);
  assert.deepEqual(
    ast.commands.map(({ command }) => [nodeOfType(command, "Command").name?.text, command.pos, command.end]),
    [
      ["[", 0, 11],
      ["echo", 12, 19],
      ["[", 20, 23],
    ],
  );
  const redirect = nodeOfType(redirectsOf(getCmd(ast, 1))[0], "HereString", "Redirect");
  assert.deepEqual(
    [redirect.operator, redirect.pos, redirect.end, redirect.target?.text, redirect.target?.pos, redirect.target?.end],
    [">", 17, 19, "1", 18, 19],
  );
});

test("missing redirect targets do not reuse word state", () => {
  const redirect = nodeOfType(redirectsOf(getCmd(parse("echo >")))?.[0], "HereString", "Redirect");
  assert.equal(redirect.target, undefined);
});

test("redirect-only command keeps its redirects", () => {
  const c = getCmd(parse("< input.txt"));
  assert.equal(c.name, undefined);
  assert.equal(c.prefix.length, 1);
  assert.equal(redirectsOf(c)?.length, 1);
  assert.equal(redirectsOf(c)![0].operator, "<");
  assert.equal(nodeOfType(redirectsOf(c)![0], "HereString", "Redirect").target?.text, "input.txt");

  const t = getCmd(parse("> out.txt"));
  assert.equal(redirectsOf(t)?.length, 1);
  assert.equal(redirectsOf(t)![0].operator, ">");
  assert.equal(nodeOfType(redirectsOf(t)![0], "HereString", "Redirect").target?.text, "out.txt");
});

test("escaped and quoted hashes remain redirect targets", () => {
  for (const source of ["echo >\\#file", "echo >'#file'", 'echo >"#file"']) {
    const ast = parse(source);
    assert.equal(ast.errors, undefined, source);
    assert.equal(nodeOfType(redirectsOf(getCmd(ast))?.[0], "HereString", "Redirect").target?.value, "#file", source);
  }
});

// --- &> and &>> redirects ---

test("&> redirect captured", () => {
  const c = getCmd(parse("cmd &> /dev/null"));
  assert.equal(redirectsOf(c)?.length, 1);
  assert.equal(redirectsOf(c)![0].operator, "&>");
  assert.equal(nodeOfType(redirectsOf(c)![0], "HereString", "Redirect").target?.text, "/dev/null");
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
  assert.equal(redirectsOf(c)?.length, 1);
  assert.equal(redirectsOf(c)![0].operator, ">&");
  assert.equal(nodeOfType(redirectsOf(c)![0].descriptor, "FileDescriptor").value, 2);
});

test("{fd}>file redirect with varname", () => {
  const c = getCmd(parse("cmd {fd}>out.txt"));
  assert.equal(redirectsOf(c)?.length, 1);
  assert.equal(redirectsOf(c)![0].operator, ">");
  assert.equal(nodeOfType(redirectsOf(c)![0].descriptor, "FileDescriptorVariable").name, "fd");
  assert.equal(nodeOfType(redirectsOf(c)![0], "HereString", "Redirect").target?.text, "out.txt");
});

test("{fd}<file redirect with varname", () => {
  const c = getCmd(parse("cmd {myfd}<input.txt"));
  assert.equal(redirectsOf(c)?.length, 1);
  assert.equal(redirectsOf(c)![0].operator, "<");
  assert.equal(nodeOfType(redirectsOf(c)![0].descriptor, "FileDescriptorVariable").name, "myfd");
  assert.equal(nodeOfType(redirectsOf(c)![0], "HereString", "Redirect").target?.text, "input.txt");
});

test("{fd}>>file append redirect with varname", () => {
  const c = getCmd(parse("cmd {fd}>>log.txt"));
  assert.equal(redirectsOf(c)?.length, 1);
  assert.equal(redirectsOf(c)![0].operator, ">>");
  assert.equal(nodeOfType(redirectsOf(c)![0].descriptor, "FileDescriptorVariable").name, "fd");
});

test("{fd}>&- close redirect with varname", () => {
  const c = getCmd(parse("cmd {fd}>&-"));
  assert.equal(redirectsOf(c)?.length, 1);
  assert.equal(redirectsOf(c)![0].operator, ">&");
  assert.equal(nodeOfType(redirectsOf(c)![0].descriptor, "FileDescriptorVariable").name, "fd");
});

test("array redirect descriptors preserve their source range and printed form", () => {
  const source = "exec {foo[1]}>&-";
  const ast = parse(source);
  const command = getCmd(ast);
  assert.equal(ast.errors, undefined);
  assert.deepEqual(argumentsOf(command), []);
  assert.equal(redirectsOf(command).length, 1);
  const redirect = nodeOfType(redirectsOf(command)[0], "Redirect");
  assert.equal(command.suffix[0], redirect);
  assert.deepEqual(redirect.descriptor, { type: "FileDescriptorVariable", pos: 5, end: 13, name: "foo[1]" });
  assert.deepEqual([redirect.operator, redirect.pos, redirect.end], [">&", 5, 16]);
  assert.deepEqual([redirect.target?.text, redirect.target?.pos, redirect.target?.end], ["-", 15, 16]);
  assert.equal(print(ast), "exec {foo[1]}>&-");
  assert.equal(print(parse(print(ast))), "exec {foo[1]}>&-");
});

test("array redirect descriptors accept arithmetic and nested indexes", () => {
  for (const [source, variableName, printed] of [
    [": {fds[index]}>&-", "fds[index]", ": {fds[index]}>&-"],
    [": {fds[1+2]}<&-", "fds[1+2]", ": {fds[1+2]}<&-"],
    [": {fds[a[0]]}>out", "fds[a[0]]", ": {fds[a[0]]}> out"],
    [": {fds[$i]}>&-", "fds[$i]", ": {fds[$i]}>&-"],
    [": {fds[${i}]}>&-", "fds[${i}]", ": {fds[${i}]}>&-"],
    [": {fds[${i:-]}]}>&-", "fds[${i:-]}]", ": {fds[${i:-]}]}>&-"],
    [": {fds[$((1))]}>&-", "fds[$((1))]", ": {fds[$((1))]}>&-"],
    ["{fds[0]}<input cat", "fds[0]", "{fds[0]}< input cat"],
  ]) {
    const ast = parse(source);
    const command = getCmd(ast);
    assert.equal(ast.errors, undefined, source);
    assert.deepEqual(argumentsOf(command), [], source);
    assert.equal(redirectsOf(command).length, 1, source);
    assert.equal(nodeOfType(redirectsOf(command)[0].descriptor, "FileDescriptorVariable").name, variableName, source);
    assert.equal(print(ast), printed, source);
    assert.equal(print(parse(printed)), printed, source);
  }
});

test("multiple fd redirections on one command", () => {
  const c = getCmd(parse("foo >&2 <&0 2>file"));
  assert.ok((redirectsOf(c)?.length ?? 0) >= 3);
});

test("exec close file descriptors", () => {
  const ast = parse("exec <&- >&-");
  assert.ok(ast.commands.length > 0);
});

// --- Heredocs ---

test("heredoc body is not an argument", () => {
  const c = getCmd(parse("cat <<EOF\nbody\nEOF"));
  assert.equal(c.name?.text, "cat");
  assert.equal(argumentsOf(c).length, 0);
});

test("heredoc redirect captured with body", () => {
  const c = getCmd(parse("cat << EOF\nhello\nworld\nEOF"));
  assert.equal(redirectsOf(c)?.length, 1);
  assert.equal(redirectsOf(c)![0].operator, "<<");
  assert.equal(nodeOfType(redirectsOf(c)![0], "HereDoc").delimiter?.text, "EOF");
  assert.equal(nodeOfType(redirectsOf(c)![0], "HereDoc").body.text, "hello\nworld\n");
});

test("heredoc strip (<<-) captures body", () => {
  const c = getCmd(parse("cat <<-END\n\tindented\nEND"));
  assert.equal(redirectsOf(c)![0].operator, "<<-");
  assert.equal(nodeOfType(redirectsOf(c)![0], "HereDoc").body.text, "\tindented\n");
});

test("heredoc empty delimiter captures body", () => {
  const c = getCmd(parse('cat <<""\nhello\n'));
  assert.equal(nodeOfType(redirectsOf(c)![0], "HereDoc").delimiter?.text, '""');
  assert.equal(nodeOfType(redirectsOf(c)![0], "HereDoc").delimiter?.value, "");
  assert.equal(nodeOfType(redirectsOf(c)![0], "HereDoc").body.text, "hello\n");
});

test("quoted heredoc delimiter preserves raw source text", () => {
  const source = "cat <<'EOF'\n$name\nEOF";
  const redirect = nodeOfType(redirectsOf(getCmd(parse(source)))[0], "HereDoc");
  const delimiter = nodeOfType(redirect.delimiter, "HereDocDelimiter");
  assert.equal(delimiter.text, "'EOF'");
  assert.equal(delimiter.value, "EOF");
  assert.equal(source.slice(delimiter.pos, delimiter.end), delimiter.text);
  assert.equal(delimiter.quoted, true);
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
  assert.equal(argumentsOf(c).length, 0);
  assert.equal(redirectsOf(c)?.length, 1);
  assert.equal(redirectsOf(c)![0].operator, "<<<");
});

test("herestring redirect captured", () => {
  const c = getCmd(parse("cmd <<< value"));
  assert.equal(redirectsOf(c)?.length, 1);
  assert.equal(redirectsOf(c)![0].operator, "<<<");
  assert.equal(nodeOfType(redirectsOf(c)![0], "HereString", "Redirect").target?.text, "value");
});

test("multi-digit fd herestring (#226)", () => {
  const redirect = nodeOfType(redirectsOf(getCmd(parse('cat /dev/fd/10 10<<<"test"')))[0], "HereString", "Redirect");
  assert.deepEqual(
    [nodeOfType(redirect.descriptor, "FileDescriptor").value, redirect.operator, redirect.target?.text],
    [10, "<<<", '"test"'],
  );
});

for (const { issue, source, name, suffix, redirects } of [
  {
    issue: "#232-A",
    source: "cat >x <<< 'x'",
    name: "cat",
    suffix: [],
    redirects: [
      [">", "x", 4, 6, 5, 6],
      ["<<<", "'x'", 7, 14, 11, 14],
    ],
  },
  {
    issue: "#232-C",
    source: "x <<<x x >x",
    name: "x",
    suffix: ["x"],
    redirects: [
      ["<<<", "x", 2, 6, 5, 6],
      [">", "x", 9, 11, 10, 11],
    ],
  },
  {
    issue: "#232-D",
    source: "x <x a b c",
    name: "x",
    suffix: ["a", "b", "c"],
    redirects: [["<", "x", 2, 4, 3, 4]],
  },
  {
    issue: "#282-A",
    source: "rev > output <<< hello",
    name: "rev",
    suffix: [],
    redirects: [
      [">", "output", 4, 12, 6, 12],
      ["<<<", "hello", 13, 22, 17, 22],
    ],
  },
  {
    issue: "#282-B",
    source: "rev <<< hello > output",
    name: "rev",
    suffix: [],
    redirects: [
      ["<<<", "hello", 4, 13, 8, 13],
      [">", "output", 14, 22, 16, 22],
    ],
  },
]) {
  test(`redirect ordering and ranges (${issue})`, () => {
    const ast = parse(source);
    const command = getCmd(ast);
    assert.equal(ast.errors, undefined);
    assert.equal(command.name?.text, name);
    assert.deepEqual(
      argumentsOf(command).map(({ text }) => text),
      suffix,
    );
    assert.deepEqual(
      redirectsOf(command).map((redirect) => {
        const { operator, target, pos, end } = nodeOfType(redirect, "Redirect", "HereString");
        return [operator, target?.text, pos, end, target?.pos, target?.end];
      }),
      redirects,
    );
  });
}

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
  assert.equal(stmt.command.type, "Redirected");
  assert.equal(stmt.command.type === "Redirected" && stmt.command.command.type, "BraceGroup");
  assert.equal(redirectsOf(stmt).length, 1);
  assert.equal(redirectsOf(stmt)[0].operator, ">&");
});

test("subshell with redirect", () => {
  const stmt = parse("(cmd1) > out.txt").commands[0];
  assert.equal(stmt.command.type, "Redirected");
  assert.equal(stmt.command.type === "Redirected" && stmt.command.command.type, "Subshell");
  assert.equal(redirectsOf(stmt).length, 1);
  assert.equal(redirectsOf(stmt)[0].operator, ">");
});

test("function with redirect", () => {
  const fn = nodeOfType(parse("function f { echo ok; } 2>&1").commands[0].command, "Function");
  assert.equal(fn.type, "Function");
  assert.equal(redirectsOf(fn).length, 1);
});

test("while loop with input redirect", () => {
  const ast = parse('while IFS= read -r line; do\n    echo "$line"\ndone < input.txt');
  const stmt = ast.commands[0];
  assert.equal(stmt.command.type, "Redirected");
  assert.equal(stmt.command.type === "Redirected" && stmt.command.command.type, "While");
  assert.equal(redirectsOf(stmt).length, 1);
});

// --- Redirect target word parts ---

test("redirect target carries parts for variable expansion", () => {
  const src = "echo hello > $outfile";
  const c = getCmd(parse(src));
  assert.equal(nodeOfType(redirectsOf(c)![0], "HereString", "Redirect").target?.text, "$outfile");
  assert.ok(wp(src, nodeOfType(redirectsOf(c)![0], "HereString", "Redirect").target!));
  assert.equal(wp(src, nodeOfType(redirectsOf(c)![0], "HereString", "Redirect").target!)![0].type, "SimpleExpansion");
});

test("redirect target carries parts for param expansion", () => {
  const src = "echo hello > ${dir}/out.txt";
  const c = getCmd(parse(src));
  assert.equal(
    wp(src, nodeOfType(redirectsOf(c)![0], "HereString", "Redirect").target!)![0].type,
    "ParameterExpansion",
  );
});

test("redirect target carries parts for command substitution", () => {
  const src = "echo hello > $(mktemp)";
  const c = getCmd(parse(src));
  assert.equal(wp(src, nodeOfType(redirectsOf(c)![0], "HereString", "Redirect").target!)![0].type, "CommandExpansion");
  assert.ok((wp(src, nodeOfType(redirectsOf(c)![0], "HereString", "Redirect").target!)![0] as any).script);
});

test("redirect target carries parts for quoted string", () => {
  const src = 'echo hello > "out file.txt"';
  const c = getCmd(parse(src));
  assert.equal(wp(src, nodeOfType(redirectsOf(c)![0], "HereString", "Redirect").target!)![0].type, "DoubleQuoted");
});

test("redirect target preserves raw source text", () => {
  const source = 'echo > "file name"';
  const target = nodeOfType(redirectsOf(getCmd(parse(source)))[0], "HereString", "Redirect").target;
  assert.ok(target);
  assert.equal(target.text, '"file name"');
  assert.equal(target.value, "file name");
  assert.equal(source.slice(target.pos, target.end), target.text);
});

test("herestring target carries parts", () => {
  const src = 'cmd <<< "$value"';
  const c = getCmd(parse(src));
  assert.equal(redirectsOf(c)![0].operator, "<<<");
  assert.ok(wp(src, nodeOfType(redirectsOf(c)![0], "HereString", "Redirect").target!));
  assert.equal(wp(src, nodeOfType(redirectsOf(c)![0], "HereString", "Redirect").target!)![0].type, "DoubleQuoted");
});

test("&> redirect target carries parts", () => {
  const src = "cmd &> $logfile";
  const c = getCmd(parse(src));
  assert.equal(redirectsOf(c)![0].operator, "&>");
  assert.ok(wp(src, nodeOfType(redirectsOf(c)![0], "HereString", "Redirect").target!));
  assert.equal(wp(src, nodeOfType(redirectsOf(c)![0], "HereString", "Redirect").target!)![0].type, "SimpleExpansion");
});

test("plain redirect target has no parts", () => {
  const src = "echo hello > out.txt";
  const c = getCmd(parse(src));
  assert.equal(nodeOfType(redirectsOf(c)![0], "HereString", "Redirect").target?.text, "out.txt");
  assert.equal(wp(src, nodeOfType(redirectsOf(c)![0], "HereString", "Redirect").target!), undefined);
});

// --- FD number before redirect (tokenizer) ───────────────────────────

test("digit before > becomes fd redirect", () => {
  const c = getCmd(parse("echo 2>/dev/null"));
  assert.equal(nodeOfType(redirectsOf(c)?.[0].descriptor, "FileDescriptor").value, 2);
  assert.equal(redirectsOf(c)?.[0].operator, ">");
});

test("digit before < becomes fd redirect", () => {
  const c = getCmd(parse("cmd 0<input"));
  assert.equal(nodeOfType(redirectsOf(c)?.[0].descriptor, "FileDescriptor").value, 0);
  assert.equal(redirectsOf(c)?.[0].operator, "<");
});

test("multi-digit fd", () => {
  const c = getCmd(parse("cmd 10>file"));
  assert.equal(nodeOfType(redirectsOf(c)?.[0].descriptor, "FileDescriptor").value, 10);
});

test("a trailing backslash is a literal redirect target", () => {
  // Bash escapes nothing with a backslash at end of input: `>\` writes to a file named `\`.
  const command = nodeOfType(parse(">\\").commands[0].command, "Command");
  assert.equal(redirectsOf(command).length, 1);
  assert.equal(redirectsOf(command)[0].operator, ">");
  assert.equal(nodeOfType(redirectsOf(command)[0], "HereString", "Redirect").target?.text, "\\");
  assert.equal(parse(">\\").errors, undefined);

  const read = nodeOfType(parse("cat <a\\").commands[0].command, "Command");
  assert.equal(nodeOfType(redirectsOf(read)[0], "HereString", "Redirect").target?.text, "a\\");

  assert.equal(
    nodeOfType(nodeOfType(parse("echo a\\").commands[0].command, "Command").suffix[0], "Assignment", "Word").text,
    "a\\",
  );
  const heredoc = redirectsOf(nodeOfType(parse("cat <<x\\").commands[0].command, "Command"))[0];
  assert.ok(heredoc.type === "HereDoc");
  assert.equal(heredoc.delimiter?.text, "x\\");
});

test("redirect descriptors require unquoted digits or a valid variable reference", () => {
  for (const [source, words, printed] of [
    ["echo x {1v}>out", ["x", "{1v}"], "echo x {1v} > out"],
    ["echo x {v-w}>out", ["x", "{v-w}"], "echo x {v-w} > out"],
    ['echo x "2">out', ["x", '"2"'], 'echo x "2" > out'],
    ['echo x "{fd}">out', ["x", '"{fd}"'], 'echo x "{fd}" > out'],
    ["echo x {f\\d}>out", ["x", "{f\\d}"], "echo x {f\\d} > out"],
    ["echo x {1fds[1]}>out", ["x", "{1fds[1]}"], "echo x {1fds[1]} > out"],
    ["echo x {fds[]}>out", ["x", "{fds[]}"], "echo x {fds[]} > out"],
    ["echo x {fds[1]x}>out", ["x", "{fds[1]x}"], "echo x {fds[1]x} > out"],
    ["echo x {fds[1][2]}>out", ["x", "{fds[1][2]}"], "echo x {fds[1][2]} > out"],
    ["echo x {fds[[1]}>out", ["x", "{fds[[1]}"], "echo x {fds[[1]} > out"],
    ["echo x {fds[1]]}>out", ["x", "{fds[1]]}"], "echo x {fds[1]]} > out"],
    ['echo x "{fds[1]}">out', ["x", '"{fds[1]}"'], 'echo x "{fds[1]}" > out'],
    ["echo x {_a1}>out", ["x"], "echo x {_a1}> out"],
    ["echo x 2>out", ["x"], "echo x 2> out"],
  ] as const) {
    const ast = parse(source);
    const command = getCmd(ast);
    assert.deepEqual(
      argumentsOf(command).map((word) => word.text),
      words,
      source,
    );
    const redirects = redirectsOf(command);
    assert.equal(redirects.length, 1, source);
    assert.equal(nodeOfType(redirects[0], "Redirect").target?.text, "out", source);
    assert.equal(print(ast), printed, source);
    assert.equal(ast.errors, undefined, source);
  }
});
