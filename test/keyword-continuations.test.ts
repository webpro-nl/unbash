import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { Lexer, LexContext, Token } from "../src/lexer.ts";
import { forEachChild, parse } from "../src/parser.ts";
import { print } from "../src/printer.ts";
import { nodeOfType } from "./ast-helpers.ts";

const continuation = "\\\n";
const splice = (word: string, count: number) => word[0] + continuation.repeat(count) + word.slice(1);

function bash(source: string, syntax = false) {
  const result = spawnSync("bash", ["--noprofile", "--norc", ...(syntax ? ["-n"] : []), "-c", source], {
    encoding: "utf8",
    timeout: 3000,
    env: { PATH: process.env.PATH, LC_ALL: "C" },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr + source);
  return result.stdout;
}

for (const count of [0, 1, 6, 7, 8, 32]) {
  test(`reserved words retain physical spans with ${count} continuations`, () => {
    for (const [word, expected] of [
      ["if", Token.If],
      ["then", Token.Then],
      ["else", Token.Else],
      ["elif", Token.Elif],
      ["fi", Token.Fi],
      ["do", Token.Do],
      ["done", Token.Done],
      ["for", Token.For],
      ["while", Token.While],
      ["until", Token.Until],
      ["case", Token.Case],
      ["esac", Token.Esac],
      ["in", Token.In],
      ["function", Token.Function],
      ["select", Token.Select],
      ["coproc", Token.Coproc],
      ["!", Token.Bang],
      ["{", Token.LBrace],
      ["}", Token.RBrace],
      ["[[", Token.DblLBracket],
      ["]]", Token.DblRBracket],
    ] as const) {
      const spelling = splice(word, count);
      const lexer = new Lexer("  " + spelling + " next");
      const token = lexer.next(LexContext.CommandStart);
      assert.equal(token.token, expected, spelling);
      assert.equal(token.value, word);
      assert.equal(token.pos, 2);
      assert.equal(token.end, 2 + spelling.length);
      assert.equal(lexer.next().value, "next");
    }
  });

  test(`parser, visitor, printer and Bash agree with ${count} continuations`, () => {
    const k = (word: string) => splice(word, count);
    const examples = [
      [
        `${k("if")} true; ${k("then")} printf ok; ${k("elif")} false; ${k("then")} printf bad; ${k("else")} printf bad; ${k("fi")}`,
        "ok",
      ],
      [`${k("for")} x ${k("in")} a b; ${k("do")} printf %s "$x"; ${k("done")}`, "ab"],
      [`${k("while")} false; ${k("do")} :; ${k("done")}; ${k("until")} true; ${k("do")} :; ${k("done")}`, ""],
      [`${k("case")} x ${k("in")} x) printf ok;; ${k("esac")}`, "ok"],
      [`${k("function")} f() ${k("{")} printf ok; ${k("}")}; f`, "ok"],
      [`${k("[[")} x == x ${k("]]")} && printf ok`, "ok"],
      [`${k("!")} false && printf ok`, "ok"],
    ];
    for (const [source, expected] of examples) {
      bash(source, true);
      assert.equal(bash(source), expected);
      const ast = parse(source);
      assert.equal(ast.errors, undefined, source);
      const printed = print(ast);
      bash(printed, true);
      assert.equal(bash(printed), expected);
      const reparsed = parse(printed);
      assert.equal(reparsed.errors, undefined);
      assert.equal(print(reparsed), printed);
      const names: string[] = [];
      const visit = (node: Parameters<typeof forEachChild>[0]) => {
        if (node.type === "Command" && node.name) names.push(node.name.value);
        forEachChild(node, visit);
      };
      visit(ast);
      assert.ok(names.length > 0);
      assert.ok(!names.includes("if") && !names.includes("then"));
    }
  });
}

test("multiple separated removals retain downstream command offsets", () => {
  const source = `# prefix\ni${continuation.repeat(8)}f true; t${continuation.repeat(4)}h${continuation.repeat(5)}en printf ok; f${continuation.repeat(9)}i; printf after`;
  const ast = parse(source);
  assert.equal(ast.errors, undefined);
  assert.equal(ast.commands[0].command.type, "If");
  assert.equal(ast.commands[0].command.pos, source.indexOf("i\\"));
  const after = nodeOfType(ast.commands[1].command, "Command");
  assert.equal(after.name?.pos, source.lastIndexOf("printf"));
  assert.equal(after.name?.end, source.lastIndexOf("printf") + 6);
  assert.equal(after.args[0].value, "after");
  assert.equal(after.args[0].end, source.length);
  assert.equal(bash(source), "okafter");
  assert.equal(bash(print(ast)), "okafter");
});

test("quoted and expanded spellings remain ineligible commands", () => {
  const c = continuation.repeat(9);
  for (const source of [
    `'i${c}f'`,
    `"i${c}f"`,
    `i${c}'f'`,
    `i${c}\\f`,
    `$'if'${c}`,
    `$"if"${c}`,
    `i${c}$x`,
    `i${c}$(printf f)`,
    `i${c}\`printf f\``,
  ]) {
    const token = new Lexer(source).next(LexContext.CommandStart);
    assert.equal(token.token, Token.Word, source);
    assert.equal(token.keywordEligible, false, source);
    const ast = parse(source + " arg; printf after");
    assert.equal(ast.errors, undefined, source);
    const command = nodeOfType(ast.commands[0].command, "Command");
    assert.equal(command.name?.text, source);
    assert.equal(command.name?.end, source.length);
    assert.equal(nodeOfType(ast.commands[1].command, "Command").name?.value, "printf");
    assert.equal(parse(print(ast)).errors, undefined);
  }
});

test("ordinary long words and keyword-ineligible contexts remain words", () => {
  for (const word of ["ifxxxxxxxxxxxxxxxxx", "toString", "valueOf", "constructor"]) {
    for (const source of [word, splice(word, 12)]) {
      const token = new Lexer(source).next(LexContext.CommandStart);
      assert.equal(token.token, Token.Word);
      assert.equal(token.value, word);
      assert.equal(token.keywordEligible, true);
      assert.equal(nodeOfType(parse(source).commands[0].command, "Command").name?.value, word);
    }
  }
  const source = splice("if", 12);
  for (const context of [
    LexContext.Normal,
    LexContext.CommandPrefix,
    LexContext.FunctionName,
    LexContext.CasePattern,
    LexContext.TestMode,
  ]) {
    const token = new Lexer(source).next(context);
    assert.equal(token.token, Token.Word);
    assert.equal(token.value, "if");
    assert.equal(token.keywordEligible, true);
  }
  const ast = parse(`printf '%s' ${source}`);
  assert.equal(ast.errors, undefined);
  assert.equal(nodeOfType(ast.commands[0].command, "Command").args[1].value, "if");
  assert.equal(bash(print(ast)), "if");
  assert.equal(new Lexer(splice("]]", 12)).next(LexContext.TestMode).token, Token.DblRBracket);
  assert.equal(new Lexer(splice("esac", 12)).next(LexContext.CasePattern).token, Token.Esac);
});

test("literal quoting preserves values independently of continuation removal", () => {
  const c = continuation.repeat(12);
  for (const [word, value] of [
    [`'i${c}f'`, `i${c}f`],
    [`"i${c}f"`, "if"],
    [`i${c}'f'`, "if"],
    [`i${c}\\f`, "if"],
    [`$'if'${c}`, "if"],
    [`$"if"${c}`, "if"],
  ]) {
    const source = `printf '%s' ${word}`;
    const ast = parse(source);
    assert.equal(ast.errors, undefined);
    const argument = nodeOfType(ast.commands[0].command, "Command").args[1];
    assert.equal(argument.value, value);
    assert.equal(argument.text, word);
    assert.equal(argument.pos, source.indexOf(word));
    assert.equal(argument.end, source.length);
    bash(source, true);
    assert.equal(bash(source), value);
    const printed = print(ast);
    bash(printed, true);
    assert.equal(bash(printed), value);
  }
});
