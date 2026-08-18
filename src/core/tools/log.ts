import { logger } from "../logger.js";

export function logToolOutcome(
  tool: string,
  startedAt: number,
  success: boolean,
  error?: unknown
): void {
  logger.info(
    {
      tool,
      success,
      durationMs: Date.now() - startedAt,
      ...(error === undefined
        ? {}
        : error instanceof Error
          ? { errorName: error.name, errorMessage: error.message }
          : { errorMessage: String(error) }),
    },
    "tool execution completed"
  );
}
