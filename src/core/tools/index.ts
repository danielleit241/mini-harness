import type { ContentBlock, Tool } from "@aws-sdk/client-bedrock-runtime";
import type { DocumentType } from "@smithy/types";
import { logger } from "../logger.js";
import { checkPermission } from "../permissions.js";
import { readFileTool, listDirTool, writeFileTool } from "./fs.js";
import { runCommandTool } from "./bash.js";
import { validateToolInput } from "./validate.js";
import type { ToolDefinition } from "./types.js";

const registry: ToolDefinition[] = [
  readFileTool,
  listDirTool,
  writeFileTool,
  runCommandTool,
];

function errorResult(toolUseId: string, text: string): ContentBlock {
  return { toolResult: { toolUseId, status: "error", content: [{ text }] } };
}

// Converts the internal tool registry into the shape Bedrock's Converse API
// expects in `toolConfig.tools`.
export function toBedrockTools(): Tool[] {
  return registry.map((tool): Tool => ({
    toolSpec: {
      name: tool.name,
      description: tool.description,
      inputSchema: { json: tool.inputSchema as unknown as DocumentType },
    },
  }));
}

// Runs one tool call end-to-end (permission gate -> execute -> format as a
// toolResult content block) so agent.ts never has to know tool internals.
export async function executeTool(
  name: string,
  input: unknown,
  toolUseId: string
): Promise<ContentBlock> {
  const tool = registry.find((t) => t.name === name);
  if (!tool) {
    return errorResult(toolUseId, `Unknown tool: ${name}`);
  }

  const validationError = validateToolInput(tool.inputSchema, input);
  if (validationError) {
    logger.info({ tool: name, reason: validationError }, "tool input rejected");
    return errorResult(toolUseId, `Invalid input: ${validationError}`);
  }

  // checkPermission() and execute() share one try/catch: executeTool()'s
  // contract (see comment above) is to always resolve to a ContentBlock,
  // never reject — a prompter failure (e.g. the Ink UI unmounting mid-turn)
  // must degrade to a denied tool call, not an uncaught rejection that
  // agent.ts would otherwise turn into a whole-turn rollback.
  try {
    if (tool.requiresPermission) {
      const allowed = await checkPermission(tool.name, input);
      if (!allowed) {
        return errorResult(toolUseId, "User denied permission for this action.");
      }
    }

    const result = await tool.execute(input);
    return {
      toolResult: { toolUseId, status: "success", content: [{ text: result }] },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult(toolUseId, `Error: ${message}`);
  }
}
