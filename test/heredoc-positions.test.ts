import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "../src/parser.ts";
import type { Command, Redirect } from "../src/types.ts";

const redirects = (src: string): Redirect[] => (parse(src).commands[0].command as Command).redirects;
const body = (src: string, r: Redirect) => src.slice(r.contentPos!, r.contentEnd!);

test("a heredoc body's span slices its content", () => {
  for (const src of [
    "cat <<EOF\nplain\nEOF\n",
    "cat <<'EOF'\n$quoted\nEOF\n",
    "cat <<-EOF\n\tindented\n\tEOF\n",
    "cat <<EOF\nhas $x\nEOF\n",
    "cat <<EOF\nEOF\n",
  ]) {
    const [r] = redirects(src);
    assert.equal(body(src, r), r.content, src);
    assert.equal(r.heredocTerminated, true, src);
  }
});

test("an expanding body's word and span agree", () => {
  const [r] = redirects("cat <<EOF\nhas $x\nEOF\n");
  assert.equal(r.body!.pos, r.contentPos);
  assert.equal(r.body!.end, r.contentEnd);
});

test("two heredocs on one line take consecutive spans", () => {
  const src = "cat <<A <<B\na\nA\nb\nB\n";
  const [a, b] = redirects(src);
  assert.equal(body(src, a), "a\n");
  assert.equal(body(src, b), "b\n");
  assert.equal(b.contentPos, a.contentEnd! + "A\n".length);
});

test("a body ended by end of input is unterminated and runs to the end", () => {
  for (const src of ["cat <<EOF\nnever\n", "cat <<EOF\nnever", "cat <<EOF\n"]) {
    const [r] = redirects(src);
    assert.equal(r.heredocTerminated, false, src);
    assert.equal(r.contentEnd, src.length, src);
    assert.equal(body(src, r), r.content, src);
  }
});

test("an indented, padded, or extended delimiter does not terminate", () => {
  for (const src of ["cat <<EOF\nx\n  EOF\n", "cat <<EOF\nx\nEOF \n", "cat <<EOF\nx\nEOFX\n"]) {
    const [r] = redirects(src);
    assert.equal(r.heredocTerminated, false, src);
    assert.equal(r.contentEnd, src.length, src);
  }
});

test("a heredoc inside a substitution carries its span on the nested script", () => {
  const src = "echo $(cat <<EOF\ninner\nEOF\n)";
  const cmd = parse(src).commands[0].command as Command;
  const part = cmd.suffix[0].parts!.find((p) => p.type === "CommandExpansion")!;
  assert.equal(part.type, "CommandExpansion");
  const inner = part.script!.commands[0].command as Command;
  const [r] = inner.redirects;
  assert.equal(body(src, r), "inner\n");
  assert.equal(r.heredocTerminated, true);
});

test("a redirect that is not a heredoc has no span", () => {
  const [r] = redirects("cat <file");
  assert.equal(r.contentPos, undefined);
  assert.equal(r.contentEnd, undefined);
  assert.equal(r.heredocTerminated, undefined);
});
