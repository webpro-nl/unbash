import assert from "assert";
import * as parser from "unbash";
import * as printer from "unbash/printer";

assert.deepStrictEqual(Object.keys(parser), ["parse", "parseRegion"]);
assert.deepStrictEqual(Object.keys(printer), ["print"]);

for (const [source, expected] of [
  ['echo "a b"', 'echo "a b"'],
  ["export A=1", "export A=1"],
  ["declare xs=(a b)", "declare xs=(a b)"],
  ["echo ${x:-$(printf hi)}", "echo ${x:-$(printf hi)}"],
  ["! time -p :", "! time -p :"],
  ["for x in; do :; done", "for x in; do\n  :\ndone"],
  ["cat <<'E'\n$HOME\nE", "cat << 'E'\n$HOME\nE"],
  ["echo >a\\'b", "echo > 'a'\\''b'"],
]) {
  const ast = parser.parse(source);
  assert.strictEqual(ast.errors, undefined, source);
  assert.strictEqual(printer.print(ast), expected, source);
  assert.strictEqual(printer.print(JSON.parse(JSON.stringify(ast))), expected, source);
  assert.strictEqual(printer.print(parser.parse(expected)), expected, source);
}

console.log(`Parse, JSON, and print smoke checks passed on ${process.version}`);
