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
import { trimHistory, MAX_HISTORY_TURNS } from "../../src/core/history.js";
import type { Message } from "@aws-sdk/client-bedrock-runtime";

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

  it("rolls back the whole turn when a tool call is missing a toolUseId", async () => {
    mockedConverse.mockResolvedValueOnce(
      response(
        [{ toolUse: { name: "read_file", input: { path: "README.md" } } }],
        "tool_use"
      )
    );
    const messages = [{ role: "assistant", content: [{ text: "previous" }] }] as never[];
    const before = structuredClone(messages);

    await expect(runAgent(messages, "call with no id")).rejects.toThrow(
      "missing a toolUseId"
    );
    expect(messages).toEqual(before);
  });

  it("runs no tool in the round when a later call is missing a toolUseId", async () => {
    mockedConverse.mockResolvedValueOnce(
      response(
        [
          {
            toolUse: {
              toolUseId: "tool-1",
              name: "write_file",
              input: { path: "should-not-be-written.txt", content: "x" },
            },
          },
          { toolUse: { name: "read_file", input: { path: "README.md" } } },
        ],
        "tool_use"
      )
    );
    const messages = [{ role: "assistant", content: [{ text: "previous" }] }] as never[];
    const before = structuredClone(messages);

    await expect(runAgent(messages, "two tools, second missing id")).rejects.toThrow(
      "missing a toolUseId"
    );
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

  it("keeps a real runAgent+trimHistory loop under the turn cap with valid Bedrock history", async () => {
    // Simulates the src/cli/index.ts wiring: run a real turn, record its
    // start, trim, repeat — well past MAX_HISTORY_TURNS — using the actual
    // runAgent (not a hand-built fixture) so a real desync bug would surface.
    let messages: Message[] = [];
    let turnStarts: number[] = [];
    const totalTurns = MAX_HISTORY_TURNS + 5;
    const toolRoundTurn = 3;

    for (let i = 0; i < totalTurns; i++) {
      if (i === toolRoundTurn) {
        mockedConverse
          .mockResolvedValueOnce(
            response(
              [
                {
                  toolUse: {
                    toolUseId: `tool-${i}`,
                    name: "read_file",
                    input: { path: "README.md" },
                  },
                },
              ],
              "tool_use"
            )
          )
          .mockResolvedValueOnce(response([{ text: `reply ${i}` }]));
      } else {
        mockedConverse.mockResolvedValueOnce(response([{ text: `reply ${i}` }]));
      }

      const turnStart = messages.length;
      const reply = await runAgent(messages, `turn ${i}`);
      expect(reply).toBe(`reply ${i}`);
      turnStarts.push(turnStart);
      ({ messages, turnStarts } = trimHistory(messages, turnStarts, MAX_HISTORY_TURNS));
    }

    expect(turnStarts).toHaveLength(MAX_HISTORY_TURNS);
    for (const start of turnStarts) {
      expect(messages[start].role).toBe("user");
    }
    expect(messages[messages.length - 1].role).toBe("assistant");

    // No orphaned toolResult without its matching toolUse anywhere in the
    // retained window.
    const pendingToolUseIds = new Set<string>();
    for (const message of messages) {
      for (const block of message.content ?? []) {
        if ("toolUse" in block && block.toolUse?.toolUseId) {
          pendingToolUseIds.add(block.toolUse.toolUseId);
        }
        if ("toolResult" in block && block.toolResult?.toolUseId) {
          expect(pendingToolUseIds.has(block.toolResult.toolUseId)).toBe(true);
          pendingToolUseIds.delete(block.toolResult.toolUseId);
        }
      }
    }
  });
});
