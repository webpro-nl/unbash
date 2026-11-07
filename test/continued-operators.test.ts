import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Lexer, Token } from "../src/lexer.ts";
import { parse } from "../src/parser.ts";
import { print } from "../src/printer.ts";
import { verify } from "./verify.ts";

const continuation = "\\\n";
const cases = [
  { op: "&&", token: Token.And, script: "false @ printf wrong", stdout: "", status: 1 },
  { op: "||", token: Token.Or, script: "false @ printf recovered", stdout: "recovered" },
  { op: "|&", token: Token.Pipe, script: "{ printf out; printf err >&2; } @ cat", stdout: "outerr", modern: true },
  { op: ";;", token: Token.DoubleSemi, script: "case x in x) printf a @ x) printf b ;; esac", stdout: "a" },
  { op: ";&", token: Token.SemiAmp, script: "case x in x) printf a @ y) printf b ;; esac", stdout: "ab", modern: true },
  {
    op: ";;&",
    token: Token.DoubleSemiAmp,
    script: "case x in x) printf a @ x) printf b ;; esac",
    stdout: "ab",
    modern: true,
  },
  {
    op: "&>",
    token: Token.Redirect,
    script: "printf old > output; { printf out; printf err >&2; } @ output; cat output",
    stdout: "outerr",
  },
  {
    op: "&>>",
    token: Token.Redirect,
    script: "printf old > output; { printf out; printf err >&2; } @ output; cat output",
    stdout: "oldouterr",
    modern: true,
  },
  { op: ">>", token: Token.Redirect, script: "printf old > output; printf new @ output; cat output", stdout: "oldnew" },
  {
    op: ">|",
    token: Token.Redirect,
    script: "set -C; printf old > output; printf new @ output; cat output",
    stdout: "new",
  },
  { op: ">&", token: Token.Redirect, script: "printf payload @ 1", stdout: "payload" },
  { op: "<&", token: Token.Redirect, script: "cat @ 0; printf kept", stdout: "kept" },
  { op: "<>", token: Token.Redirect, script: "cat @ /dev/null; printf kept", stdout: "kept" },
  { op: "<<", token: Token.Redirect, script: "cat @ EOF\npayload\nEOF\n", stdout: "payload\n" },
  { op: "<<-", token: Token.Redirect, script: "cat @ EOF\n\tpayload\n\tEOF\n", stdout: "payload\n" },
  { op: "<<<", token: Token.Redirect, script: "cat @ payload", stdout: "payload\n" },
];

function variants(op: string): string[] {
  return [
    ...new Set([
      op,
      ...Array.from({ length: op.length - 1 }, (_, i) => op.slice(0, i + 1) + continuation + op.slice(i + 1)),
      [...op].join(continuation.repeat(2)),
    ]),
  ];
}

function bash(source: string, syntax = false) {
  const directory = mkdtempSync(join(tmpdir(), "unbash-continued-operators-"));
  try {
    const result = spawnSync("bash", ["--noprofile", "--norc", ...(syntax ? ["-n"] : []), "-c", source], {
      cwd: directory,
      input: "",
      encoding: "utf8",
      timeout: 5_000,
      env: { PATH: process.env.PATH, LC_ALL: "C" },
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const bashMajor = Number(bash('printf "%s" "$BASH_VERSINFO"').stdout);

for (const fixture of cases) {
  for (const operator of variants(fixture.op)) {
    const label = JSON.stringify(operator);
    test(`continued operator ${label} preserves token identity and physical offsets`, () => {
      const redirect = fixture.token === Token.Redirect;
      const source = `cmd ${operator}${redirect ? " target" : " next"}`;
      const lexer = new Lexer(source);
      assert.equal(lexer.next().value, "cmd");
      const token = lexer.next();
      assert.equal(token.token, fixture.token);
      assert.equal(token.value, fixture.op);
      assert.equal(token.pos, 4);
      assert.equal(token.end, redirect ? source.length : 4 + operator.length);
      assert.equal(source.slice(token.pos, token.end), operator + (redirect ? " target" : ""));
      if (redirect) {
        assert.equal(token.content, "target");
        assert.equal(token.targetPos, 5 + operator.length);
        assert.equal(token.targetEnd, source.length);
      } else {
        const following = lexer.next();
        assert.equal(following.value, "next");
        assert.equal(following.pos, 5 + operator.length);
      }
    });

    test(`continued operator ${label} survives parse-print-parse`, () => {
      const source = fixture.script.replace("@", operator);
      const canonical = fixture.script.replace("@", fixture.op);
      const ast = parse(source);
      assert.equal(ast.errors, undefined, source);
      assert.equal(verify(source, ast), source);
      const printed = print(ast);
      assert.equal(printed, print(parse(canonical)));
      const reparsed = parse(printed);
      assert.equal(reparsed.errors, undefined, printed);
      assert.equal(print(reparsed), printed);
    });

    test(`continued operator ${label} agrees with Bash syntax and behavior`, (t) => {
      if (fixture.modern && bashMajor < 4) {
        t.skip(`Bash ${bashMajor} does not support ${fixture.op}`);
        return;
      }
      const source = fixture.script.replace("@", operator);
      const canonical = fixture.script.replace("@", fixture.op);
      const expected = { status: fixture.status ?? 0, stdout: fixture.stdout, stderr: "" };
      assert.deepEqual(bash(canonical), expected);
      for (const script of [source, print(parse(source)), print(parse(print(parse(source))))]) {
        assert.deepEqual(bash(script, true), { status: 0, stdout: "", stderr: "" });
        assert.deepEqual(bash(script), expected);
      }
    });
  }
}

test("operator lookahead does not consume whitespace, comments, or escaped backslashes", () => {
  for (const separator of [" ", "\t", "\n", " # comment\n", continuation + " ", "\\\\\n"]) {
    for (const [first, token] of [
      ["&", Token.Amp],
      ["|", Token.Pipe],
      [";", Token.Semi],
    ] as const) {
      const actual = new Lexer(first + separator + first).next();
      assert.equal(actual.token, token);
      assert.equal(actual.value, first);
      assert.equal(actual.pos, 0);
      assert.equal(actual.end, 1);
    }
  }
});

test("continued redirects retain quoted, escaped, and expanded targets", () => {
  for (const target of [
    "'out file'",
    '"out file"',
    "out\\ file",
    "out" + continuation + "file",
    '"$(printf output)"',
  ]) {
    for (const op of ["&>", "&>>", ">>"]) {
      const operator = [...op].join(continuation);
      const source = `printf payload ${operator} ${target}`;
      const canonical = `printf payload ${op} ${target}`;
      const ast = parse(source);
      assert.equal(ast.errors, undefined);
      assert.equal(verify(source, ast), source);
      assert.equal(print(ast), print(parse(canonical)));
      assert.equal(print(parse(print(ast))), print(ast));
      if (op !== "&>>" || bashMajor >= 4) assert.deepEqual(bash(source), bash(canonical));
    }
  }
});

test("ordinary process substitutions and quoted operator characters retain their meaning", () => {
  for (const source of [
    "cat < <(printf payload)",
    "printf payload > >(cat)",
    "printf '%s' '&" + continuation + "&'",
    'printf "%s" "&' + continuation + '&"',
    "printf '%s' \\&\\&",
    "true &" + continuation + "& printf payload",
  ]) {
    const ast = parse(source);
    assert.equal(ast.errors, undefined, source);
    assert.equal(verify(source, ast), source);
    const printed = print(ast);
    assert.equal(parse(printed).errors, undefined);
    assert.equal(print(parse(printed)), printed);
    assert.deepEqual(bash(printed, true), { status: 0, stdout: "", stderr: "" });
    assert.deepEqual(bash(printed), bash(source));
  }
});
