import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import type {
  PermissionAnswer,
  PermissionRequest,
} from "../services/ink-permission-prompter.js";

// "No" listed (and highlighted) first: an accidental Enter — e.g. one typed
// right after submitting the message that triggered this prompt — must
// deny, matching the old readline prompt where anything but an explicit
// y/a answer denied.
const OPTIONS: { label: string; value: PermissionAnswer }[] = [
  { label: "No", value: "no" },
  { label: "Yes, once", value: "yes" },
  { label: "Always (this exact call)", value: "always" },
];

export function PermissionPrompt({
  request,
  onSelect,
}: {
  request: PermissionRequest;
  onSelect: (value: PermissionAnswer) => void;
}) {
  return (
    <Box flexDirection="column">
      <Text>{`\n[permission] agent wants to run "${request.toolName}" with input:`}</Text>
      <Text>{JSON.stringify(request.input, null, 2)}</Text>
      <SelectInput items={OPTIONS} onSelect={(item) => onSelect(item.value)} />
    </Box>
  );
}
