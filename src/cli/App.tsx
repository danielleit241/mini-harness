import { Box, useApp, useInput } from "ink";
import { useState } from "react";
import { PermissionPrompt } from "./components/PermissionPrompt.js";
import { PromptInput } from "./components/PromptInput.js";
import { TranscriptView } from "./components/TranscriptView.js";
import { useAgentSession } from "./hooks/use-agent-session.js";
import { usePermissionBridge } from "./hooks/use-permission-bridge.js";

// Composition root: wires the two independent concerns (agent turns,
// permission UI) into one render tree. No business logic lives here.
export function App() {
  const { exit } = useApp();
  const [input, setInput] = useState("");
  const { pending, respond } = usePermissionBridge();
  const session = useAgentSession(exit);

  useInput((char, key) => {
    if (key.ctrl && char === "d") exit();
  });

  function handleSubmit(value: string): void {
    setInput("");
    void session.submit(value);
  }

  return (
    <Box flexDirection="column">
      <TranscriptView
        completedLines={session.completedLines}
        toolLines={session.toolLines}
        streamingText={session.streamingText}
      />
      {pending && <PermissionPrompt request={pending.request} onSelect={respond} />}
      {!session.busy && !pending && (
        <PromptInput value={input} onChange={setInput} onSubmit={handleSubmit} />
      )}
    </Box>
  );
}
