import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

// Single shared readline interface: both the main REPL and the permission
// gate need to read from stdin, and readline only works well with one owner.
export const rl = readline.createInterface({ input: stdin, output: stdout });

export class ReadlineClosedError extends Error {}

// rl.question() throws ERR_USE_AFTER_CLOSE if called after stdin closes
// (EOF, Ctrl+D); track it ourselves so callers can catch a typed error and
// shut down cleanly instead of the process dying mid-operation.
let closed = false;
rl.on("close", () => {
  closed = true;
});

export async function ask(question: string): Promise<string> {
  if (closed) throw new ReadlineClosedError();
  return rl.question(question);
}
