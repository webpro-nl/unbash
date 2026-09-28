import type { Command, CommandArgument, Redirection, Word } from "./internal-types.ts";

const isArgument = (item: CommandArgument | Redirection): item is CommandArgument =>
  item.type === "Word" || item.type === "Assignment";

export class CommandImpl implements Command {
  type = "Command" as const;
  pos: number;
  end: number;
  name: Word | undefined;
  prefix: Command["prefix"];
  suffix: Command["suffix"];
  #args: CommandArgument[] | undefined;
  #redirects: Redirection[] | undefined;

  constructor(pos: number, end: number, name: Word | undefined, prefix: Command["prefix"], suffix: Command["suffix"]) {
    this.pos = pos;
    this.end = end;
    this.name = name;
    this.prefix = prefix;
    this.suffix = suffix;
  }

  get args(): CommandArgument[] {
    if (this.#args === undefined) {
      const suffix = this.suffix;
      this.#args = suffix.every(isArgument) ? suffix : suffix.filter(isArgument);
    }
    return this.#args;
  }

  get redirects(): Redirection[] {
    if (this.#redirects === undefined) {
      const redirects: Redirection[] = [];
      for (const item of this.prefix) if (item.type !== "Assignment") redirects.push(item);
      for (const item of this.suffix) if (!isArgument(item)) redirects.push(item);
      this.#redirects = redirects;
    }
    return this.#redirects;
  }

  toJSON(): Omit<Command, "args" | "redirects"> {
    return { type: this.type, pos: this.pos, end: this.end, name: this.name, prefix: this.prefix, suffix: this.suffix };
  }
}
