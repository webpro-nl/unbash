import { nodeOfType } from "./ast-helpers.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "../src/parser.ts";
import { print } from "../src/printer.ts";

const commandOf = (source: string) => nodeOfType(parse(source).commands[0].command, "Command");
const sliceOf = (source: string, node: { pos: number; end: number }) => source.slice(node.pos, node.end);

const sources = [
  "A=1 >out B=2 export C=3 2>&1 D=4 arg",
  "echo one >out two 2>&1 three",
  "echo a b",
  "A=1 >out",
  "cat <<EOF\nx\nEOF\n",
];

test("args keep suffix words and assignments, redirects follow prefix then suffix order", () => {
  const source = "A=1 >out B=2 export C=3 2>&1 D=4 arg";
  const command = commandOf(source);
  assert.deepEqual(
    command.args.map((item) => item.text),
    ["C=3", "D=4", "arg"],
  );
  assert.deepEqual(
    command.args.map((item) => item.type),
    ["Assignment", "Assignment", "Word"],
  );
  assert.deepEqual(
    command.redirects.map((item) => item.type),
    ["Redirect", "Redirect"],
  );
  assert.deepEqual(
    command.redirects.map((item) => sliceOf(source, item)),
    [">out", "2>&1"],
  );
});

test("views exclude the command name and are cached", () => {
  const command = commandOf("echo one >out two 2>&1 three");
  assert.deepEqual(
    command.args.map((item) => item.text),
    ["one", "two", "three"],
  );
  assert.equal(command.redirects.length, 2);
  assert.equal(command.args, command.args);
  assert.equal(command.redirects, command.redirects);
});

test("commands without redirections have an empty redirects view", () => {
  const command = commandOf("echo a b");
  assert.equal(command.args.length, 2);
  assert.equal(command.redirects.length, 0);
});

test("nameless and heredoc commands expose their redirections", () => {
  const nameless = commandOf("A=1 >out");
  assert.equal(nameless.name, undefined);
  assert.deepEqual(nameless.args, []);
  assert.deepEqual(
    nameless.redirects.map((item) => item.type),
    ["Redirect"],
  );
  const heredoc = commandOf("cat <<EOF\nx\nEOF\n");
  assert.equal(heredoc.redirects[0].type, "HereDoc");
});

test("views are not enumerable and do not change JSON output", () => {
  const command = commandOf("echo a >b");
  assert.deepEqual(Object.keys(command), ["type", "pos", "end", "name", "prefix", "suffix"]);
  const revived = JSON.parse(JSON.stringify(command));
  assert.equal("args" in revived, false);
  assert.equal("redirects" in revived, false);
  assert.equal(
    JSON.stringify(parse("echo a >b")),
    '{"type":"Script","pos":0,"end":9,"commands":[{"type":"Statement","pos":0,"end":9,"command":{"type":"Command","pos":0,"end":9,"name":{"type":"Word","text":"echo","pos":0,"end":4,"value":"echo"},"prefix":[],"suffix":[{"type":"Word","text":"a","pos":5,"end":6,"value":"a"},{"type":"Redirect","pos":7,"end":9,"operator":">","target":{"type":"Word","text":"b","pos":8,"end":9,"value":"b"}}]}}]}',
  );
  assert.equal(
    JSON.stringify(parse("A=1 >out")),
    '{"type":"Script","pos":0,"end":8,"commands":[{"type":"Statement","pos":0,"end":8,"command":{"type":"Command","pos":0,"end":8,"prefix":[{"type":"Assignment","pos":0,"end":3,"text":"A=1","name":"A","value":{"type":"Word","text":"1","pos":2,"end":3,"value":"1"}},{"type":"Redirect","pos":4,"end":8,"operator":">","target":{"type":"Word","text":"out","pos":5,"end":8,"value":"out"}}],"suffix":[]}}]}',
  );
});

test("printing survives a JSON round trip", () => {
  for (const source of sources) {
    const ast = parse(source);
    assert.equal(print(JSON.parse(JSON.stringify(ast))), print(ast), source);
  }
});
