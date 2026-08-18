import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { converse } from "../../src/core/bedrock.js";

function asyncIterable<T>(items: T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}

describe("converse (streaming)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("forwards text deltas in order and reassembles the final message", async () => {
    const send = vi.spyOn(BedrockRuntimeClient.prototype, "send").mockResolvedValue({
      stream: asyncIterable([
        { contentBlockStart: { contentBlockIndex: 0, start: {} } },
        { contentBlockDelta: { contentBlockIndex: 0, delta: { text: "Hel" } } },
        { contentBlockDelta: { contentBlockIndex: 0, delta: { text: "lo" } } },
        { contentBlockStop: { contentBlockIndex: 0 } },
        { messageStop: { stopReason: "end_turn" } },
      ]),
    } as never);

    const chunks: string[] = [];
    const result = await converse([], "sys", [], (text) => chunks.push(text));

    expect(chunks).toEqual(["Hel", "lo"]);
    expect(result).toEqual({
      message: { role: "assistant", content: [{ text: "Hello" }] },
      stopReason: "end_turn",
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBeInstanceOf(ConverseStreamCommand);
  });

  it("assembles text from delta events with no preceding contentBlockStart", async () => {
    // Bedrock's ContentBlockStart payload only carries a variant for
    // tool_use/tool_result/image blocks; a plain text block's delta can
    // arrive with no contentBlockStart ever seen for its index.
    vi.spyOn(BedrockRuntimeClient.prototype, "send").mockResolvedValue({
      stream: asyncIterable([
        { contentBlockDelta: { contentBlockIndex: 0, delta: { text: "Hel" } } },
        { contentBlockDelta: { contentBlockIndex: 0, delta: { text: "lo" } } },
        { contentBlockStop: { contentBlockIndex: 0 } },
        { messageStop: { stopReason: "end_turn" } },
      ]),
    } as never);

    const chunks: string[] = [];
    const result = await converse([], "sys", [], (text) => chunks.push(text));

    expect(chunks).toEqual(["Hel", "lo"]);
    expect(result).toEqual({
      message: { role: "assistant", content: [{ text: "Hello" }] },
      stopReason: "end_turn",
    });
  });

  it("throws instead of returning an empty message when the stream produces no content", async () => {
    vi.spyOn(BedrockRuntimeClient.prototype, "send").mockResolvedValue({
      stream: asyncIterable([{ messageStop: { stopReason: "end_turn" } }]),
    } as never);

    await expect(converse([], "sys", [], () => {})).rejects.toThrow("no content blocks");
  });

  it("never forwards toolUse input deltas to onDelta and parses them only at block stop", async () => {
    vi.spyOn(BedrockRuntimeClient.prototype, "send").mockResolvedValue({
      stream: asyncIterable([
        {
          contentBlockStart: {
            contentBlockIndex: 0,
            start: { toolUse: { toolUseId: "t1", name: "read_file" } },
          },
        },
        {
          contentBlockDelta: {
            contentBlockIndex: 0,
            delta: { toolUse: { input: '{"pa' } },
          },
        },
        {
          contentBlockDelta: {
            contentBlockIndex: 0,
            delta: { toolUse: { input: 'th":"a"}' } },
          },
        },
        { contentBlockStop: { contentBlockIndex: 0 } },
        { messageStop: { stopReason: "tool_use" } },
      ]),
    } as never);

    const chunks: string[] = [];
    const result = await converse([], "sys", [], (text) => chunks.push(text));

    expect(chunks).toEqual([]);
    expect(result).toEqual({
      message: {
        role: "assistant",
        content: [
          { toolUse: { toolUseId: "t1", name: "read_file", input: { path: "a" } } },
        ],
      },
      stopReason: "tool_use",
    });
  });

  it("does not retry a mid-stream failure", async () => {
    const send = vi.spyOn(BedrockRuntimeClient.prototype, "send").mockResolvedValue({
      stream: {
        async *[Symbol.asyncIterator]() {
          yield { contentBlockStart: { contentBlockIndex: 0, start: {} } };
          throw new Error("stream broke");
        },
      },
    } as never);

    await expect(converse([], "sys", [], () => {})).rejects.toThrow("stream broke");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("uses ConverseCommand (non-streaming) when onDelta is omitted", async () => {
    const send = vi.spyOn(BedrockRuntimeClient.prototype, "send").mockResolvedValue({
      output: { message: { role: "assistant", content: [{ text: "hi" }] } },
      stopReason: "end_turn",
    } as never);

    const result = await converse([], "sys", []);

    expect(result).toEqual({
      message: { role: "assistant", content: [{ text: "hi" }] },
      stopReason: "end_turn",
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBeInstanceOf(ConverseCommand);
  });
});
