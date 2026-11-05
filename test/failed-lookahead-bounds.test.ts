import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "../src/parser.ts";
import { nodeOfType } from "./ast-helpers.ts";

const SIZES = [1024, 4096, 16384, 65536];
const READS_PER_CHAR = 64;

function countReads(source: string): number {
  const charCodeAt = String.prototype.charCodeAt;
  let reads = 0;
  String.prototype.charCodeAt = function (index: number): number {
    reads++;
    return charCodeAt.call(this, index);
  };
  try {
    parse(source);
  } finally {
    String.prototype.charCodeAt = charCodeAt;
  }
  return reads;
}

function wordParts(source: string): (string | undefined)[][] {
  const command = nodeOfType(parse(source).commands[0].command, "Command");
  const word = nodeOfType(command.args[0] ?? command.name, "Word");
  return word.parts!.map((part) => [part.type, "text" in part ? part.text : undefined]);
}

for (const size of SIZES) {
  test(`unmatched braces in a ${size}-byte word are scanned in linear reads`, () => {
    const source = "n" + "{".repeat(size - 1);
    const reads = countReads(source);
    assert.ok(reads <= READS_PER_CHAR * source.length, `${reads} reads for ${source.length} characters`);
  });

  test(`unmatched $[ openers in a ${size}-byte word are scanned in linear reads`, () => {
    const source = "echo " + "$[".repeat(Math.floor((size - 5) / 2));
    const reads = countReads(source);
    assert.ok(reads <= READS_PER_CHAR * source.length, `${reads} reads for ${source.length} characters`);
  });

  test(`unmatched $[ openers with one final ] in a ${size}-byte word are scanned in linear reads`, () => {
    const source = "echo " + "$[".repeat(Math.floor((size - 6) / 2)) + "]";
    const reads = countReads(source);
    assert.ok(reads <= READS_PER_CHAR * source.length, `${reads} reads for ${source.length} characters`);
  });
}

test("an unmatched outer brace keeps a valid inner expansion", () => {
  assert.deepEqual(wordParts("n{{a,b}"), [
    ["Literal", "n{"],
    ["BraceExpansion", "{a,b}"],
  ]);
});

test("a brace expansion after unmatched openers keeps its inner expansion", () => {
  assert.deepEqual(wordParts("n{{{a,b}"), [
    ["Literal", "n{{"],
    ["BraceExpansion", "{a,b}"],
  ]);
});

test("nested $[ expansions parse as a single arithmetic expansion", () => {
  assert.deepEqual(wordParts("echo $[$[1]]"), [["ArithmeticExpansion", "$[$[1]]"]]);
  assert.deepEqual(wordParts("echo $[1+$[2]]x"), [
    ["ArithmeticExpansion", "$[1+$[2]]"],
    ["Literal", "x"],
  ]);
});

test("an unmatched $[ before a valid $[ expansion keeps the inner expansion", () => {
  assert.deepEqual(wordParts("echo $[$[1]"), [
    ["Literal", "$["],
    ["ArithmeticExpansion", "$[1]"],
  ]);
});
