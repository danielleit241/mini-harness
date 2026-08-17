import { ask, ReadlineClosedError } from "./prompt.js";

// Keyed by "toolName:JSON(input)", not just toolName — approving one
// run_command call with "always" must not silently authorize every future
// shell command for the rest of the session. Scoping to the exact call
// means "always" only re-approves an identical repeat.
const sessionAllowed = new Set<string>();

function keyFor(toolName: string, input: unknown): string {
  return `${toolName}:${JSON.stringify(input)}`;
}

export async function checkPermission(
  toolName: string,
  input: unknown
): Promise<boolean> {
  const key = keyFor(toolName, input);
  if (sessionAllowed.has(key)) {
    return true;
  }

  console.log(`\n[permission] agent wants to run "${toolName}" with input:`);
  console.log(JSON.stringify(input, null, 2));

  let answer: string;
  try {
    answer = (await ask("  Allow? [y]es once / [a]lways this exact call / [n]o: "))
      .trim()
      .toLowerCase();
  } catch (err) {
    if (err instanceof ReadlineClosedError) return false; // stdin gone: fail safe, deny
    throw err;
  }

  if (answer === "a") {
    sessionAllowed.add(key);
    return true;
  }
  return answer === "y";
}
