import {
  parse,
  type AndOr,
  type ArrayValue,
  type ArithmeticWord,
  type Assignment,
  type BraceExpansionPart,
  type Command,
  type CommandArgument,
  type CommandNode,
  type CompoundList,
  type Coproc,
  type ExtendedGlobPart,
  type Function,
  type HereDoc,
  type ParameterOperation,
  type ParsedScript,
  type Pipeline,
  type PipelineNode,
  type Redirection,
  type Statement,
  type SyntaxNode,
  type Time,
  type Word,
} from "unbash";
import { print } from "unbash/printer";

const script = parse("echo ${name:-value}");
const output: string = print(script);
void output;

export const parseInput = (source: string) => parse(source);
export const parsed = parse("echo");
export const statementsOf = (source: string) => parse(source).commands;
export const firstCommand = (source: string) => parse(source).commands[0]?.command;
export const firstWord = (source: string) => {
  const command = firstCommand(source);
  return command?.type === "Command" ? command.name : undefined;
};
export const argumentsOf = (command: Command) => command.suffix.filter((item) => item.type === "Word");
export const partsOf = (word: Word) => word.parts;

if ("errors" in script) {
  // @ts-expect-error present error fields can contain undefined
  void script.errors.length;
}

// @ts-expect-error root fields are readonly
script.end = 0;
// @ts-expect-error statement collections are readonly
script.commands.push(script.commands[0]);
// @ts-expect-error nested syntax fields are readonly
script.commands[0].command.end = 0;
// @ts-expect-error errors are readonly collections
script.errors?.push({ pos: 0, message: "error" });
if (script.errors?.[0]) {
  // @ts-expect-error error records are readonly
  script.errors[0].message = "error";
}

declare const word: Word;
if ("parts" in word) {
  // @ts-expect-error the parts getter can return undefined
  void word.parts.length;
}
const wordType: "Word" = word.type;
void wordType;
// @ts-expect-error implementation methods are not public AST fields
word.toJSON();
// @ts-expect-error implementation source storage is private
word.sourceText();
// @ts-expect-error lazy values are readonly
word.value = "changed";
// @ts-expect-error lazy parts are readonly collections
word.parts?.pop();
if (word.parts?.[0]) {
  // @ts-expect-error structured part fields are readonly
  word.parts[0].text = "changed";
}

declare const array: ArrayValue;
// @ts-expect-error lazy array elements are readonly collections
array.elements.push(word);
// @ts-expect-error lazy array elements are readonly syntax
array.elements[0].text = "changed";

declare const assignment: Assignment;
const assignmentName: string = assignment.name;
const assignmentValue: Word | ArrayValue = assignment.value;
void [assignmentName, assignmentValue];

declare const operation: ParameterOperation;
if (operation.type === "Slice") {
  const offset: string = operation.offset.text;
  // @ts-expect-error discriminated operations expose only their own operands
  void operation.pattern;
  // @ts-expect-error nested operation children are readonly
  operation.offset.text = offset;
}

declare const heredoc: HereDoc;
// @ts-expect-error heredoc body fields are readonly
heredoc.body.end = 0;
// @ts-expect-error heredoc body parts are readonly collections
heredoc.body.parts?.pop();
if (heredoc.closing) {
  // @ts-expect-error inline ranges are readonly
  heredoc.closing.pos = 0;
}
if (heredoc.descriptor?.type === "FileDescriptorVariable") {
  // @ts-expect-error tagged descriptor records are readonly
  heredoc.descriptor.name = "other";
}

declare const statement: Statement;
declare const pipeline: Pipeline;
declare const andOr: AndOr;
declare const time: Time;
declare const command: CommandNode;
declare const list: CompoundList;
declare const simpleCommand: Command;
declare const functionDefinition: Function;
declare const coprocess: Coproc;
const pipelineElement: Pipeline["commands"][number] = command;
const logicalElement: AndOr["commands"][number] = pipeline;
const prefixedPipeline: PipelineNode = time;
const prefixChild: Time["command"] = pipeline;
const recoveredFunctionBody: Function["body"] = list;
const recoveredCoprocBody: Coproc["body"] = list;
void [pipelineElement, logicalElement, prefixedPipeline, prefixChild, recoveredFunctionBody, recoveredCoprocBody];
// @ts-expect-error statements cannot occur directly inside a pipeline
const statementInPipeline: Pipeline["commands"][number] = statement;
// @ts-expect-error logical lists cannot occur directly inside a pipeline
const logicalInPipeline: Pipeline["commands"][number] = andOr;
// @ts-expect-error timing wraps the pipeline instead of becoming an element
const timingInPipeline: Pipeline["commands"][number] = time;
// @ts-expect-error a nested pipeline requires a compound command
const pipelineInPipeline: Pipeline["commands"][number] = pipeline;
// @ts-expect-error logical lists do not nest directly
const logicalInLogical: AndOr["commands"][number] = andOr;
// @ts-expect-error timing cannot wrap a logical list
const logicalPrefix: Time["command"] = andOr;
// @ts-expect-error a function body is a compound command, never a simple command
const commandAsFunctionBody: Function["body"] = simpleCommand;
// @ts-expect-error a function definition cannot be a function body
const functionAsFunctionBody: Function["body"] = functionDefinition;
// @ts-expect-error a coprocess cannot be a coprocess body
const coprocAsCoprocBody: Coproc["body"] = coprocess;
// @ts-expect-error a function definition cannot be a coprocess body
const functionAsCoprocBody: Coproc["body"] = functionDefinition;
void [
  statementInPipeline,
  logicalInPipeline,
  timingInPipeline,
  pipelineInPipeline,
  logicalInLogical,
  logicalPrefix,
  commandAsFunctionBody,
  functionAsFunctionBody,
  coprocAsCoprocBody,
  functionAsCoprocBody,
];
// @ts-expect-error derived argument views are readonly collections
simpleCommand.args.push(word);
// @ts-expect-error derived redirection views are readonly collections
simpleCommand.redirects.pop();
// @ts-expect-error derived views are readonly
simpleCommand.args = [];

type ExpectedSyntaxKind =
  | "Script"
  | "Statement"
  | "CompoundList"
  | "CaseItem"
  | "Command"
  | "Redirected"
  | "Pipeline"
  | "Time"
  | "Negation"
  | "AndOr"
  | "If"
  | "For"
  | "ArithmeticFor"
  | "Select"
  | "While"
  | "Function"
  | "Subshell"
  | "BraceGroup"
  | "Case"
  | "Coproc"
  | "TestCommand"
  | "ArithmeticCommand"
  | "Word"
  | "Literal"
  | "SingleQuoted"
  | "DoubleQuoted"
  | "AnsiCQuoted"
  | "LocaleString"
  | "SimpleExpansion"
  | "ParameterExpansion"
  | "CommandExpansion"
  | "ArithmeticExpansion"
  | "ProcessSubstitution"
  | "ExtendedGlob"
  | "BraceExpansion"
  | "Assignment"
  | "ArrayValue"
  | "Redirect"
  | "HereString"
  | "HereDoc"
  | "HereDocDelimiter"
  | "HereDocBody"
  | "FileDescriptor"
  | "FileDescriptorVariable"
  | "ArithmeticBinary"
  | "ArithmeticUnary"
  | "ArithmeticTernary"
  | "ArithmeticGroup"
  | "ArithmeticWord"
  | "ArithmeticCommandExpansion"
  | "TestUnary"
  | "TestBinary"
  | "TestLogical"
  | "TestNot"
  | "TestGroup"
  | "Default"
  | "Remove"
  | "Replace"
  | "Slice"
  | "CaseModification"
  | "Transform"
  | "Names"
  | "Unknown";
type AssertNever<T extends never> = T;
type AssertTrue<T extends true> = T;
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type PresentUndefinedFields = [
  AssertTrue<undefined extends Required<Word>["parts"] ? true : false>,
  AssertTrue<undefined extends Required<ExtendedGlobPart>["parts"] ? true : false>,
  AssertTrue<undefined extends Required<BraceExpansionPart>["parts"] ? true : false>,
  AssertTrue<undefined extends Required<ArithmeticWord>["parts"] ? true : false>,
  AssertTrue<undefined extends Required<ParsedScript>["errors"] ? true : false>,
];
declare const presentUndefinedFields: PresentUndefinedFields;
void presentUndefinedFields;
type CommandViews = [
  AssertTrue<Equals<Command["args"], readonly CommandArgument[]>>,
  AssertTrue<Equals<Command["redirects"], readonly Redirection[]>>,
];
declare const commandViews: CommandViews;
void commandViews;
type MissingSyntax = AssertNever<Exclude<ExpectedSyntaxKind, SyntaxNode["type"]>>;
type ExtraSyntax = AssertNever<Exclude<SyntaxNode["type"], ExpectedSyntaxKind>>;
type IsUnion<T, Whole = T> = T extends Whole ? ([Whole] extends [T] ? false : true) : never;
type DuplicateTags = {
  [K in SyntaxNode["type"]]: IsUnion<Extract<SyntaxNode, { type: K }>> extends true ? K : never;
}[SyntaxNode["type"]];
type UniqueSyntax = AssertNever<DuplicateTags>;
declare const allKinds: [MissingSyntax, ExtraSyntax, UniqueSyntax];
void allKinds;

declare const syntax: SyntaxNode;
if (syntax.type === "Case") {
  void syntax.items;
  // @ts-expect-error shell case statements do not have parameter operands
  void syntax.operand;
} else if (syntax.type === "CaseModification") {
  void syntax.operand;
  // @ts-expect-error parameter case operations do not have shell case items
  void syntax.items;
}
