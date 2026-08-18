import { describe, expect, it, vi } from "vitest";
import { isRetryable, withRetry } from "../../src/core/bedrock.js";

function namedError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

describe("Bedrock retry policy", () => {
  it.each([
    "ThrottlingException",
    "ServiceUnavailableException",
    "ModelTimeoutException",
  ])("classifies %s as retryable", (name) => {
    expect(isRetryable(namedError(name))).toBe(true);
  });

  it.each(["ValidationException", "AccessDeniedException", "Error"])(
    "does not retry %s",
    (name) => {
      expect(isRetryable(namedError(name))).toBe(false);
    }
  );

  it("classifies network reset and timeout codes as retryable", () => {
    expect(isRetryable(Object.assign(new Error("reset"), { code: "ECONNRESET" }))).toBe(
      true
    );
    expect(isRetryable(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }))).toBe(
      true
    );
  });

  it("does not classify unknown errors as retryable", () => {
    expect(isRetryable(new Error("unknown"))).toBe(false);
  });

  it("retries transient failures and returns the eventual value", async () => {
    const transient = namedError("ThrottlingException");
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(transient)
      .mockRejectedValueOnce(transient)
      .mockResolvedValue("ok");
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      withRetry(operation, { baseDelayMs: 10, random: () => 0, sleep })
    ).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 10);
    expect(sleep).toHaveBeenNthCalledWith(2, 20);
  });

  it("stops after four total attempts and preserves the original error", async () => {
    const transient = namedError("ServiceUnavailableException");
    const operation = vi.fn<() => Promise<never>>().mockRejectedValue(transient);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      withRetry(operation, { baseDelayMs: 10, random: () => 0, sleep })
    ).rejects.toBe(transient);
    expect(operation).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it("fails immediately for non-transient errors", async () => {
    const permanent = namedError("ValidationException");
    const operation = vi.fn<() => Promise<never>>().mockRejectedValue(permanent);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      withRetry(operation, { baseDelayMs: 10, random: () => 0, sleep })
    ).rejects.toBe(permanent);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
