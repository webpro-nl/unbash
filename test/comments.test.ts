import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "../src/parser.ts";
import type { Command, ParsedScript } from "../src/types.ts";

const spans = (src: string, script: ParsedScript = parse(src)) =>
  (script.comments ?? []).map(({ pos, end }) => src.slice(pos, end));

test("comments are reported as source spans in order", () => {
  const src = "# first\necho one # trailing\n\n\t# indented\necho two";
  assert.deepEqual(spans(src), ["# first", "# trailing", "# indented"]);
});

test("a script without comments has no comments field", () => {
  assert.equal(parse("echo one\necho two\n").comments, undefined);
});

test("a comment span ends before the newline, or at end of input", () => {
  const src = "echo a # no newline";
  const [comment] = parse(src).comments!;
  assert.equal(comment.pos, 7);
  assert.equal(comment.end, src.length);
  assert.deepEqual(spans("echo a # crlf\r\necho b"), ["# crlf\r"]);
});

test("a shebang is not a comment", () => {
  const src = "#!/bin/bash\n# real\necho x";
  const script = parse(src);
  assert.equal(script.shebang, "#!/bin/bash");
  assert.deepEqual(spans(src, script), ["# real"]);
});

test("hash inside a word, quotes, or a heredoc body is not a comment", () => {
  const src = "echo a#b \"# not\" '# not' $'# not'\ncat <<EOF\n# not\nEOF\necho ${x#pre} # yes\n";
  assert.deepEqual(spans(src), ["# yes"]);
});

test("comments inside compound commands and array bodies are reported", () => {
  const src = "if true; then # then\n\t:\nfi # fi\nx=(\n a # a\n b\n)\n{ # brace\n:; }\n";
  assert.deepEqual(spans(src), ["# then", "# fi", "# a", "# brace"]);
  assert.equal(parse(src).errors, undefined);
});

test("a comment inside a substitution is on the nested script", () => {
  const src = "echo $(\n# inner\nid\n) # outer\n";
  const script = parse(src);
  assert.deepEqual(spans(src, script), ["# outer"]);
  const cmd = script.commands[0].command as Command;
  const part = cmd.suffix[0].parts!.find((p) => p.type === "CommandExpansion")!;
  assert.equal(part.type, "CommandExpansion");
  assert.deepEqual(spans(src, part.script!), ["# inner"]);
});

test("comments survive error recovery", () => {
  const src = "# before\nfi\n# after\necho x\n";
  const script = parse(src);
  assert.ok(script.errors && script.errors.length > 0);
  assert.deepEqual(spans(src, script), ["# before", "# after"]);
});
