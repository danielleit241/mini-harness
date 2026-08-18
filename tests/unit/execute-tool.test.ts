import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/prompt.js", () => ({
  ask: vi.fn(),
  ReadlineClosedError: class ReadlineClosedError extends Error {},
}));

import { ask } from "../../src/core/prompt.js";
import { executeTool } from "../../src/core/tools/index.js";

const mockedAsk = vi.mocked(ask);

describe("executeTool", () => {
  beforeEach(() => {
    mockedAsk.mockReset();
  });

  it("returns an error toolResult for an unknown tool name", async () => {
    const result = await executeTool("not_a_real_tool", {}, "tool-1");

    expect(result).toEqual({
      toolResult: {
        toolUseId: "tool-1",
        status: "error",
        content: [{ text: "Unknown tool: not_a_real_tool" }],
      },
    });
  });

  it("returns an error toolResult when input is undefined", async () => {
    const result = await executeTool("read_file", undefined, "tool-2b");

    expect(result).toMatchObject({
      toolResult: {
        toolUseId: "tool-2b",
        status: "error",
        content: [{ text: expect.stringContaining("must be a JSON object") }],
      },
    });
  });

  it("returns an error toolResult when a required field is missing", async () => {
    const result = await executeTool("read_file", {}, "tool-2");

    expect(result).toMatchObject({
      toolResult: {
        toolUseId: "tool-2",
        status: "error",
        content: [{ text: expect.stringContaining('Missing required field: "path"') }],
      },
    });
    expect(mockedAsk).not.toHaveBeenCalled();
  });

  it("returns an error toolResult when a field has the wrong type", async () => {
    const result = await executeTool("read_file", { path: 5 }, "tool-3");

    expect(result).toMatchObject({
      toolResult: {
        toolUseId: "tool-3",
        status: "error",
        content: [{ text: expect.stringContaining('Field "path" must be a string') }],
      },
    });
  });

  it("rejects invalid input before checking permission for a state-changing tool", async () => {
    const result = await executeTool("write_file", { path: "a.txt" }, "tool-4");

    expect(result).toMatchObject({
      toolResult: { status: "error" },
    });
    expect(mockedAsk).not.toHaveBeenCalled();
  });

  it("returns an error toolResult when permission is denied", async () => {
    mockedAsk.mockResolvedValue("n");

    const result = await executeTool(
      "write_file",
      { path: "a.txt", content: "x" },
      "tool-5"
    );

    expect(result).toEqual({
      toolResult: {
        toolUseId: "tool-5",
        status: "error",
        content: [{ text: "User denied permission for this action." }],
      },
    });
  });

  it("resolves to an error toolResult instead of rejecting when the permission prompter throws", async () => {
    // Guards executeTool()'s contract (always resolve, never reject) against
    // a prompter failure — e.g. the Ink UI's prompter denying with no
    // listener registered, or here a non-ReadlineClosedError from ask().
    mockedAsk.mockRejectedValue(new Error("prompt UI unavailable"));

    const result = await executeTool(
      "write_file",
      { path: "a.txt", content: "x" },
      "tool-6"
    );

    expect(result).toEqual({
      toolResult: {
        toolUseId: "tool-6",
        status: "error",
        content: [{ text: "Error: prompt UI unavailable" }],
      },
    });
  });
});
