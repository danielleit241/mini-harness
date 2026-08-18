import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  type ContentBlock,
  type Message,
  type Tool,
} from "@aws-sdk/client-bedrock-runtime";
import { logger } from "./logger.js";

const REGION = process.env.AWS_REGION ?? "us-east-1";
const MODEL_ID =
  process.env.BEDROCK_MODEL_ID ?? "anthropic.claude-3-5-sonnet-20241022-v2:0";

const client = new BedrockRuntimeClient({ region: REGION });

const RETRYABLE_ERROR_NAMES = new Set([
  "ThrottlingException",
  "ServiceUnavailableException",
  "ModelTimeoutException",
]);
const RETRYABLE_ERROR_CODES = new Set(["ECONNRESET", "ETIMEDOUT"]);

const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 8_000;

type Sleep = (delayMs: number) => Promise<void>;

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: Sleep;
  random?: () => number;
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function errorDetails(error: unknown): { name: string; message: string } {
  if (error instanceof Error) return { name: error.name, message: error.message };
  if (typeof error === "object" && error !== null) {
    const value = error as { name?: unknown; message?: unknown };
    return {
      name: typeof value.name === "string" ? value.name : "UnknownError",
      message: typeof value.message === "string" ? value.message : String(error),
    };
  }
  return { name: "UnknownError", message: String(error) };
}

export function isRetryable(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const value = error as { name?: unknown; code?: unknown };
  return (
    (typeof value.name === "string" && RETRYABLE_ERROR_NAMES.has(value.name)) ||
    (typeof value.code === "string" && RETRYABLE_ERROR_CODES.has(value.code))
  );
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS);
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const attemptNumber = attempt + 1;
      if (attemptNumber >= maxAttempts || !isRetryable(error)) throw error;

      const jitter = Math.min(1, Math.max(0, random())) * baseDelayMs;
      const delayMs = Math.min(
        maxDelayMs,
        baseDelayMs * 2 ** (attemptNumber - 1) + jitter
      );
      const details = errorDetails(error);
      logger.warn(
        {
          attempt: attemptNumber,
          nextAttempt: attemptNumber + 1,
          delayMs,
          errorName: details.name,
        },
        "retrying Bedrock request"
      );
      await sleep(delayMs);
    }
  }
}

export interface ConverseResult {
  message: Message;
  stopReason: string | undefined;
}

// One round-trip to the model: full conversation history in, one assistant
// message out. The agent loop in agent.ts decides what to do with the result.
export async function converse(
  messages: Message[],
  systemPrompt: string,
  tools: Tool[],
  onDelta?: (text: string) => void
): Promise<ConverseResult> {
  if (onDelta) return converseStreaming(messages, systemPrompt, tools, onDelta);

  const command = new ConverseCommand({
    modelId: MODEL_ID,
    messages,
    system: [{ text: systemPrompt }],
    toolConfig: tools.length > 0 ? { tools } : undefined,
  });

  const response = await withRetry(async () => {
    try {
      return await client.send(command);
    } catch (err) {
      const details = errorDetails(err);
      logger.error(
        {
          errorName: details.name,
          errorMessage: details.message,
        },
        "Bedrock Converse request failed"
      );
      throw err;
    }
  });

  if (!response.output?.message) {
    throw new Error("Bedrock response had no message in output");
  }

  return {
    message: response.output.message,
    stopReason: response.stopReason,
  };
}

// Per-block accumulation while a ConverseStreamCommand response is iterated:
// text blocks buffer their text, toolUse blocks buffer the partial-JSON
// input string; it's parsed once as a whole after the stream ends, never
// per-delta.
interface StreamBlock {
  kind: "text" | "toolUse";
  text: string;
  toolUseId?: string;
  name?: string;
  inputJson: string;
}

async function converseStreaming(
  messages: Message[],
  systemPrompt: string,
  tools: Tool[],
  onDelta: (text: string) => void
): Promise<ConverseResult> {
  const command = new ConverseStreamCommand({
    modelId: MODEL_ID,
    messages,
    system: [{ text: systemPrompt }],
    toolConfig: tools.length > 0 ? { tools } : undefined,
  });

  const response = await withRetry(async () => {
    try {
      return await client.send(command);
    } catch (err) {
      const details = errorDetails(err);
      logger.error(
        {
          errorName: details.name,
          errorMessage: details.message,
        },
        "Bedrock ConverseStream request failed"
      );
      throw err;
    }
  });

  if (!response.stream) {
    throw new Error("Bedrock response had no stream in output");
  }

  const blocks = new Map<number, StreamBlock>();
  let stopReason: string | undefined;

  // Mid-stream failures (thrown while iterating) are not retried here: only
  // the initial client.send() above is wrapped in withRetry.
  for await (const event of response.stream) {
    if (event.contentBlockStart) {
      const { start, contentBlockIndex } = event.contentBlockStart;
      if (contentBlockIndex === undefined) continue;
      if (start?.toolUse) {
        blocks.set(contentBlockIndex, {
          kind: "toolUse",
          text: "",
          toolUseId: start.toolUse.toolUseId,
          name: start.toolUse.name,
          inputJson: "",
        });
      } else {
        blocks.set(contentBlockIndex, { kind: "text", text: "", inputJson: "" });
      }
    } else if (event.contentBlockDelta) {
      const { delta, contentBlockIndex } = event.contentBlockDelta;
      if (contentBlockIndex === undefined) continue;
      // contentBlockStart only carries a payload for tool_use/tool_result/image
      // blocks; a plain text block's delta can arrive without one ever being
      // seen, so create the block here too rather than assuming start always
      // precedes delta.
      let block = blocks.get(contentBlockIndex);
      if (!block) {
        block = { kind: delta?.toolUse ? "toolUse" : "text", text: "", inputJson: "" };
        blocks.set(contentBlockIndex, block);
      }
      if (delta?.text !== undefined) {
        block.text += delta.text;
        onDelta(delta.text);
      } else if (delta?.toolUse?.input !== undefined) {
        block.inputJson += delta.toolUse.input;
      }
    } else if (event.messageStop) {
      stopReason = event.messageStop.stopReason;
    }
  }

  const content: ContentBlock[] = [];
  for (const index of Array.from(blocks.keys()).sort((a, b) => a - b)) {
    const block = blocks.get(index)!;
    if (block.kind === "text") {
      if (block.text) content.push({ text: block.text });
    } else {
      let input;
      try {
        input = block.inputJson ? JSON.parse(block.inputJson) : {};
      } catch (err) {
        throw new Error(
          `Bedrock stream produced unparseable tool input JSON for "${block.name ?? "unknown_tool"}" (toolUseId ${block.toolUseId ?? "unknown"}): ${(err as Error).message}`
        );
      }
      content.push({
        toolUse: { toolUseId: block.toolUseId, name: block.name, input },
      });
    }
  }

  if (content.length === 0) {
    throw new Error("Bedrock stream produced no content blocks");
  }

  return {
    message: { role: "assistant", content },
    stopReason,
  };
}
