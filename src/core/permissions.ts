import { ask, ReadlineClosedError } from "./prompt.js";
import { logger } from "./logger.js";

// Keyed by "toolName:JSON(input)", not just toolName — approving one
// run_command call with "always" must not silently authorize every future
// shell command for the rest of the session. Scoping to the exact call
// means "always" only re-approves an identical repeat.
const sessionAllowed = new Set<string>();

function keyFor(toolName: string, input: unknown): string {
  return `${toolName}:${JSON.stringify(input)}`;
}

export type PermissionPrompter = (
  toolName: string,
  input: unknown
) => Promise<"yes" | "always" | "no">;

// Today's readline-based prompt, kept as the default so eval/run.ts (which
// never calls setPermissionPrompter) behaves exactly as before. ReadlineClosedError
// handling lives here, not in checkPermission(), because it's specific to this
// implementation — a different prompter can fail differently.
export const defaultPrompter: PermissionPrompter = async (toolName, input) => {
  console.log(`\n[permission] agent wants to run "${toolName}" with input:`);
  console.log(JSON.stringify(input, null, 2));

  let answer: string;
  try {
    answer = (await ask("  Allow? [y]es once / [a]lways this exact call / [n]o: "))
      .trim()
      .toLowerCase();
  } catch (err) {
    if (err instanceof ReadlineClosedError) return "no"; // stdin gone: fail safe, deny
    throw err;
  }

  if (answer === "a") return "always";
  if (answer === "y") return "yes";
  return "no";
};

let prompter: PermissionPrompter = defaultPrompter;

export function setPermissionPrompter(fn: PermissionPrompter): void {
  prompter = fn;
}

export async function checkPermission(
  toolName: string,
  input: unknown
): Promise<boolean> {
  const key = keyFor(toolName, input);
  if (sessionAllowed.has(key)) {
    logger.info({ tool: toolName, allowed: true, cached: true }, "permission decision");
    logger.debug({ tool: toolName, input }, "cached permission input");
    return true;
  }

  logger.debug({ tool: toolName, input }, "permission requested");
  const answer = await prompter(toolName, input);

  const allowed = answer === "always" || answer === "yes";
  if (answer === "always") sessionAllowed.add(key);

  logger.info({ tool: toolName, allowed, cached: false }, "permission decision");
  logger.debug({ tool: toolName, input, answer }, "permission response");
  return allowed;
}
