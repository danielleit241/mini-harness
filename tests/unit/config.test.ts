import { describe, expect, it } from "vitest";
import { validateConfig } from "../../src/core/config.js";

describe("validateConfig", () => {
  it("accepts unset values because the application has defaults", () => {
    expect(validateConfig({})).toEqual({ warnings: [] });
  });

  it("warns for a bare Bedrock model id", () => {
    const result = validateConfig({
      BEDROCK_MODEL_ID: "anthropic.claude-sonnet",
    });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/inference-profile/i);
  });

  it.each([
    "global.anthropic.claude-sonnet",
    "us.anthropic.claude-sonnet",
    "eu.anthropic.claude-sonnet",
    "apac.anthropic.claude-sonnet",
  ])("accepts an inference-profile model id with the %s prefix", (modelId) => {
    expect(validateConfig({ BEDROCK_MODEL_ID: modelId })).toEqual({ warnings: [] });
  });

  it("warns for an empty or implausible AWS region", () => {
    expect(validateConfig({ AWS_REGION: "" }).warnings).toHaveLength(1);
    expect(validateConfig({ AWS_REGION: "not-a-region" }).warnings).toHaveLength(1);
  });

  it("accepts standard and partitioned AWS regions", () => {
    expect(validateConfig({ AWS_REGION: "us-east-1" })).toEqual({ warnings: [] });
    expect(validateConfig({ AWS_REGION: "us-gov-west-1" })).toEqual({ warnings: [] });
  });
});
