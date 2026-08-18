import type { Message } from "@aws-sdk/client-bedrock-runtime";
import { runAgent, type AgentEvent } from "../core/agent.js";
import { validateConfig } from "../core/config.js";
import { estimateContextChars, trimHistory, MAX_HISTORY_TURNS } from "../core/history.js";
import { logger } from "../core/logger.js";
import { ask, rl, ReadlineClosedError } from "../core/prompt.js";

let messages: Message[] = [];
let turnStarts: number[] = [];

function onAgentEvent(event: AgentEvent): void {
  if (event.type === "tool_round_start") {
    console.log(`→ running: ${event.tools.join(", ")}`);
  } else if (event.type === "tool_result") {
    console.log(
      event.status === "success" ? `  ✓ ${event.name}` : `  ✗ ${event.name} (error)`
    );
  }
}

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

    // Captured before the `await` below; safe only because turns run
    // strictly one at a time in this loop — nothing here reassigns
    // `messages`/`turnStarts` until the current turn finishes.
    const turnStart = messages.length;
    try {
      const reply = await runAgent(messages, input, undefined, onAgentEvent);
      turnStarts.push(turnStart);
      ({ messages, turnStarts } = trimHistory(messages, turnStarts, MAX_HISTORY_TURNS));
      // estimateContextChars stringifies the whole retained history; only
      // pay for that when debug logging is actually on.
      if (logger.isLevelEnabled("debug")) {
        logger.debug(
          {
            turns: turnStarts.length,
            messages: messages.length,
            approxContextChars: estimateContextChars(messages),
          },
          "history size"
        );
      }
      console.log(`\n${reply}\n`);
    } catch (err) {
      console.error(`\n[error] ${(err as Error).message}\n`);
    }
  }
  rl.close();
}

main();
