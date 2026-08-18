import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/prompt.js", () => ({
  ask: vi.fn(),
  ReadlineClosedError: class ReadlineClosedError extends Error {},
}));

import { ReadlineClosedError, ask } from "../../src/core/prompt.js";
import {
  checkPermission,
  defaultPrompter,
  setPermissionPrompter,
} from "../../src/core/permissions.js";

const mockedAsk = vi.mocked(ask);

const fakePrompter = vi.fn<() => Promise<"yes" | "always" | "no">>();

beforeEach(() => {
  fakePrompter.mockReset();
  setPermissionPrompter((toolName, input) => fakePrompter());
});

describe("checkPermission", () => {
  it("allows once without caching a yes answer", async () => {
    fakePrompter.mockResolvedValue("yes");

    await expect(checkPermission("run_command", { command: "echo once" })).resolves.toBe(
      true
    );
    await expect(checkPermission("run_command", { command: "echo once" })).resolves.toBe(
      true
    );

    expect(fakePrompter).toHaveBeenCalledTimes(2);
  });

  it("caches always approvals by the exact tool and input", async () => {
    fakePrompter.mockResolvedValue("always");

    await expect(
      checkPermission("run_command", { command: "echo cached" })
    ).resolves.toBe(true);
    await expect(
      checkPermission("run_command", { command: "echo cached" })
    ).resolves.toBe(true);
    await expect(
      checkPermission("run_command", { command: "echo different" })
    ).resolves.toBe(true);

    expect(fakePrompter).toHaveBeenCalledTimes(2);
  });

  it("denies no and unknown answers", async () => {
    fakePrompter.mockResolvedValueOnce("no").mockResolvedValueOnce("no");

    await expect(checkPermission("write_file", { path: "a.txt" })).resolves.toBe(false);
    await expect(checkPermission("write_file", { path: "b.txt" })).resolves.toBe(false);
  });

  it("propagates a prompter rejection instead of swallowing it", async () => {
    fakePrompter.mockRejectedValue(new Error("stdin closed"));

    await expect(checkPermission("run_command", { command: "echo eof" })).rejects.toThrow(
      "stdin closed"
    );
  });

  it("does not share an always approval across tool names", async () => {
    fakePrompter.mockResolvedValue("always");

    await expect(checkPermission("run_command", { value: "same-input" })).resolves.toBe(
      true
    );
    await expect(checkPermission("write_file", { value: "same-input" })).resolves.toBe(
      true
    );

    expect(fakePrompter).toHaveBeenCalledTimes(2);
  });
});

describe("defaultPrompter", () => {
  beforeEach(() => {
    mockedAsk.mockReset();
  });

  it("returns 'no' (fail-safe deny) when stdin is closed", async () => {
    mockedAsk.mockRejectedValue(new ReadlineClosedError());

    await expect(defaultPrompter("run_command", { command: "echo eof" })).resolves.toBe(
      "no"
    );
  });

  it("maps y/a/other answers to yes/always/no", async () => {
    mockedAsk.mockResolvedValueOnce("y");
    await expect(defaultPrompter("run_command", {})).resolves.toBe("yes");

    mockedAsk.mockResolvedValueOnce("a");
    await expect(defaultPrompter("run_command", {})).resolves.toBe("always");

    mockedAsk.mockResolvedValueOnce("n");
    await expect(defaultPrompter("run_command", {})).resolves.toBe("no");
  });
});
