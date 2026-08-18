import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveInWorkdir } from "../../src/core/tools/fs.js";

describe("resolveInWorkdir", () => {
  it("resolves a path inside the working directory", async () => {
    await expect(resolveInWorkdir("README.md")).resolves.toBe(
      path.join(process.cwd(), "README.md")
    );
  });

  it("rejects parent traversal outside the working directory", async () => {
    await expect(resolveInWorkdir("../outside.txt")).rejects.toThrow(
      "escapes the working directory"
    );
  });

  it("rejects absolute paths outside the working directory", async () => {
    const outsidePath = path.resolve(process.cwd(), "..", "outside.txt");
    await expect(resolveInWorkdir(outsidePath)).rejects.toThrow(
      "escapes the working directory"
    );
  });

  it("rejects a symlink inside the working directory that points outside", async (ctx) => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "mini-harness-outside-"));
    const linkName = `.vitest-symlink-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const linkPath = path.join(process.cwd(), linkName);

    try {
      try {
        await fs.symlink(
          outsideDir,
          linkPath,
          process.platform === "win32" ? "junction" : "dir"
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EPERM") {
          ctx.skip("Symlink creation is not permitted in this Windows environment");
          return;
        }
        throw error;
      }

      await expect(resolveInWorkdir(`${linkName}/outside.txt`)).rejects.toThrow(
        "via a symlink"
      );
    } finally {
      await fs.rm(linkPath, { recursive: true, force: true });
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("rejects a final dangling symlink that points outside", async (ctx) => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "mini-harness-outside-"));
    const linkName = `.vitest-dangling-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const linkPath = path.join(process.cwd(), linkName);

    try {
      try {
        await fs.symlink(path.join(outsideDir, "not-created-yet.txt"), linkPath, "file");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EPERM") {
          ctx.skip("File symlink creation is not permitted in this environment");
          return;
        }
        throw error;
      }

      await expect(resolveInWorkdir(linkName)).rejects.toThrow("via a symlink");
    } finally {
      await fs.rm(linkPath, { force: true });
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });
});
