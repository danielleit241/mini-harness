import { Static, Text } from "ink";
import type { CompletedLine } from "../hooks/use-agent-session.js";

export function TranscriptView({
  completedLines,
  toolLines,
  streamingText,
}: {
  completedLines: CompletedLine[];
  toolLines: string[];
  streamingText: string;
}) {
  return (
    <>
      <Static items={completedLines}>
        {(item) => <Text key={item.key}>{item.text}</Text>}
      </Static>
      {toolLines.map((text, i) => (
        <Text key={i}>{text}</Text>
      ))}
      {streamingText && <Text>{streamingText}</Text>}
    </>
  );
}
