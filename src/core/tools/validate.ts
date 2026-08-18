interface JsonSchemaProperty {
  type?: string;
}

interface ToolJsonSchema {
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

// A tool's inputSchema is sent to the model as a hint, not enforced by
// anything — the model can send malformed JSON regardless of what the schema
// says. Check the declared required fields and string types against the
// actual call before it reaches execute(), so a bad call fails with one
// specific message instead of an opaque TypeError from inside a tool.
export function validateToolInput(
  schema: Record<string, unknown>,
  input: unknown
): string | undefined {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return "Input must be a JSON object.";
  }

  const { properties = {}, required = [] } = schema as ToolJsonSchema;
  const record = input as Record<string, unknown>;

  for (const key of required) {
    if (record[key] === undefined || record[key] === null) {
      return `Missing required field: "${key}"`;
    }
  }

  for (const [key, value] of Object.entries(record)) {
    if (properties[key]?.type === "string" && typeof value !== "string") {
      return `Field "${key}" must be a string.`;
    }
  }

  return undefined;
}
