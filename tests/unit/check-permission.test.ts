import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/prompt.js", () => ({
  ask: vi.fn(),
  ReadlineClosedError: class ReadlineClosedError extends Error {},
}));

import { ReadlineClosedError, ask } from "../../src/core/prompt.js";
import { checkPermission } from "../../src/core/permissions.js";

const mockedAsk = vi.mocked(ask);

describe("checkPermission", () => {
  beforeEach(() => {
    mockedAsk.mockReset();
  });

  it("allows once without caching a yes answer", async () => {
    mockedAsk.mockResolvedValue("y");

    await expect(checkPermission("run_command", { command: "echo once" })).resolves.toBe(
      true
    );
    await expect(checkPermission("run_command", { command: "echo once" })).resolves.toBe(
      true
    );

    expect(mockedAsk).toHaveBeenCalledTimes(2);
  });

  it("caches always approvals by the exact tool and input", async () => {
    mockedAsk.mockResolvedValue("a");

    await expect(
      checkPermission("run_command", { command: "echo cached" })
    ).resolves.toBe(true);
    await expect(
      checkPermission("run_command", { command: "echo cached" })
    ).resolves.toBe(true);
    await expect(
      checkPermission("run_command", { command: "echo different" })
    ).resolves.toBe(true);

    expect(mockedAsk).toHaveBeenCalledTimes(2);
  });

  it("denies no and unknown answers", async () => {
    mockedAsk.mockResolvedValueOnce("n").mockResolvedValueOnce("maybe");

    await expect(checkPermission("write_file", { path: "a.txt" })).resolves.toBe(false);
    await expect(checkPermission("write_file", { path: "b.txt" })).resolves.toBe(false);
  });

  it("fails safe when stdin is closed", async () => {
    mockedAsk.mockRejectedValue(new ReadlineClosedError());

    await expect(checkPermission("run_command", { command: "echo eof" })).resolves.toBe(
      false
    );
  });

  it("does not share an always approval across tool names", async () => {
    mockedAsk.mockResolvedValue("a");

    await expect(checkPermission("run_command", { value: "same-input" })).resolves.toBe(
      true
    );
    await expect(checkPermission("write_file", { value: "same-input" })).resolves.toBe(
      true
    );

    expect(mockedAsk).toHaveBeenCalledTimes(2);
  });
});
