import {
  BedrockRuntimeClient,
  ConverseCommand,
  type Message,
  type Tool,
} from "@aws-sdk/client-bedrock-runtime";

const REGION = process.env.AWS_REGION ?? "us-east-1";
const MODEL_ID =
  process.env.BEDROCK_MODEL_ID ?? "anthropic.claude-3-5-sonnet-20241022-v2:0";

const client = new BedrockRuntimeClient({ region: REGION });

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

  const response = await client.send(command);

  if (!response.output?.message) {
    throw new Error("Bedrock response had no message in output");
  }

  return {
    message: response.output.message,
    stopReason: response.stopReason,
  };
}
