import type { Message } from "@aws-sdk/client-bedrock-runtime";
import { converse } from "./bedrock.js";
import { logger } from "./logger.js";
import { toBedrockTools, executeTool } from "./tools/index.js";

export const DEFAULT_SYSTEM_PROMPT = `You are a coding assistant running in a terminal, with access to tools \
for reading/writing files and running shell commands in the current working directory. \
Use tools when you need information you don't already have or need to make a change; \
otherwise just answer directly. Be concise.`;

const TOOLS = toBedrockTools();

// Safety valve: without this, a model stuck re-trying a failing tool would
// loop forever, burning API calls with no way to interrupt it.
const MAX_TOOL_ITERATIONS = 25;

export async function runAgent(
  messages: Message[],
  userInput: string,
  systemPrompt: string = DEFAULT_SYSTEM_PROMPT
): Promise<string> {
  // Bedrock requires messages to strictly alternate user/assistant. If
  // anything below throws partway through a tool-use round, the array can
  // be left ending in a "user" message, which would break every future call
  // for the rest of the session. Roll the whole turn back on any failure so
  // history always stays valid.
  const turnStart = messages.length;
  messages.push({ role: "user", content: [{ text: userInput }] });

  try {
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const { message, stopReason } = await converse(messages, systemPrompt, TOOLS);
      messages.push(message);

      const toolUseBlocks = (message.content ?? []).filter((b) => b.toolUse);

      if (stopReason === "tool_use" && toolUseBlocks.length > 0) {
        logger.info(
          {
            iteration: i + 1,
            tools: toolUseBlocks.map((block) => block.toolUse?.name),
          },
          "agent tool-use round started"
        );

        // Sequential, not Promise.all: permission prompts share one readline
        // interface and are clearer to the user one at a time.
        const resultBlocks = [];
        for (const block of toolUseBlocks) {
          const { toolUseId, name, input } = block.toolUse!;
          resultBlocks.push(await executeTool(name!, input, toolUseId!));
        }
        messages.push({ role: "user", content: resultBlocks });
        continue; // give the model the results and let it decide what's next
      }

      logger.info({ stopReason, iteration: i + 1 }, "agent turn completed");
      return (message.content ?? [])
        .map((b) => b.text)
        .filter((t): t is string => Boolean(t))
        .join("\n");
    }

    throw new Error(
      `Agent hit the ${MAX_TOOL_ITERATIONS}-tool-call limit for this turn without finishing.`
    );
  } catch (err) {
    messages.length = turnStart;
    throw err;
  }
}
