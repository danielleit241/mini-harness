import type { Message } from "@aws-sdk/client-bedrock-runtime";
import { runAgent } from "../core/agent.js";
import { validateConfig } from "../core/config.js";
import { ask, rl, ReadlineClosedError } from "../core/prompt.js";

const messages: Message[] = [];

async function main() {
  for (const warning of validateConfig(process.env).warnings) {
    console.error(`[config] ${warning}`);
  }
  console.log("mini-harness — type a message, or /exit to quit.\n");

  while (true) {
    let input: string;
    try {
      input = (await ask("> ")).trim();
    } catch (err) {
      if (err instanceof ReadlineClosedError) break;
      throw err;
    }
    if (!input) continue;
    if (input === "/exit") break;

    try {
      const reply = await runAgent(messages, input);
      console.log(`\n${reply}\n`);
    } catch (err) {
      console.error(`\n[error] ${(err as Error).message}\n`);
    }
  }
  rl.close();
}

main();
