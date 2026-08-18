import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

export class ReadlineClosedError extends Error {}

// Created lazily, not at module load: this module is imported transitively
// by core/permissions.ts, which src/cli/hooks/use-permission-bridge.ts also
// imports (for setPermissionPrompter) even though the Ink CLI never calls
// ask() itself. Grabbing stdin unconditionally at import time would contend
// with Ink's own raw-mode ownership of the same stream. Only eval/run.ts's
// defaultPrompter path ever actually needs this interface.
let iface: readline.Interface | null = null;
let closed = false;

function getInterface(): readline.Interface {
  if (!iface) {
    iface = readline.createInterface({ input: stdin, output: stdout });
    iface.on("close", () => {
      closed = true;
    });
  }
  return iface;
}

// rl.question() throws ERR_USE_AFTER_CLOSE if called after stdin closes
// (EOF, Ctrl+D); track it ourselves so callers can catch a typed error and
// shut down cleanly instead of the process dying mid-operation.
export async function ask(question: string): Promise<string> {
  if (closed) throw new ReadlineClosedError();
  return getInterface().question(question);
}

// Closes the interface if one was ever created; a no-op otherwise (a run
// that never called ask() has nothing to close).
export function closePrompt(): void {
  iface?.close();
}
