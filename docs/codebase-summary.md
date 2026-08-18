# Codebase Summary

`mini-harness` is a local Node.js CLI coding agent. The REPL is an Ink/React app in `src/cli/`; agent behavior, tools, logging, configuration, and Bedrock integration are in `src/core/`.

## Project metadata

- **name/version**: `mini-harness` 0.1.0 (private)
- **runtime**: Node.js `>=22.3.0`, TypeScript with strict `NodeNext` ESM, `jsx: react-jsx`
- **entry point**: `npm start` runs `src/cli/index.tsx` through `tsx`
- **quality commands**: `npm run typecheck`, `npm test`, and `npm run format:check`
- **dependencies**: AWS Bedrock Runtime SDK, `pino`, `ink`, `react`, `ink-text-input`, `ink-select-input`; Vitest is the test runner
- **CI**: `.github/workflows/ci.yml` runs `npm ci`, typechecking, formatting, and tests on pushes and pull requests using Node 22

## Runtime structure

| Path | Responsibility |
| --- | --- |
| `src/cli/index.tsx` | Prints startup warnings, renders `<App>`. |
| `src/cli/App.tsx` | Composition root only: wires `useAgentSession()` and `usePermissionBridge()` together, handles Ctrl+D, renders `<TranscriptView>`, `<PermissionPrompt>`, `<PromptInput>`. No business logic lives here. |
| `src/cli/hooks/use-agent-session.ts` | Owns Bedrock conversation history, streamed/tool-progress buffers, and `submit()` — the only place that calls `runAgent()` and `trimHistory()`, and recognizes the `/exit` command. |
| `src/cli/hooks/use-permission-bridge.ts` | Registers the Ink permission prompter on mount via `setPermissionPrompter()`, holds the pending-request state, and fail-safe-denies it on unmount. |
| `src/cli/services/ink-permission-prompter.ts` | Non-React bridge: turns a `checkPermission()` call (inside `executeTool()`) into a listener callback that `use-permission-bridge.ts` resolves. |
| `src/cli/components/TranscriptView.tsx` | Renders completed lines (`<Static>`), in-progress tool lines, and streaming text. |
| `src/cli/components/PermissionPrompt.tsx` | Renders a tool-name/input summary plus an `ink-select-input` yes/always/no menu. |
| `src/cli/components/PromptInput.tsx` | The `"> "` prompt row wrapping `ink-text-input`. |
| `src/core/agent.ts` | Runs the Bedrock/tool-use loop with a 25-iteration cap, forwards `text_delta` events for every round, and rolls history back if a turn fails. |
| `src/core/bedrock.ts` | Sends Converse (or, with an `onDelta` callback, ConverseStream) requests and supplies retry classification plus capped exponential-backoff retry with jitter; only the initial send is retried, not stream iteration. |
| `src/core/config.ts` | Validates supplied `AWS_REGION` and `BEDROCK_MODEL_ID` values and returns non-blocking warnings. |
| `src/core/logger.ts` | Exports the shared Pino logger, writing structured logs to stderr; `LOG_LEVEL` defaults to `info`. |
| `src/core/permissions.ts` | Prompts before state-changing tools via a pluggable `PermissionPrompter` (`setPermissionPrompter()`); exact-call `always` approvals are session-only. `defaultPrompter` (readline-based) is the fallback used by `eval/run.ts`. |
| `src/core/prompt.ts` | Provides a lazily-created readline interface (`ask()`/`closePrompt()`) and typed closed-stdin error, used only by `defaultPrompter`/`eval/run.ts` now — created on first use so importing this module (transitively, via `core/permissions.ts`) never grabs stdin out from under Ink's raw-mode input. |
| `src/core/tools/` | Defines, registers, dispatches, sandboxes, and audits the four model tools. |

## Agent, tools, and safety boundaries

`runAgent(messages, userInput, systemPrompt?, onEvent?, options?)` appends the user message, calls Bedrock via `converse()`, processes sequential `tool_use` rounds, then returns joined text. It resets `messages` to its pre-turn length on any failure, preserving Bedrock's required role alternation. `options.stream` is an explicit opt-in (default `false`), not inferred from `onEvent`'s presence — `eval/run.ts` passes its own `onEvent` for tool-progress logging but omits `stream`, so it keeps calling `ConverseCommand` exactly as before; only `src/cli/hooks/use-agent-session.ts` passes `stream: true`. When streaming is on, the optional `onEvent` callback also receives `text_delta` events — one per text chunk, for every round, not just the final one — so a caller can render output live instead of waiting for the final return value; a throwing handler is caught and logged, never allowed to roll back an otherwise-successful turn. `use-agent-session.ts` uses it to stream text incrementally and print `→ running: <tools>` / `✓`/`✗` lines during a tool-use round.

`src/core/tools/index.ts` exposes the registry as Bedrock tools and turns unknown tools, denied requests, and tool failures into `toolResult` error blocks. `read_file` and `list_dir` are read-only; `write_file` and `run_command` require permission.

`resolveInWorkdir()` in `src/core/tools/fs.ts` rejects lexical and symlink escapes, including a final dangling symlink. `run_command` runs in the process working directory, caps collected output at 10 MiB, and kills the process tree after 30 seconds.

## Resilience and observability

Bedrock retries only `ThrottlingException`, `ServiceUnavailableException`, `ModelTimeoutException`, `ECONNRESET`, and `ETIMEDOUT`. The default is at most four attempts, beginning with a 500 ms exponential delay plus up to 500 ms jitter and capped at 8 seconds. Other failures return immediately.

Pino logs tool completion, permission decisions, tool-use rounds, completed agent turns, and Bedrock failures. Tool inputs, outputs, and permission responses are debug-only; info-level audit records contain metadata rather than full payloads.

At startup, `validateConfig(process.env)` warns when a supplied model ID does not begin with `global.`, `us.`, `eu.`, or `apac.`, or when a supplied region does not resemble an AWS region. Unset values do not warn because the Bedrock module has defaults; this check neither validates credentials nor calls AWS.

## Tests and configuration

Vitest covers agent text, tool-use behavior, and `text_delta` streaming events; history rollback; permission-cache scope and prompter injection; Bedrock streaming (mocking `BedrockRuntimeClient.prototype.send`, including that a mid-stream failure is not retried); config warnings; retry classification/backoff/attempt limits; and lexical plus symlink containment. Bedrock and prompt boundaries are mocked where a test must avoid network access or interactive stdin. **Known gap**: the Ink UI layer (`src/cli/App.tsx` and `src/cli/components/`, `hooks/`, `services/`) has no automated test coverage this round (`ink-testing-library` was explicitly deferred) — its only verification is a manual `npm start` smoke test on a real terminal.

`.env.example` documents `AWS_REGION`, `BEDROCK_MODEL_ID`, `LOG_LEVEL`, and AWS SDK credentials. Credentials use the SDK's standard provider chain; the start command loads `.env` with Node's `--env-file` flag.
