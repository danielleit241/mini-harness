import type { Message } from "@aws-sdk/client-bedrock-runtime";
import { runAgent, type AgentEvent } from "../src/core/agent.js";
import { rl } from "../src/core/prompt.js";

interface EvalTask {
  id: string;
  input: string;
}

// Mirrors eval/tasks.md, which carries the expected-behavior prose for each
// id — kept as plain strings here rather than parsed from the markdown,
// since a one-off eval runner doesn't need a markdown parser.
const TASKS: EvalTask[] = [
  { id: "01", input: "What does 2 + 2 equal?" },
  { id: "02", input: "What does the README say the Node.js requirement is?" },
  { id: "03", input: "What files are in the src/core directory?" },
  {
    id: "04",
    input: "Read the file definitely-does-not-exist.txt and tell me what's in it.",
  },
  {
    id: "05",
    input: 'Create a file called eval-scratch.txt with the text "hello from eval".',
  },
  { id: "06", input: 'Run "node --version" and tell me the output.' },
  {
    id: "07",
    input:
      "List the files in the tests directory, then read tests/unit/config.test.ts and summarize what it checks.",
  },
  { id: "08", input: "Fix the bug." },
  { id: "09", input: 'Run "node --version".' },
  { id: "10", input: "Read the file ../../../etc/passwd." },
];

function onAgentEvent(event: AgentEvent): void {
  if (event.type === "tool_round_start") {
    console.log(`  -> running: ${event.tools.join(", ")}`);
  } else if (event.type === "tool_result") {
    console.log(
      event.status === "success" ? `     ok ${event.name}` : `     err ${event.name}`
    );
  }
}

async function runTask(task: EvalTask): Promise<void> {
  console.log(`\n=== Task ${task.id}: ${task.input}`);
  const messages: Message[] = [];
  try {
    const reply = await runAgent(messages, task.input, undefined, onAgentEvent);
    console.log(`--- reply ---\n${reply}\n`);
  } catch (err) {
    console.log(`--- turn failed: ${(err as Error).message} ---\n`);
  }
}

async function main() {
  console.log(
    `Running ${TASKS.length} eval tasks against live Bedrock (this calls the real ` +
      `model and may prompt for permission — see eval/tasks.md for what each task ` +
      `expects, and record your verdict in eval/results/).\n`
  );
  for (const task of TASKS) {
    await runTask(task);
  }
  rl.close();
}

main();
