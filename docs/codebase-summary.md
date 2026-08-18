# Codebase Summary

`mini-harness` is a local Node.js CLI coding agent. The REPL is a thin adapter in `src/cli/`; agent behavior, tools, logging, configuration, and Bedrock integration are in `src/core/`.

## Project metadata

- **name/version**: `mini-harness` 0.1.0 (private)
- **runtime**: Node.js `>=22.3.0`, TypeScript with strict `NodeNext` ESM
- **entry point**: `npm start` runs `src/cli/index.ts` through `tsx`
- **quality commands**: `npm run typecheck`, `npm test`, and `npm run format:check`
- **dependencies**: AWS Bedrock Runtime SDK and `pino`; Vitest is the test runner
- **CI**: `.github/workflows/ci.yml` runs `npm ci`, typechecking, formatting, and tests on pushes and pull requests using Node 22

## Runtime structure

| Path | Responsibility |
| --- | --- |
| `src/cli/index.ts` | Owns REPL history, prints startup warnings and user-facing output, handles `/exit` and stdin closure. |
| `src/core/agent.ts` | Runs the Bedrock/tool-use loop with a 25-iteration cap and rolls history back if a turn fails. |
| `src/core/bedrock.ts` | Sends Converse requests and supplies retry classification plus capped exponential-backoff retry with jitter. |
| `src/core/config.ts` | Validates supplied `AWS_REGION` and `BEDROCK_MODEL_ID` values and returns non-blocking warnings. |
| `src/core/logger.ts` | Exports the shared Pino logger, writing structured logs to stderr; `LOG_LEVEL` defaults to `info`. |
| `src/core/permissions.ts` | Prompts before state-changing tools; exact-call `always` approvals are session-only. |
| `src/core/prompt.ts` | Provides the shared readline interface and typed closed-stdin error. |
| `src/core/tools/` | Defines, registers, dispatches, sandboxes, and audits the four model tools. |

## Agent, tools, and safety boundaries

`runAgent(messages, userInput, systemPrompt?)` appends the user message, calls Bedrock, processes sequential `tool_use` rounds, then returns joined text. It resets `messages` to its pre-turn length on any failure, preserving Bedrock's required role alternation.

`src/core/tools/index.ts` exposes the registry as Bedrock tools and turns unknown tools, denied requests, and tool failures into `toolResult` error blocks. `read_file` and `list_dir` are read-only; `write_file` and `run_command` require permission.

`resolveInWorkdir()` in `src/core/tools/fs.ts` rejects lexical and symlink escapes, including a final dangling symlink. `run_command` runs in the process working directory, caps collected output at 10 MiB, and kills the process tree after 30 seconds.

## Resilience and observability

Bedrock retries only `ThrottlingException`, `ServiceUnavailableException`, `ModelTimeoutException`, `ECONNRESET`, and `ETIMEDOUT`. The default is at most four attempts, beginning with a 500 ms exponential delay plus up to 500 ms jitter and capped at 8 seconds. Other failures return immediately.

Pino logs tool completion, permission decisions, tool-use rounds, completed agent turns, and Bedrock failures. Tool inputs, outputs, and permission responses are debug-only; info-level audit records contain metadata rather than full payloads.

At startup, `validateConfig(process.env)` warns when a supplied model ID does not begin with `global.`, `us.`, `eu.`, or `apac.`, or when a supplied region does not resemble an AWS region. Unset values do not warn because the Bedrock module has defaults; this check neither validates credentials nor calls AWS.

## Tests and configuration

Vitest covers agent text and tool-use behavior, history rollback, permission-cache scope and stdin-closed denial, config warnings, retry classification/backoff/attempt limits, and lexical plus symlink containment. Bedrock and prompt boundaries are mocked where a test must avoid network access or interactive stdin.

`.env.example` documents `AWS_REGION`, `BEDROCK_MODEL_ID`, `LOG_LEVEL`, and AWS SDK credentials. Credentials use the SDK's standard provider chain; the start command loads `.env` with Node's `--env-file` flag.
