import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "../src/parser.ts";
import type { Command } from "../src/types.ts";

const getCmd = (ast: ReturnType<typeof parse>, i = 0) => ast.commands[i].command as Command;
const args = (c: Command) => c.suffix.map((s) => s.text);

// ── Commands ──────────────────────────────────────────────────────────

test("simple command", () => {
  const c = getCmd(parse("echo hello"));
  assert.equal(c.name?.text, "echo");
  assert.deepEqual(args(c), ["hello"]);
});

test("command with flags", () => {
  const c = getCmd(parse("program -short --long args"));
  assert.equal(c.name?.text, "program");
  assert.deepEqual(args(c), ["-short", "--long", "args"]);
});

test("shebang skipped", () => {
  const ast = parse("#!/bin/sh\necho hello");
  assert.equal(ast.commands.length, 1);
  assert.equal(getCmd(ast).name?.text, "echo");
});

// ── Separators ────────────────────────────────────────────────────────

test("semicolons separate commands", () => {
  const ast = parse("cmd1; cmd2; cmd3");
  assert.equal(ast.commands.length, 3);
});

test("newlines separate commands", () => {
  const ast = parse("cmd1\ncmd2");
  assert.equal(ast.commands.length, 2);
});

test("double-dash preserved in suffix", () => {
  const c = getCmd(parse("exec -y -- program2"));
  assert.equal(c.name?.text, "exec");
  assert.ok(args(c).includes("--"));
});

// ── Miscellaneous ────────────────────────────────────────────────────

test("set and trap commands", () => {
  const ast = parse('set +e\ntrap cleanup EXIT\ntrap "echo interrupted" INT TERM\nset -e');
  assert.equal(ast.commands.length, 4);
});

// Command names that collide with Object.prototype members must not be mistaken
// for reserved words by the keyword lookup.
test("Object.prototype member names are ordinary command names", () => {
  for (const name of ["toString", "valueOf", "constructor", "hasOwnProperty", "__proto__", "isPrototypeOf"]) {
    const ast = parse(`${name} arg`);
    assert.equal(ast.commands.length, 1, `no command for: ${name}`);
    assert.equal(getCmd(ast).name?.text, name);
    assert.deepEqual(args(getCmd(ast)), ["arg"]);
  }
});

test("Object.prototype member name does not truncate the rest of the script", () => {
  const ast = parse("echo hi; toString foo; echo bye");
  assert.equal(ast.commands.length, 3);
  assert.equal(getCmd(ast, 2).name?.text, "echo");
});

// ── Real-world patterns ─────────────────────────────────────────────

test("real-world scripts parse without errors", () => {
  const scripts = [
    "curl -fsSL https://get.pnpm.io/install.sh | SHELL=`which bash` bash -",
    "find smoke/docs -type d -mindepth 1 -maxdepth 1 -exec rm -rf {} +",
    "find . -name '*.txt' | xargs -I {} sh -c 'echo Processing {}; cat {}'",
    "echo '$JSON' | jq -e '.[] | select(.name == \"pkg\")' > /dev/null",
    'git diff --quiet || git commit -anm "release: $VERSION"',
    'if [ -f .changeset/pre.json ]; then\n    pre=$(jq -r ".tag" .changeset/pre.json)\n    echo "value=$pre" >> $GITHUB_OUTPUT\nfi',
    "docker exec postgres-postgres-1 bash -c 'pg_dumpall -U postgres -s' > schema-before",
    "biome ci --formatter-enabled=false --reporter=github && eslint . --concurrency=auto && knip",
    "changeset version && node ./scripts/deps/update-example-versions.js && pnpm install --no-frozen-lockfile",
    'turbo run build --filter=astro --filter=create-astro --filter="@astrojs/*"',
    'pnpm exec "cat package.json | jq -r \'\\\"\\\\(.name)@\\\\(.version)\\\"\'" | sort',
    "cat file | grep pattern | sort -u | tee output.txt | wc -l > count.txt",
    'declare -A map\nmap[key]="value"\necho "${map[key]}"',
  ];
  for (const script of scripts) {
    const ast = parse(script);
    assert.equal(ast.type, "Script", `Failed: ${script.slice(0, 60)}`);
    assert.ok(ast.commands.length > 0, `No commands: ${script.slice(0, 60)}`);
  }
});
