export interface ToolDefinition {
  name: string;
  description: string;
  // JSON Schema describing the tool's input, sent to the model as-is.
  inputSchema: Record<string, unknown>;
  // Read-only tools skip the permission gate; anything that writes or
  // executes goes through permissions.ts.
  requiresPermission: boolean;
  execute(input: any): Promise<string>;
}
