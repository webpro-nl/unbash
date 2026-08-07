import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { parse } from "../src/parser.ts";

const fixturesDir = join(import.meta.dirname, "../fixtures/mvdan-sh");
const source = readFileSync(join(fixturesDir, "filetests_test.go"), "utf8");
const snapshot = readFileSync(join(fixturesDir, "filetests_snapshot.txt"), "utf8").split("\n").slice(0, -1); // drop trailing newline
const knownInvalidInputs = new Set([
  "select foo bar",
  "foo |&",
  "foo \\" + "\n\t|&",
  "foo >!a >>|b >>!c &>|d &>!e &>>|f &>>!g",
  "function f1 f2 f3() {\n\ta\n}",
  "function {\n\ta\n}",
  "() {\n\ta\n}",
  "$foo[(r)pattern]",
  "echo *.txt(@)",
  "echo /bin/sh(:t)",
  '@test "desc" { body; }',
  "@test 'desc' {\n\tmultiple\n\tstatements\n}",
  "echo <->",
  "echo <5-10>",
]);

/** Unescape a Go interpreted string literal (without outer quotes). */
function unescapeGo(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && i + 1 < s.length) {
      const c = s[++i];
      switch (c) {
        case "n":
          out += "\n";
          break;
        case "t":
          out += "\t";
          break;
        case "r":
          out += "\r";
          break;
        case "\\":
          out += "\\";
          break;
        case '"':
          out += '"';
          break;
        case "'":
          out += "'";
          break;
        case "a":
          out += "\x07";
          break;
        case "b":
          out += "\b";
          break;
        case "f":
          out += "\f";
          break;
        case "v":
          out += "\v";
          break;
        case "x": {
          out += String.fromCharCode(parseInt(s.slice(i + 1, i + 3), 16));
          i += 2;
          break;
        }
        case "0":
        case "1":
        case "2":
        case "3":
        case "4":
        case "5":
        case "6":
        case "7": {
          out += String.fromCharCode(parseInt(s.slice(i, i + 3), 8));
          i += 2;
          break;
        }
        case "u": {
          out += String.fromCodePoint(parseInt(s.slice(i + 1, i + 5), 16));
          i += 4;
          break;
        }
        case "U": {
          out += String.fromCodePoint(parseInt(s.slice(i + 1, i + 9), 16));
          i += 8;
          break;
        }
        default:
          out += "\\" + c;
      }
    } else {
      out += s[i];
    }
  }
  return out;
}

/** Extract the first (canonical) input from each fileTest([]string{...}, ...) call. */
function extractInputs(go: string): string[] {
  const inputs: string[] = [];
  const re = /\[\]string\{/g;
  let match;
  while ((match = re.exec(go)) !== null) {
    let i = match.index + match[0].length;
    while (i < go.length && go[i] !== "}") {
      if (/[\s,]/.test(go[i])) {
        i++;
        continue;
      }
      if (go[i] === '"') {
        let s = "";
        i++;
        while (i < go.length && go[i] !== '"') {
          if (go[i] === "\\" && i + 1 < go.length) {
            s += go[i] + go[i + 1];
            i += 2;
          } else {
            s += go[i];
            i++;
          }
        }
        i++;
        inputs.push(unescapeGo(s));
        break;
      } else if (go[i] === "`") {
        i++;
        let s = "";
        while (i < go.length && go[i] !== "`") {
          s += go[i];
          i++;
        }
        i++;
        inputs.push(s);
        break;
      } else break;
    }
  }
  return inputs;
}

const inputs = extractInputs(source);

test(`mvdan-sh: extracted ${inputs.length} inputs`, () => {
  assert.ok(inputs.length > 400, `expected >400 inputs, got ${inputs.length}`);
  assert.equal(inputs.length, snapshot.length, "input count must match snapshot");
});

for (let i = 0; i < inputs.length; i++) {
  const input = inputs[i];
  const label = input.length > 60 ? input.slice(0, 60) + "..." : input;

  test(`mvdan-sh #${i}: ${JSON.stringify(label)}`, () => {
    const result = parse(input);
    assert.equal(result.type, "Script");
    assert.ok(Array.isArray(result.commands));

    // No parse errors on valid input (skip known-invalid inputs)
    if (!knownInvalidInputs.has(input)) {
      assert.equal((result as any).errors, undefined, "unexpected parse errors");
    }

    // Snapshot: verify command types match expected
    const types = result.commands.map((c) => c.command.type).join(",");
    assert.equal(types, snapshot[i], `type mismatch at #${i}`);
  });
}
