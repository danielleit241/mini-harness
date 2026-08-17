import type { Message } from "@aws-sdk/client-bedrock-runtime";
import { runAgent } from "./agent.js";
import { ask, rl, ReadlineClosedError } from "./prompt.js";

const messages: Message[] = [];

console.log("mini-harness — type a message, or /exit to quit.\n");

async function main() {
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
