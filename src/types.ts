export interface Word {
  readonly type: "Word";
  readonly text: string;
  readonly value: string;
  readonly pos: number;
  readonly end: number;
  readonly parts?: readonly WordPart[] | undefined;
}

export interface LiteralPart {
  readonly type: "Literal";
  readonly pos: number;
  readonly end: number;
  readonly value: string;
  readonly text: string;
}

export interface SingleQuotedPart {
  readonly type: "SingleQuoted";
  readonly pos: number;
  readonly end: number;
  readonly value: string;
  readonly text: string;
}

export interface DoubleQuotedPart {
  readonly type: "DoubleQuoted";
  readonly pos: number;
  readonly end: number;
  readonly text: string;
  readonly parts: readonly DoubleQuotedChild[];
}

export interface AnsiCQuotedPart {
  readonly type: "AnsiCQuoted";
  readonly pos: number;
  readonly end: number;
  readonly text: string;
  readonly value: string;
}

export interface LocaleStringPart {
  readonly type: "LocaleString";
  readonly pos: number;
  readonly end: number;
  readonly text: string;
  readonly parts: readonly DoubleQuotedChild[];
}

export interface SimpleExpansionPart {
  readonly type: "SimpleExpansion";
  readonly pos: number;
  readonly end: number;
  readonly text: string;
}

export interface ParameterExpansionPart {
  readonly type: "ParameterExpansion";
  readonly pos: number;
  readonly end: number;
  readonly text: string;
  readonly parameter: string;
  readonly parameterPos: number;
  readonly parameterEnd: number;
  readonly prefix: "!" | "#" | undefined;
  readonly index: Word | undefined;
  readonly operation: ParameterOperation | undefined;
}

interface ParameterOperationBase {
  readonly pos: number;
  readonly end: number;
  readonly operatorEnd: number;
}

export interface ParameterDefaultOperation extends ParameterOperationBase {
  readonly type: "Default";
  readonly operator: "-" | ":-" | "=" | ":=" | "+" | ":+" | "?" | ":?";
  readonly operand: Word;
}

export interface ParameterRemoveOperation extends ParameterOperationBase {
  readonly type: "Remove";
  readonly operator: "#" | "##" | "%" | "%%";
  readonly operand: Word;
}

export interface ParameterReplaceOperation extends ParameterOperationBase {
  readonly type: "Replace";
  readonly operator: "/" | "//" | "/#" | "/%";
  readonly pattern: Word;
  readonly replacement: Word;
}

export interface ParameterSliceOperation extends ParameterOperationBase {
  readonly type: "Slice";
  readonly operator: ":";
  readonly offset: Word;
  readonly length: Word | undefined;
}

export interface ParameterCaseOperation extends ParameterOperationBase {
  readonly type: "CaseModification";
  readonly operator: "^" | "^^" | "," | ",,";
  readonly operand: Word | undefined;
}

export interface ParameterTransformOperation extends ParameterOperationBase {
  readonly type: "Transform";
  readonly operator: "@";
  readonly operand: Word;
}

export interface ParameterNamesOperation extends ParameterOperationBase {
  readonly type: "Names";
  readonly operator: "@" | "*";
}

export interface ParameterUnknownOperation extends ParameterOperationBase {
  readonly type: "Unknown";
  readonly operator: string;
}

export type ParameterOperation =
  | ParameterDefaultOperation
  | ParameterRemoveOperation
  | ParameterReplaceOperation
  | ParameterSliceOperation
  | ParameterCaseOperation
  | ParameterTransformOperation
  | ParameterNamesOperation
  | ParameterUnknownOperation;

export interface CommandExpansionPart {
  readonly type: "CommandExpansion";
  readonly pos: number;
  readonly end: number;
  readonly text: string;
  readonly script: ParsedScript | undefined;
}

export interface ArithmeticExpansionPart {
  readonly type: "ArithmeticExpansion";
  readonly pos: number;
  readonly end: number;
  readonly text: string;
  readonly expression: ArithmeticExpression | undefined;
}

export interface ProcessSubstitutionPart {
  readonly type: "ProcessSubstitution";
  readonly pos: number;
  readonly end: number;
  readonly text: string;
  readonly operator: "<" | ">";
  readonly script: ParsedScript | undefined;
}

export type ExtGlobOperator = "?" | "*" | "+" | "@" | "!";

export interface ExtendedGlobPart {
  readonly type: "ExtendedGlob";
  readonly pos: number;
  readonly end: number;
  readonly text: string;
  readonly operator: ExtGlobOperator;
  readonly pattern: string;
  readonly parts?: readonly WordPart[] | undefined;
}

export interface BraceExpansionPart {
  readonly type: "BraceExpansion";
  readonly pos: number;
  readonly end: number;
  readonly text: string;
  readonly parts?: readonly WordPart[] | undefined;
}

export type ArithmeticExpression =
  | ArithmeticBinary
  | ArithmeticUnary
  | ArithmeticTernary
  | ArithmeticGroup
  | ArithmeticWord
  | ArithmeticCommandExpansion;

export interface ArithmeticBinary {
  readonly type: "ArithmeticBinary";
  readonly pos: number;
  readonly end: number;
  readonly operator: string;
  readonly left: ArithmeticExpression;
  readonly right: ArithmeticExpression;
}

export interface ArithmeticUnary {
  readonly type: "ArithmeticUnary";
  readonly pos: number;
  readonly end: number;
  readonly operator: string;
  readonly operand: ArithmeticExpression;
  readonly prefix: boolean;
}

export interface ArithmeticTernary {
  readonly type: "ArithmeticTernary";
  readonly pos: number;
  readonly end: number;
  readonly test: ArithmeticExpression;
  readonly consequent: ArithmeticExpression;
  readonly alternate: ArithmeticExpression;
}

export interface ArithmeticGroup {
  readonly type: "ArithmeticGroup";
  readonly pos: number;
  readonly end: number;
  readonly expression: ArithmeticExpression;
}

export interface ArithmeticWord {
  readonly type: "ArithmeticWord";
  readonly pos: number;
  readonly end: number;
  readonly value: string;
  readonly parts?: readonly WordPart[] | undefined;
}

export interface ArithmeticCommandExpansion {
  readonly type: "ArithmeticCommandExpansion";
  readonly pos: number;
  readonly end: number;
  readonly text: string; // e.g., "$(cmd)"
  readonly script: ParsedScript | undefined; // set after resolution
}

export type DoubleQuotedChild =
  | LiteralPart
  | SimpleExpansionPart
  | ParameterExpansionPart
  | CommandExpansionPart
  | ArithmeticExpansionPart;

export type WordPart =
  | LiteralPart
  | SingleQuotedPart
  | DoubleQuotedPart
  | AnsiCQuotedPart
  | LocaleStringPart
  | SimpleExpansionPart
  | ParameterExpansionPart
  | CommandExpansionPart
  | ArithmeticExpansionPart
  | ProcessSubstitutionPart
  | ExtendedGlobPart
  | BraceExpansionPart;

export interface Assignment {
  readonly type: "Assignment";
  readonly pos: number;
  readonly end: number;
  readonly text: string;
  readonly name: string;
  readonly value: Word | ArrayValue;
  readonly append: boolean | undefined;
  readonly index: Word | undefined;
}

export interface ArrayValue {
  readonly type: "ArrayValue";
  readonly pos: number;
  readonly end: number;
  readonly elements: readonly Word[];
}

export type AssignmentPrefix = Assignment;

export type CommandArgument = Word | Assignment;

export type RedirectOperator = ">" | ">>" | "<" | "<>" | "<&" | ">&" | ">|" | "&>" | "&>>";

export type Redirection = Redirect | HereString | HereDoc;

export type RedirectDescriptor =
  | { readonly type: "FileDescriptor"; readonly pos: number; readonly end: number; readonly value: number }
  | { readonly type: "FileDescriptorVariable"; readonly pos: number; readonly end: number; readonly name: string };

export interface Redirect {
  readonly type: "Redirect";
  readonly pos: number;
  readonly end: number;
  readonly operator: RedirectOperator;
  readonly descriptor: RedirectDescriptor | undefined;
  readonly target: Word | undefined;
}

export interface HereString {
  readonly type: "HereString";
  readonly pos: number;
  readonly end: number;
  readonly operator: "<<<";
  readonly descriptor: RedirectDescriptor | undefined;
  readonly target: Word | undefined;
}

export interface HereDoc {
  readonly type: "HereDoc";
  readonly pos: number;
  readonly end: number;
  readonly operator: "<<" | "<<-";
  readonly descriptor: RedirectDescriptor | undefined;
  readonly delimiter: HereDocDelimiter | undefined;
  readonly body: HereDocBody;
  readonly closing: { readonly pos: number; readonly end: number } | undefined;
}

export interface HereDocDelimiter {
  readonly type: "HereDocDelimiter";
  readonly pos: number;
  readonly end: number;
  readonly text: string;
  readonly value: string;
  readonly quoted: boolean;
}

export interface HereDocBody {
  readonly type: "HereDocBody";
  readonly pos: number;
  readonly end: number;
  readonly text: string;
  readonly parts: readonly WordPart[] | undefined;
}

export interface Command {
  readonly type: "Command";
  readonly pos: number;
  readonly end: number;
  readonly name: Word | undefined;
  readonly prefix: readonly (Assignment | Redirection)[];
  readonly suffix: readonly (CommandArgument | Redirection)[];
  /** Suffix words and assignments in source order; derived from suffix, lazy, cached, not serialized. */
  readonly args: readonly CommandArgument[];
  /** Redirections from prefix then suffix in source order; derived, lazy, cached, not serialized. */
  readonly redirects: readonly Redirection[];
}

export interface Redirected {
  readonly type: "Redirected";
  readonly pos: number;
  readonly end: number;
  readonly command: CompoundCommand;
  readonly redirects: readonly Redirection[];
}

export type CompoundCommand =
  | If
  | For
  | ArithmeticFor
  | Select
  | While
  | Subshell
  | BraceGroup
  | Case
  | TestCommand
  | ArithmeticCommand;

export type PipeOperator = "|" | "|&";

export type CommandNode = Command | CompoundCommand | Redirected | Function | Coproc;

export type PipelineNode = CommandNode | Pipeline | Time | Negation;

export interface Pipeline {
  readonly type: "Pipeline";
  readonly pos: number;
  readonly end: number;
  readonly commands: readonly CommandNode[];
  readonly operators: readonly PipeOperator[];
}

export interface Time {
  readonly type: "Time";
  readonly pos: number;
  readonly end: number;
  readonly keywordEnd: number;
  readonly posix: { readonly pos: number; readonly end: number } | undefined;
  readonly endOfOptions: { readonly pos: number; readonly end: number } | undefined;
  readonly command: PipelineNode | undefined;
}

export interface Negation {
  readonly type: "Negation";
  readonly pos: number;
  readonly end: number;
  readonly keywordEnd: number;
  readonly command: PipelineNode | undefined;
}

export type LogicalOperator = "&&" | "||";

export interface AndOr {
  readonly type: "AndOr";
  readonly pos: number;
  readonly end: number;
  readonly commands: readonly PipelineNode[];
  readonly operators: readonly LogicalOperator[];
}

export interface If {
  readonly type: "If";
  readonly pos: number;
  readonly end: number;
  readonly clause: CompoundList;
  readonly then: CompoundList;
  readonly else: CompoundList | If | undefined;
}

export interface For {
  readonly type: "For";
  readonly pos: number;
  readonly end: number;
  readonly name: Word;
  readonly wordlist: readonly Word[] | undefined;
  readonly body: CompoundList;
}

export type WhileKind = "while" | "until";

export interface While {
  readonly type: "While";
  readonly pos: number;
  readonly end: number;
  readonly kind: WhileKind;
  readonly clause: CompoundList;
  readonly body: CompoundList;
}

export interface Function {
  readonly type: "Function";
  readonly pos: number;
  readonly end: number;
  readonly name: Word;
  /** A CompoundList body only occurs in recovery and is accompanied by an error. */
  readonly body: CompoundCommand | Redirected | CompoundList;
}

export interface Subshell {
  readonly type: "Subshell";
  readonly pos: number;
  readonly end: number;
  readonly body: CompoundList;
}

export interface BraceGroup {
  readonly type: "BraceGroup";
  readonly pos: number;
  readonly end: number;
  readonly body: CompoundList;
}

export interface CompoundList {
  readonly type: "CompoundList";
  readonly pos: number;
  readonly end: number;
  readonly commands: readonly Statement[];
}

export interface Case {
  readonly type: "Case";
  readonly pos: number;
  readonly end: number;
  readonly word: Word;
  readonly items: readonly CaseItem[];
}

export type CaseTerminator = ";;" | ";&" | ";;&";

export interface CaseItem {
  readonly type: "CaseItem";
  readonly pos: number;
  readonly end: number;
  readonly pattern: readonly Word[];
  readonly body: CompoundList;
  readonly terminator: CaseTerminator | undefined;
}

export interface Select {
  readonly type: "Select";
  readonly pos: number;
  readonly end: number;
  readonly name: Word;
  readonly wordlist: readonly Word[] | undefined;
  readonly body: CompoundList;
}

export interface Coproc {
  readonly type: "Coproc";
  readonly pos: number;
  readonly end: number;
  readonly name: Word | undefined;
  /** A CompoundList body only occurs in recovery and is accompanied by an error. */
  readonly body: Command | CompoundCommand | Redirected | CompoundList;
}

export interface ArithmeticFor {
  readonly type: "ArithmeticFor";
  readonly pos: number;
  readonly end: number;
  readonly initialize: ArithmeticExpression | undefined;
  readonly test: ArithmeticExpression | undefined;
  readonly update: ArithmeticExpression | undefined;
  readonly body: CompoundList;
}

export type TestExpression =
  | TestUnaryExpression
  | TestBinaryExpression
  | TestLogicalExpression
  | TestNotExpression
  | TestGroupExpression;

export interface TestUnaryExpression {
  readonly type: "TestUnary";
  readonly pos: number;
  readonly end: number;
  readonly operator: string;
  readonly operand: Word;
}

export interface TestBinaryExpression {
  readonly type: "TestBinary";
  readonly pos: number;
  readonly end: number;
  readonly operator: string;
  readonly left: Word;
  readonly right: Word;
}

export interface TestLogicalExpression {
  readonly type: "TestLogical";
  readonly pos: number;
  readonly end: number;
  readonly operator: "&&" | "||";
  readonly left: TestExpression;
  readonly right: TestExpression;
}

export interface TestNotExpression {
  readonly type: "TestNot";
  readonly pos: number;
  readonly end: number;
  readonly operand: TestExpression;
}

export interface TestGroupExpression {
  readonly type: "TestGroup";
  readonly pos: number;
  readonly end: number;
  readonly expression: TestExpression;
}

export interface TestCommand {
  readonly type: "TestCommand";
  readonly pos: number;
  readonly end: number;
  readonly expression: TestExpression;
}

export interface ArithmeticCommand {
  readonly type: "ArithmeticCommand";
  readonly pos: number;
  readonly end: number;
  readonly expression: ArithmeticExpression | undefined;
  readonly body: string;
}

export interface Statement {
  readonly type: "Statement";
  readonly pos: number;
  readonly end: number;
  readonly command: PipelineNode | AndOr;
  readonly background: boolean | undefined;
}

export type SyntaxNode =
  | ParsedScript
  | Statement
  | CompoundList
  | CaseItem
  | PipelineNode
  | AndOr
  | Word
  | WordPart
  | Assignment
  | ArrayValue
  | Redirection
  | RedirectDescriptor
  | HereDocDelimiter
  | HereDocBody
  | ArithmeticExpression
  | TestExpression
  | ParameterOperation;

export interface Script {
  readonly type: "Script";
  readonly pos: number;
  readonly end: number;
  readonly shebang: string | undefined;
  readonly commands: readonly Statement[];
  /** Decoded source owned by escaped-backtick scripts; descendant positions index this string. */
  readonly source?: string;
}

export interface ParsedScript extends Script {
  readonly errors?: readonly ParseError[] | undefined;
}

export interface ParseError {
  readonly message: string;
  readonly pos: number;
}
