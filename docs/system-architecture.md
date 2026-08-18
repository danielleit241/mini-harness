# System Architecture

## Shape

`mini-harness` is a single-process Node.js CLI. `src/cli/` is the driving adapter; `src/core/` holds application behavior and external-boundary adapters. There is no database, server, or frontend.

```mermaid
flowchart TB
    CLI["src/cli/index.ts\nREPL adapter"] --> CONFIG["core/config.ts"]
    CLI --> PROMPT["core/prompt.ts\nshared readline"]
    CLI --> AGENT["core/agent.ts\ntool-use loop"]
    AGENT --> BEDROCK["core/bedrock.ts\nConverse + retry"]
    AGENT --> DISPATCH["core/tools/index.ts\nregistry and dispatch"]
    DISPATCH --> PERM["core/permissions.ts\npermission gate"]
    DISPATCH --> TOOLS["core/tools/fs.ts\ncore/tools/bash.ts"]
    BEDROCK --> AWS["AWS Bedrock Runtime SDK"]
    TOOLS --> HOST["filesystem / child_process"]
    CLI --> HISTORY["core/history.ts\ntrimHistory / estimateContextChars"]
    AGENT -.-> LOGGER["core/logger.ts\nPino stderr"]
    PERM -.-> LOGGER
    TOOLS -.-> LOGGER
    TESTS["Vitest tests"] -.-> AGENT
    TESTS -.-> BEDROCK
    TESTS -.-> PERM
    TESTS -.-> TOOLS
    TESTS -.-> HISTORY
    EVAL["eval/run.ts"] -.-> AGENT
```

The core does not import `src/cli/` or tests. `prompt.ts` is core because both the CLI and the permission gate need one readline owner.

## Turn flow

1. `src/cli/index.ts` calls `validateConfig(process.env)`, prints returned warnings to stderr, and reads input through `core/prompt.ts`.
2. It passes the shared message array to `runAgent()`.
3. The agent adds the user message and calls `converse()`. A `tool_use` response is dispatched sequentially through `executeTool()` so permission prompts cannot interleave.
4. Tool results are appended as one user message; the loop repeats until text is returned or the 25-round cap is reached. The CLI passes an `onEvent` handler so it can print a progress line per tool call while the round runs, before the final reply prints.
5. A failed turn resets message history to its pre-turn length before rethrowing; the CLI prints the error and continues its REPL.
6. After a successful turn the CLI records the turn's start index and calls `trimHistory()` from `core/history.ts`, which keeps only the last `MAX_HISTORY_TURNS` (20) turns, cutting exclusively at turn boundaries (always a `user` message) so a tool_use/tool_result pair can never be split. This caps turn count, not payload size — a single turn can still hold up to 25 tool rounds of content.

## Security boundaries

`resolveInWorkdir()` in `core/tools/fs.ts` requires a lexical path inside the starting working directory and confirms the nearest existing ancestor stays within its symlink-resolved real path. It also detects a final dangling symlink before a write can follow it outside the workdir.

`write_file` and `run_command` go through `checkPermission()`. An `always` decision is an in-memory cache key of the exact `toolName:JSON(input)` value. `run_command` is not OS-sandboxed: it runs in the process working directory after permission, retains up to 10 MiB of output, and kills its entire process tree after 30 seconds.

## Bedrock, configuration, and logging

`converse()` retries `ThrottlingException`, `ServiceUnavailableException`, `ModelTimeoutException`, `ECONNRESET`, and `ETIMEDOUT`. It makes at most four attempts using exponential backoff from 500 ms, up to 500 ms jitter, and an 8-second delay cap. Validation, access-denied, and unclassified errors do not retry.

`validateConfig()` warns only when explicitly supplied `BEDROCK_MODEL_ID` lacks a supported inference-profile prefix (`global.`, `us.`, `eu.`, or `apac.`) or a supplied `AWS_REGION` is implausible. Defaults are accepted, and no credential or AWS network check occurs at startup.

Pino writes structured core logs to stderr. At `info`, records include event metadata such as tool name, success, duration, retry attempt, and permission decision. Inputs, outputs, and permission responses are debug-only.

## Verification and deployment

Vitest unit and integration tests mock Bedrock or readline where needed and cover the agent loop, retry policy, configuration warnings, permission behavior, workdir containment, and history trimming. GitHub Actions runs `npm ci`, typechecking, formatting, and tests on Node 22 for pushes and pull requests. `eval/run.ts` (`npm run eval`) runs a small fixed task set against live Bedrock through the real permission gate for manual before/after comparison when prompt or agent-loop logic changes; it is not part of CI.

This is a local CLI invoked by `npm start`; it has no deployment artifact, container, or hosted target.

## Extension seams

No plugin system, provider abstraction, or public API exists, by design (see the roadmap's rule-of-three principle). What already supports substitution without new abstraction:

- **Provider boundary**: `core/bedrock.ts` exports a single `converse()` function. Tests replace it wholesale with `vi.mock("../../src/core/bedrock.js")` — no interface or DI container needed because there is exactly one implementation and one consumer (`core/agent.ts`).
- **Tool boundary**: `core/tools/index.ts`'s registry (a plain object keyed by tool name) is the seam for adding a tool — implement the same shape as `core/tools/fs.ts`/`bash.ts` (`name`, `inputSchema`, `execute`) and register it. `executeTool()` already runs schema validation and the permission gate uniformly for any entry, so a new tool gets both for free.
- **Permission gate**: `core/permissions.ts`'s `checkPermission()` is called from one place (`executeTool()`), so swapping the interactive readline prompt for a different policy (e.g. config-driven allow-list) would touch one function, not the call sites.

None of these are formal interfaces — they're single-implementation modules that happen to be easy to replace because each has exactly one call site and one export. **When to add a real seam (a defined interface with ≥2 implementations):** only once a second concrete need exists — e.g. a second model provider actually being wired in, or a plugin loading tools from outside the repo at runtime. Until then, introducing an `interface Provider` or `interface ToolSource` would be speculative abstraction with no second implementation to validate it against, which this roadmap explicitly avoids.
