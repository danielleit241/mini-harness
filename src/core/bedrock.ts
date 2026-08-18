import {
  BedrockRuntimeClient,
  ConverseCommand,
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
  tools: Tool[]
): Promise<ConverseResult> {
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
