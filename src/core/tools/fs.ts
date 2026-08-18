import * as fs from "node:fs/promises";
import * as path from "node:path";
import { logger } from "../logger.js";
import { logToolOutcome } from "./log.js";
import type { ToolDefinition } from "./types.js";

const WORKDIR = process.cwd();

let realWorkdirPromise: Promise<string> | undefined;
function realWorkdir(): Promise<string> {
  if (!realWorkdirPromise) realWorkdirPromise = fs.realpath(WORKDIR);
  return realWorkdirPromise;
}

// Keep every tool confined to the directory the harness was started in —
// a minimal safety boundary so the agent can't read/write arbitrary paths
// on the machine. Two checks: the lexical path (blocks "..", absolute
// paths) and, separately, resolving symlinks on the nearest existing
// ancestor (blocks a symlink inside WORKDIR that points outside it — the
// lexical check alone can't catch that, since it never touches the
// filesystem).
export async function resolveInWorkdir(relativePath: string): Promise<string> {
  const resolved = path.resolve(WORKDIR, relativePath);
  if (resolved !== WORKDIR && !resolved.startsWith(WORKDIR + path.sep)) {
    throw new Error(`Path "${relativePath}" escapes the working directory`);
  }

  const realWd = await realWorkdir();
  let current = resolved;
  while (true) {
    try {
      const real = await fs.realpath(current);
      if (real !== realWd && !real.startsWith(realWd + path.sep)) {
        throw new Error(
          `Path "${relativePath}" escapes the working directory via a symlink`
        );
      }
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;

      // A dangling symlink has no realpath, but lstat still exposes the link.
      // Resolve its target before walking parents so a write cannot follow a
      // final symlink out of WORKDIR and create a new external file.
      try {
        const stat = await fs.lstat(current);
        if (stat.isSymbolicLink()) {
          const target = await fs.readlink(current);
          current = path.resolve(path.dirname(current), target);
          continue;
        }
      } catch (lstatError) {
        if ((lstatError as NodeJS.ErrnoException).code !== "ENOENT") {
          throw lstatError;
        }
      }

      const parent = path.dirname(current);
      if (parent === current) break; // reached filesystem root, nothing more to resolve
      current = parent;
    }
  }

  return resolved;
}

export const readFileTool: ToolDefinition = {
  name: "read_file",
  description:
    "Read the full contents of a text file, given a path relative to the working directory.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path relative to the working directory" },
    },
    required: ["path"],
  },
  requiresPermission: false,
  async execute(input: { path: string }): Promise<string> {
    const startedAt = Date.now();
    logger.debug({ tool: "read_file", input }, "tool input");
    try {
      const filePath = await resolveInWorkdir(input.path);
      const result = await fs.readFile(filePath, "utf-8");
      logger.debug({ tool: "read_file", input, output: result }, "tool output");
      logToolOutcome("read_file", startedAt, true);
      return result;
    } catch (err) {
      logToolOutcome("read_file", startedAt, false, err);
      throw err;
    }
  },
};

export const listDirTool: ToolDefinition = {
  name: "list_dir",
  description:
    "List files and subdirectories at a path relative to the working directory.",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          'Path relative to the working directory. Use "." for the working directory itself.',
      },
    },
    required: ["path"],
  },
  requiresPermission: false,
  async execute(input: { path: string }): Promise<string> {
    const startedAt = Date.now();
    logger.debug({ tool: "list_dir", input }, "tool input");
    try {
      const dirPath = await resolveInWorkdir(input.path);
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      const result = entries
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .sort()
        .join("\n");
      logger.debug({ tool: "list_dir", input, output: result }, "tool output");
      logToolOutcome("list_dir", startedAt, true);
      return result;
    } catch (err) {
      logToolOutcome("list_dir", startedAt, false, err);
      throw err;
    }
  },
};

export const writeFileTool: ToolDefinition = {
  name: "write_file",
  description:
    "Write text content to a file at a path relative to the working directory, creating or overwriting it.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path relative to the working directory" },
      content: { type: "string", description: "Full text content to write" },
    },
    required: ["path", "content"],
  },
  requiresPermission: true,
  async execute(input: { path: string; content: string }): Promise<string> {
    const startedAt = Date.now();
    logger.debug({ tool: "write_file", input }, "tool input");
    try {
      const filePath = await resolveInWorkdir(input.path);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, input.content, "utf-8");
      const result = `Wrote ${input.content.length} bytes to ${input.path}`;
      logger.debug({ tool: "write_file", input, output: result }, "tool output");
      logToolOutcome("write_file", startedAt, true);
      return result;
    } catch (err) {
      logToolOutcome("write_file", startedAt, false, err);
      throw err;
    }
  },
};
