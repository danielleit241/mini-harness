import type { Message } from "@aws-sdk/client-bedrock-runtime";
import { useRef, useState } from "react";
import { runAgent, type AgentEvent } from "../../core/agent.js";
import {
  estimateContextChars,
  trimHistory,
  MAX_HISTORY_TURNS,
} from "../../core/history.js";
import { logger } from "../../core/logger.js";

export interface CompletedLine {
  key: string;
  text: string;
}

let nextLineKey = 0;
function line(text: string): CompletedLine {
  return { key: String(nextLineKey++), text };
}

// Owns the agent turn lifecycle: Bedrock history, streaming/tool-progress
// buffers, and turning one submitted line into a completed transcript entry.
// Kept out of App.tsx so the component tree only renders state, never
// mutates conversation history directly.
export function useAgentSession(exit: () => void) {
  // Plain mutable data, not React state — only ever fed to runAgent/
  // trimHistory, never rendered directly.
  const messages = useRef<Message[]>([]);
  const turnStarts = useRef<number[]>([]);
  // Mirrors the matching state for use inside submit's async continuation,
  // where the state variable captured at call time would otherwise be stale
  // by the time the turn resolves.
  const toolLinesRef = useRef<string[]>([]);
  const streamingTextRef = useRef("");

  const [completedLines, setCompletedLines] = useState<CompletedLine[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [toolLines, setToolLines] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  function pushToolLine(text: string): void {
    toolLinesRef.current = [...toolLinesRef.current, text];
    setToolLines(toolLinesRef.current);
  }

  // A round's own text_delta stream must not bleed into the next round's —
  // flush it into the ordered line buffer before a new tool round starts.
  function flushStreamingText(): void {
    if (streamingTextRef.current) pushToolLine(streamingTextRef.current);
    streamingTextRef.current = "";
    setStreamingText("");
  }

  function onAgentEvent(event: AgentEvent): void {
    if (event.type === "text_delta") {
      streamingTextRef.current += event.text;
      setStreamingText(streamingTextRef.current);
    } else if (event.type === "tool_round_start") {
      flushStreamingText();
      pushToolLine(`→ running: ${event.tools.join(", ")}`);
    } else if (event.type === "tool_result") {
      pushToolLine(
        event.status === "success" ? `  ✓ ${event.name}` : `  ✗ ${event.name} (error)`
      );
    }
  }

  async function submit(value: string): Promise<void> {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (trimmed === "/exit") {
      exit();
      return;
    }

    setCompletedLines((prev) => [...prev, line(`> ${trimmed}`)]);
    setBusy(true);
    streamingTextRef.current = "";
    setStreamingText("");
    toolLinesRef.current = [];
    setToolLines([]);

    const turnStart = messages.current.length;
    try {
      const reply = await runAgent(messages.current, trimmed, undefined, onAgentEvent, {
        stream: true,
      });
      turnStarts.current.push(turnStart);
      const trimmedHistory = trimHistory(
        messages.current,
        turnStarts.current,
        MAX_HISTORY_TURNS
      );
      messages.current = trimmedHistory.messages;
      turnStarts.current = trimmedHistory.turnStarts;
      if (logger.isLevelEnabled("debug")) {
        logger.debug(
          {
            turns: turnStarts.current.length,
            messages: messages.current.length,
            approxContextChars: estimateContextChars(messages.current),
          },
          "history size"
        );
      }
      setCompletedLines((prev) => [
        ...prev,
        ...toolLinesRef.current.map(line),
        line(`\n${reply}\n`),
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Preserve any partial text the model had already streamed before the
      // failure (e.g. a mid-round throttling error) instead of discarding it.
      const partial = streamingTextRef.current;
      setCompletedLines((prev) => [
        ...prev,
        ...toolLinesRef.current.map(line),
        ...(partial ? [line(partial)] : []),
        line(`\n[error] ${message}\n`),
      ]);
    } finally {
      streamingTextRef.current = "";
      setStreamingText("");
      toolLinesRef.current = [];
      setToolLines([]);
      setBusy(false);
    }
  }

  return { completedLines, toolLines, streamingText, busy, submit };
}
