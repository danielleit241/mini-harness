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

export type AgentEvent =
  | { type: "tool_round_start"; iteration: number; tools: string[] }
  | { type: "tool_result"; iteration: number; name: string; status: "success" | "error" }
  | { type: "text"; text: string };

export type AgentEventHandler = (event: AgentEvent) => void;

// A handler that throws must never abort an otherwise-successful turn (it
// would trigger the same rollback as a real Bedrock/tool failure below).
function emit(onEvent: AgentEventHandler | undefined, event: AgentEvent): void {
  try {
    onEvent?.(event);
  } catch (err) {
    logger.warn({ err }, "agent event handler threw");
  }
}

export async function runAgent(
  messages: Message[],
  userInput: string,
  systemPrompt: string = DEFAULT_SYSTEM_PROMPT,
  onEvent?: AgentEventHandler
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

      // Narrows out blocks without a toolUse so downstream code never
      // needs a non-null assertion on `block.toolUse`.
      const toolUses = (message.content ?? []).flatMap((b) =>
        b.toolUse ? [b.toolUse] : []
      );

      if (stopReason === "tool_use" && toolUses.length > 0) {
        const toolNames = toolUses.map((use) => use.name ?? "unknown_tool");
        logger.info(
          { iteration: i + 1, tools: toolNames },
          "agent tool-use round started"
        );
        emit(onEvent, { type: "tool_round_start", iteration: i + 1, tools: toolNames });

        // toolUseId correlates a result back to its call; without it there is
        // no valid toolResult to send back. Check every call in the round
        // before running any of them — checking inside the loop below would
        // let an earlier tool (e.g. write_file) execute a real side effect
        // before a later one in the same round fails this check, and turn
        // rollback can't undo a file write or shell command that already ran.
        const missingId = toolUses.find((use) => !use.toolUseId);
        if (missingId) {
          throw new Error(
            `Tool call for "${missingId.name ?? "unknown_tool"}" is missing a toolUseId.`
          );
        }

        // Sequential, not Promise.all: permission prompts share one readline
        // interface and are clearer to the user one at a time.
        const resultBlocks = [];
        for (const use of toolUses) {
          const name = use.name ?? "unknown_tool";
          const result = await executeTool(name, use.input, use.toolUseId!);
          resultBlocks.push(result);
          emit(onEvent, {
            type: "tool_result",
            iteration: i + 1,
            name,
            status: result.toolResult?.status === "error" ? "error" : "success",
          });
        }
        messages.push({ role: "user", content: resultBlocks });
        continue; // give the model the results and let it decide what's next
      }

      logger.info({ stopReason, iteration: i + 1 }, "agent turn completed");
      const text = (message.content ?? [])
        .map((b) => b.text)
        .filter((t): t is string => Boolean(t))
        .join("\n");
      // `text` mirrors the resolved return value, not additional content —
      // a consumer that prints both the event and the return value would
      // double-print. No terminal event is emitted on the error/rollback
      // path (see catch below): a `tool_round_start` may go unmatched.
      emit(onEvent, { type: "text", text });
      return text;
    }

    throw new Error(
      `Agent hit the ${MAX_TOOL_ITERATIONS}-tool-call limit for this turn without finishing.`
    );
  } catch (err) {
    messages.length = turnStart;
    throw err;
  }
}
