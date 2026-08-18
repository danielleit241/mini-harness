import type { Message } from "@aws-sdk/client-bedrock-runtime";

// Keep the last N turns of conversation so a long-running REPL session
// doesn't grow indefinitely. This caps *turn count*, not *payload size* — a
// single turn can still hold many large tool results (up to
// MAX_TOOL_ITERATIONS rounds in agent.ts), so this alone doesn't guarantee
// the Bedrock request stays under any particular size. Not tuned against
// real usage data yet — a reasonable starting point per phase-04, to be
// revisited (e.g. a size-based cap using estimateContextChars below) once
// eval/logged history sizes show turn count isn't the bottleneck.
export const MAX_HISTORY_TURNS = 20;

export interface HistoryState {
  messages: Message[];
  turnStarts: number[];
}

// `turnStarts[i]` is the index in `messages` where turn i's user message
// begins (see src/cli/index.ts, which records this before each runAgent
// call). A turn boundary always falls on a user message, so cutting at one
// never splits a tool_use/tool_result pair mid-turn — those pairs live
// entirely within a single turn's message span.
export function trimHistory(
  messages: Message[],
  turnStarts: number[],
  maxTurns: number
): HistoryState {
  if (!Number.isInteger(maxTurns) || maxTurns < 1) {
    throw new Error(`maxTurns must be a positive integer, got ${maxTurns}`);
  }
  if (turnStarts.length <= maxTurns) {
    return { messages, turnStarts };
  }

  const cutIndex = turnStarts[turnStarts.length - maxTurns];
  // A turn boundary is only ever recorded at a user message (see the
  // comment above); if this ever fails, `turnStarts` and `messages` have
  // gone out of sync at the call site and cutting here would send Bedrock
  // an invalid history — fail loudly instead of silently corrupting it.
  if (messages[cutIndex]?.role !== "user") {
    throw new Error(
      `trimHistory: expected a user message at turn boundary ${cutIndex}, got "${messages[cutIndex]?.role}"`
    );
  }

  return {
    messages: messages.slice(cutIndex),
    turnStarts: turnStarts.slice(-maxTurns).map((start) => start - cutIndex),
  };
}

// Rough, not exact — good enough to compare context growth before/after a
// change without adding a tokenizer dependency (phase-04 explicitly doesn't
// need an exact measure).
export function estimateContextChars(messages: Message[]): number {
  return messages.reduce((sum, m) => sum + JSON.stringify(m).length, 0);
}
