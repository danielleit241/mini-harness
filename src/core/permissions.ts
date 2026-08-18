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
  console.log(`\n[permission] agent wants to run "${toolName}" with input:`);
  console.log(JSON.stringify(input, null, 2));

  let answer: string;
  try {
    answer = (await ask("  Allow? [y]es once / [a]lways this exact call / [n]o: "))
      .trim()
      .toLowerCase();
  } catch (err) {
    if (err instanceof ReadlineClosedError) {
      logger.info(
        { tool: toolName, allowed: false, cached: false, reason: "stdin_closed" },
        "permission decision"
      );
      return false; // stdin gone: fail safe, deny
    }
    throw err;
  }

  const allowed = answer === "a" || answer === "y";
  if (answer === "a") sessionAllowed.add(key);

  logger.info({ tool: toolName, allowed, cached: false }, "permission decision");
  logger.debug({ tool: toolName, input, answer }, "permission response");
  return allowed;
}
