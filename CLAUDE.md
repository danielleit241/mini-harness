# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A from-scratch agentic CLI harness (Claude-Code-style tool-use loop), built as a long-term learning project for understanding how agent harnesses work internally — not a production tool. Despite the name, "mini" refers to its origin, not an intended scope ceiling; the project is expected to grow. Prioritize code that's easy to read and extend, and prefer comments that explain *why* (non-obvious constraints, invariants) over *what* the code does.

## Commands

```bash
npm install
cp .env.example .env    # set AWS_REGION / BEDROCK_MODEL_ID
npm start                # run the REPL (tsx src/index.ts)
npm run typecheck        # tsc --noEmit
npm run format            # prettier --write .
npm run format:check
```

No test suite exists yet. There is no build/dist step for running — `npm start` runs TypeScript directly via `tsx`.

AWS credentials are picked up from the standard AWS SDK credential chain (env vars, `~/.aws/credentials`, SSO) — never hardcode credentials in source. The target Bedrock model must have model access enabled in the AWS console for `AWS_REGION`.

## Architecture

The core idea: the model doesn't answer in one shot — it can request **tools**, see results, and decide what to do next, looping until it produces a final text answer. Everything hangs off one shared `messages: Message[]` array (Bedrock Converse message format) that persists for the life of the REPL process.

**Request flow**: `src/index.ts` (REPL) → `src/agent.ts` (`runAgent`, the loop) → `src/bedrock.ts` (`converse`, one round-trip via `ConverseCommand`) → back to `agent.ts` to inspect `stopReason`/`toolUse` blocks → `src/tools/index.ts` (`executeTool`) → `src/permissions.ts` for gated tools → result fed back into `messages` → loop continues until `stopReason` isn't `tool_use`.

Key invariants to preserve when touching `agent.ts`:
- **Bedrock requires `messages` to strictly alternate `user`/`assistant`.** Any code path that can throw between pushing a `user` message and pushing the matching `assistant` reply must roll the array back (see the `try`/`catch` + `turnStart` pattern in `runAgent`), or every subsequent call breaks for the rest of the session.
- **`MAX_TOOL_ITERATIONS`** bounds the tool-use loop — a model retrying a failing tool must not be able to loop forever.
- Tool calls within one assistant turn are executed **sequentially, not in parallel** — permission prompts share a single readline interface (`src/prompt.ts`) and must be asked one at a time.

**Tool registry pattern** (`src/tools/`): each tool is one `ToolDefinition` object (`src/tools/types.ts`) — name, description, JSON Schema input, `requiresPermission` flag, `execute(input)`. The registry array in `src/tools/index.ts` is the single place tools are wired in; `toBedrockTools()` converts it to the Converse API's `toolConfig.tools` shape, and `executeTool()` is the only place that runs a tool by name (permission gate → execute → format as a `toolResult` content block), so `agent.ts` never touches tool internals directly. To add a tool: define it under `src/tools/`, add it to the `registry` array — nothing else needs to change.

**Permissions** (`src/permissions.ts`): gated tools (`write_file`, `run_command`) prompt `y`/`a`/`n` via `src/prompt.ts`. "Always allow" (`a`) is scoped to the exact `toolName:JSON(input)` pair, not the whole tool — approving one shell command must not silently authorize every future one.

**Filesystem sandbox** (`src/tools/fs.ts`): `resolveInWorkdir` confines all file tool paths to the directory the harness was started in, via two checks — a lexical check (blocks `..`/absolute paths) and a symlink-resolution check on the nearest existing ancestor (blocks a symlink inside the workdir that points outside it). Any new filesystem tool must go through this function.

**Shell execution** (`src/tools/bash.ts`): commands run with a timeout that kills the whole process tree (not just the direct child — `taskkill /T /F` on Windows, process-group `SIGKILL` on POSIX), and output is capped rather than unbounded.

**Readline lifecycle** (`src/prompt.ts`): a single shared `readline` interface serves both the main REPL and permission prompts. On stdin close (EOF/Ctrl+D), subsequent `ask()` calls throw `ReadlineClosedError` rather than letting the process hard-exit mid-operation; callers (`index.ts`, `permissions.ts`) catch it to shut down or fail-safe (deny) cleanly.
