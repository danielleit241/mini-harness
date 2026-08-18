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

  it("emits tool_round_start, tool_result, and text events in order", async () => {
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
    const events: unknown[] = [];

    await runAgent(messages, "inspect the readme", undefined, (e) => events.push(e));

    expect(events).toEqual([
      { type: "tool_round_start", iteration: 1, tools: ["read_file"] },
      { type: "tool_result", iteration: 1, name: "read_file", status: "success" },
      { type: "text", text: "I read it." },
    ]);
  });

  it("emits an error status tool_result event when a tool call fails", async () => {
    mockedConverse
      .mockResolvedValueOnce(
        response(
          [{ toolUse: { toolUseId: "tool-1", name: "missing_tool", input: {} } }],
          "tool_use"
        )
      )
      .mockResolvedValueOnce(response([{ text: "done" }]));
    const messages: never[] = [];
    const events: unknown[] = [];

    await runAgent(messages, "call a bad tool", undefined, (e) => events.push(e));

    expect(events).toEqual([
      { type: "tool_round_start", iteration: 1, tools: ["missing_tool"] },
      { type: "tool_result", iteration: 1, name: "missing_tool", status: "error" },
      { type: "text", text: "done" },
    ]);
  });

  it("emits one tool_result per tool call, in call order, for a multi-tool round", async () => {
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
            { toolUse: { toolUseId: "tool-2", name: "list_dir", input: { path: "." } } },
          ],
          "tool_use"
        )
      )
      .mockResolvedValueOnce(response([{ text: "done" }]));
    const messages: never[] = [];
    const events: unknown[] = [];

    await runAgent(messages, "run two tools", undefined, (e) => events.push(e));

    expect(events).toEqual([
      { type: "tool_round_start", iteration: 1, tools: ["read_file", "list_dir"] },
      { type: "tool_result", iteration: 1, name: "read_file", status: "success" },
      { type: "tool_result", iteration: 1, name: "list_dir", status: "success" },
      { type: "text", text: "done" },
    ]);
  });

  it("does not lose a successful turn's history when onEvent throws", async () => {
    mockedConverse.mockResolvedValue(response([{ text: "hello" }]));
    const messages: never[] = [];
    const onEvent = () => {
      throw new Error("handler blew up");
    };

    await expect(runAgent(messages, "hi", undefined, onEvent)).resolves.toBe("hello");
    expect(messages).toHaveLength(2);
  });

  it("returns the same result with and without onEvent for the same tool-use turn", async () => {
    const round = () => [
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
      ),
      response([{ text: "I read it." }]),
    ];

    mockedConverse.mockReset();
    mockedConverse.mockResolvedValueOnce(round()[0]).mockResolvedValueOnce(round()[1]);
    const withoutHandler: never[] = [];
    const resultWithout = await runAgent(withoutHandler, "inspect the readme");

    mockedConverse.mockReset();
    mockedConverse.mockResolvedValueOnce(round()[0]).mockResolvedValueOnce(round()[1]);
    const withHandler: never[] = [];
    const resultWith = await runAgent(
      withHandler,
      "inspect the readme",
      undefined,
      () => {}
    );

    expect(resultWith).toBe(resultWithout);
    expect(withHandler).toEqual(withoutHandler);
  });
});
