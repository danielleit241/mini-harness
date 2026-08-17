import { exec, type ChildProcess } from "node:child_process";
import type { ToolDefinition } from "./types.js";

const TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

// exec's own `timeout` option only kills the direct child; a shell command
// that spawns its own children (e.g. backgrounds a process) leaves them
// running past the timeout. Kill the whole tree instead.
function killTree(child: ChildProcess) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    exec(`taskkill /pid ${child.pid} /T /F`);
  } else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

interface RunResult {
  output: string;
  timedOut: boolean;
  error?: Error;
}

function runCommand(command: string): Promise<RunResult> {
  return new Promise((resolve) => {
    let output = "";
    let timedOut = false;

    // `detached` isn't in exec's TS types but Node passes exec's options
    // straight through to the underlying spawn, which does support it.
    const child = exec(command, {
      cwd: process.cwd(),
      detached: process.platform !== "win32",
    } as import("node:child_process").ExecOptions & { detached: boolean });

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, TIMEOUT_MS);

    const collect = (chunk: Buffer) => {
      if (output.length < MAX_OUTPUT_BYTES) output += chunk.toString();
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);

    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ output, timedOut, error });
    });
    child.on("close", () => {
      clearTimeout(timer);
      resolve({ output, timedOut });
    });
  });
}

export const runCommandTool: ToolDefinition = {
  name: "run_command",
  description:
    "Run a shell command in the working directory and return its stdout/stderr.",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string", description: "Shell command to execute" },
    },
    required: ["command"],
  },
  requiresPermission: true,
  async execute(input: { command: string }): Promise<string> {
    const { output, timedOut, error } = await runCommand(input.command);
    if (timedOut) {
      return `Command timed out after ${TIMEOUT_MS / 1000}s and was killed.\n${output}`.trim();
    }
    if (error) {
      return `Command failed: ${error.message}\n${output}`.trim();
    }
    return output.trim() || "(no output)";
  },
};
