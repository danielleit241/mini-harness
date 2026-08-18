import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/logger.js", () => ({
  logger: { info: vi.fn() },
}));

import { logger } from "../../src/core/logger.js";
import { logToolOutcome } from "../../src/core/tools/log.js";

const mockedInfo = vi.mocked(logger.info);

describe("logToolOutcome", () => {
  it("logs no error fields on success", () => {
    logToolOutcome("read_file", Date.now(), true);

    expect(mockedInfo).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "read_file", success: true }),
      "tool execution completed"
    );
    const [record] = mockedInfo.mock.calls[0];
    expect(record).not.toHaveProperty("errorName");
    expect(record).not.toHaveProperty("errorMessage");
  });

  it("logs errorName/errorMessage for an Error", () => {
    logToolOutcome("run_command", Date.now(), false, new Error("boom"));

    expect(mockedInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: "run_command",
        success: false,
        errorName: "Error",
        errorMessage: "boom",
      }),
      "tool execution completed"
    );
  });

  it("still records a reason when the thrown value is not an Error", () => {
    logToolOutcome("run_command", Date.now(), false, "EACCES");

    expect(mockedInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: "run_command",
        success: false,
        errorMessage: "EACCES",
      }),
      "tool execution completed"
    );
  });
});
