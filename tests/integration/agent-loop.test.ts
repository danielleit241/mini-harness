import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/bedrock.js", () => ({
  converse: vi.fn(),
}));
vi.mock("../../src/core/prompt.js", () => ({
  ask: vi.fn(),
  ReadlineClosedError: class ReadlineClosedError extends Error {},
}));

import { converse } from "../../src/core/bedrock.js";
import { runAgent } from "../../src/core/agent.js";

const mockedConverse = vi.mocked(converse);

function response(content: unknown[], stopReason = "end_turn") {
  return {
    message: { role: "assistant", content },
    stopReason,
  } as never;
}

describe("runAgent", () => {
  beforeEach(() => {
    mockedConverse.mockReset();
  });

  it("returns text from a text-only reply", async () => {
    mockedConverse.mockResolvedValue(response([{ text: "hello" }]));
    const messages: never[] = [];

    await expect(runAgent(messages, "hi")).resolves.toBe("hello");
    expect(messages).toHaveLength(2);
  });

  it("executes a tool-use round before returning the final text", async () => {
    mockedConverse
      .mockResolvedValueOnce(
        response(
          [
            {
              toolUse: {
                toolUseId: "tool-1",
                name: "read_file",
                input: { path: "README.md" },
              },
            },
          ],
          "tool_use"
        )
      )
      .mockResolvedValueOnce(response([{ text: "I read it." }]));
    const messages: never[] = [];

    await expect(runAgent(messages, "inspect the readme")).resolves.toBe("I read it.");
    expect(mockedConverse).toHaveBeenCalledTimes(2);
    expect(messages).toHaveLength(4);
    expect(messages[2]).toMatchObject({ role: "user" });
  });

  it("rolls back the whole turn when the iteration cap is exceeded", async () => {
    mockedConverse.mockResolvedValue(
      response(
        [{ toolUse: { toolUseId: "unknown", name: "missing_tool", input: {} } }],
        "tool_use"
      )
    );
    const messages = [{ role: "assistant", content: [{ text: "previous" }] }] as never[];
    const before = structuredClone(messages);

    await expect(runAgent(messages, "loop forever")).rejects.toThrow("tool-call limit");
    expect(mockedConverse).toHaveBeenCalledTimes(25);
    expect(messages).toEqual(before);
  });

  it("rolls back the whole turn when a Bedrock call throws", async () => {
    const error = new Error("Bedrock unavailable");
    mockedConverse.mockRejectedValue(error);
    const messages = [{ role: "assistant", content: [{ text: "previous" }] }] as never[];
    const before = structuredClone(messages);

    await expect(runAgent(messages, "fail this turn")).rejects.toBe(error);
    expect(messages).toEqual(before);
  });
});
