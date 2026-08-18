import { describe, expect, it } from "vitest";
import { estimateContextChars, trimHistory } from "../../src/core/history.js";

function userMsg(text: string) {
  return { role: "user" as const, content: [{ text }] };
}

function assistantMsg(text: string) {
  return { role: "assistant" as const, content: [{ text }] };
}

describe("trimHistory", () => {
  it("returns the same reference when under the limit", () => {
    const messages = [userMsg("hi"), assistantMsg("hello")];
    const turnStarts = [0];

    const result = trimHistory(messages, turnStarts, 20);

    expect(result.messages).toBe(messages);
    expect(result.turnStarts).toBe(turnStarts);
  });

  it("returns the same reference when exactly at the limit", () => {
    const messages = [userMsg("a"), assistantMsg("b"), userMsg("c"), assistantMsg("d")];
    const turnStarts = [0, 2];

    const result = trimHistory(messages, turnStarts, 2);

    expect(result.messages).toBe(messages);
    expect(result.turnStarts).toEqual([0, 2]);
  });

  it("drops the oldest whole turns and re-indexes the rest", () => {
    // 3 turns: turn 0 spans [0,2), turn 1 spans [2,4), turn 2 spans [4,6)
    const messages = [
      userMsg("t0"),
      assistantMsg("t0 reply"),
      userMsg("t1"),
      assistantMsg("t1 reply"),
      userMsg("t2"),
      assistantMsg("t2 reply"),
    ];
    const turnStarts = [0, 2, 4];

    const result = trimHistory(messages, turnStarts, 2);

    expect(result.messages).toEqual([
      userMsg("t1"),
      assistantMsg("t1 reply"),
      userMsg("t2"),
      assistantMsg("t2 reply"),
    ]);
    expect(result.turnStarts).toEqual([0, 2]);
    // Every retained turn boundary still lands on a user message.
    for (const start of result.turnStarts) {
      expect(result.messages[start].role).toBe("user");
    }
  });

  it("never splits a turn that contains a tool_use/tool_result round", () => {
    // turn 0: user -> assistant(tool_use) -> user(tool_result) -> assistant(text)
    const toolTurn = [
      userMsg("read a file"),
      {
        role: "assistant" as const,
        content: [{ toolUse: { toolUseId: "1", name: "read_file", input: {} } }],
      },
      {
        role: "user" as const,
        content: [
          {
            toolResult: {
              toolUseId: "1",
              status: "success" as const,
              content: [{ text: "ok" }],
            },
          },
        ],
      },
      assistantMsg("done"),
    ];
    const nextTurn = [userMsg("t1"), assistantMsg("t1 reply")];
    const messages = [...toolTurn, ...nextTurn];
    const turnStarts = [0, 4];

    const result = trimHistory(messages, turnStarts, 1);

    // Keeping only the most recent turn must not include a dangling
    // tool_result from the dropped turn.
    expect(result.messages).toEqual(nextTurn);
    expect(result.turnStarts).toEqual([0]);
  });

  it("is idempotent once at the limit", () => {
    const messages = [
      userMsg("t0"),
      assistantMsg("t0 reply"),
      userMsg("t1"),
      assistantMsg("t1 reply"),
      userMsg("t2"),
      assistantMsg("t2 reply"),
    ];
    const once = trimHistory(messages, [0, 2, 4], 2);
    const twice = trimHistory(once.messages, once.turnStarts, 2);

    expect(twice.messages).toEqual(once.messages);
    expect(twice.turnStarts).toEqual(once.turnStarts);
  });

  it("rejects a non-positive or non-integer maxTurns", () => {
    const messages = [userMsg("hi"), assistantMsg("hello")];
    expect(() => trimHistory(messages, [0], 0)).toThrow(/positive integer/);
    expect(() => trimHistory(messages, [0], -1)).toThrow(/positive integer/);
    expect(() => trimHistory(messages, [0], 1.5)).toThrow(/positive integer/);
  });

  it("throws instead of silently corrupting history if a boundary doesn't land on a user message", () => {
    // turnStarts[1] = 1 points at an assistant message, not user — a
    // caller bug (mismatched bookkeeping), not a valid input.
    const messages = [userMsg("t0"), assistantMsg("t0 reply"), assistantMsg("bad turn")];
    expect(() => trimHistory(messages, [0, 1], 1)).toThrow(/expected a user message/);
  });
});

describe("estimateContextChars", () => {
  it("grows as messages are added", () => {
    const empty = estimateContextChars([]);
    const withOne = estimateContextChars([userMsg("hello")]);
    const withTwo = estimateContextChars([userMsg("hello"), assistantMsg("hi there")]);

    expect(empty).toBe(0);
    expect(withOne).toBeGreaterThan(empty);
    expect(withTwo).toBeGreaterThan(withOne);
  });
});
