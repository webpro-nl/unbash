import assert from "node:assert/strict";
import test from "node:test";
import * as parser from "../src/parser.ts";
import * as printer from "../src/printer.ts";

test("public entry points expose parser and printer exports", () => {
  assert.deepEqual(Object.keys(parser), ["parse", "parseRegion"]);
  assert.deepEqual(Object.keys(printer), ["print"]);
  assert.equal(printer.print(parser.parse("echo hello")), "echo hello");
});
