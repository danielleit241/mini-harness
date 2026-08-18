import { describe, expect, it } from "vitest";
import { validateToolInput } from "../../src/core/tools/validate.js";

const schema = {
  type: "object",
  properties: {
    path: { type: "string" },
    content: { type: "string" },
  },
  required: ["path", "content"],
};

describe("validateToolInput", () => {
  it("accepts input matching the schema", () => {
    expect(validateToolInput(schema, { path: "a.txt", content: "x" })).toBeUndefined();
  });

  it("rejects non-object input", () => {
    expect(validateToolInput(schema, "not an object")).toMatch(/must be a JSON object/);
    expect(validateToolInput(schema, null)).toMatch(/must be a JSON object/);
    expect(validateToolInput(schema, ["a"])).toMatch(/must be a JSON object/);
  });

  it("rejects input missing a required field", () => {
    expect(validateToolInput(schema, { path: "a.txt" })).toMatch(
      /Missing required field: "content"/
    );
  });

  it("rejects a required field explicitly set to null", () => {
    expect(validateToolInput(schema, { path: "a.txt", content: null })).toMatch(
      /Missing required field: "content"/
    );
  });

  it("rejects a field with the wrong type", () => {
    expect(validateToolInput(schema, { path: 5, content: "x" })).toMatch(
      /Field "path" must be a string/
    );
  });

  it("rejects an array where a string field is required", () => {
    expect(validateToolInput(schema, { path: ["a"], content: "x" })).toMatch(
      /Field "path" must be a string/
    );
  });

  it("rejects undefined input", () => {
    expect(validateToolInput(schema, undefined)).toMatch(/must be a JSON object/);
  });

  it("ignores extra fields not declared in the schema", () => {
    expect(
      validateToolInput(schema, { path: "a.txt", content: "x", extra: 123 })
    ).toBeUndefined();
  });
});
