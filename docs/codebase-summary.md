# Codebase Summary

Per-file reference for `mini-harness`. Total size is small (~350 LOC across
`src/`) — read this alongside the source, not instead of it.

## Project metadata

- **name**: `mini-harness`, `version` 0.1.0, `private: true`
- **type**: `"module"` (ESM throughout)
- **scripts**: `start`, `typecheck`, `format`, `format:check` (see root
  `README.md` for exact commands)
- **dependencies**: `@aws-sdk/client-bedrock-runtime`
- **devDependencies**: `@types/node`, `prettier`, `tsx`, `typescript`
- **tsconfig**: target `ES2022`, module/moduleResolution `NodeNext`,
  `strict: true`, `outDir: dist`, includes `src`
- **tests / CI**: none configured

## `src/index.ts` (31 lines)

Entry point. Builds an empty `Message[]` history, prints a banner, then
loops: read input via `ask("> ")` (from `prompt.ts`), skip empty input,
exit on `/exit`, otherwise call `runAgent(messages, input)` and print the
reply. A `ReadlineClosedError` from `ask()` (stdin EOF) breaks the loop
cleanly; any other per-turn error is caught and logged without crashing
the REPL. Calls `rl.close()` on exit.

## `src/agent.ts` (61 lines)

Core agent loop. Exports `DEFAULT_SYSTEM_PROMPT` and
`runAgent(messages, userInput, systemPrompt = DEFAULT_SYSTEM_PROMPT)`.

- Records `turnStart = messages.length` before pushing the new user
  message, so the array can be rolled back to a valid state on error.
- Loops up to `MAX_TOOL_ITERATIONS = 25` times:
  - Calls `converse(messages, systemPrompt, TOOLS)` (from `bedrock.ts`).
  - Pushes the returned assistant message onto history.
  - If `stopReason === "tool_use"` and the message has `toolUse` blocks,
    executes each one **sequentially** via `executeTool()` (not
    `Promise.all` — permission prompts share one readline interface and
    are clearer one at a time), pushes all results as a single new `user`
    message, and loops again.
  - Otherwise, concatenates all `text` blocks in the final message and
    returns that string.
- If the loop exhausts `MAX_TOOL_ITERATIONS` without a text-only reply, it
  throws.
- On any throw, `messages.length` is reset to `turnStart` before
  re-throwing, so a partially-completed turn never leaves the array ending
  on a `user` message (which would break Bedrock's required strict
  user/assistant alternation on the next call).

## `src/bedrock.ts` (43 lines)

Thin wrapper around `BedrockRuntimeClient` + `ConverseCommand`.

- Reads `AWS_REGION` (default `us-east-1`) and `BEDROCK_MODEL_ID` (default
  `anthropic.claude-3-5-sonnet-20241022-v2:0`) from `process.env`.
- Exports `converse(messages, systemPrompt, tools): Promise<ConverseResult>`
  where `ConverseResult = { message: Message; stopReason: string | undefined }`.
- Throws if the Bedrock response has no `output.message`.
- AWS credentials come from the SDK's standard credential chain (not
  handled by this file directly).

## `src/permissions.ts` (40 lines)

Exports `checkPermission(toolName, input): Promise<boolean>`.

- Caches "always" approvals in a session-scoped `Set<string>` keyed by
  `` `${toolName}:${JSON.stringify(input)}` `` — approving one exact call
  does not approve other calls to the same tool with different input.
- Prints the tool name and JSON-formatted input, then prompts
  `[y]es once / [a]lways this exact call / [n]o`.
- If `ask()` throws `ReadlineClosedError` (stdin gone), permission is
  denied (fail-safe), not thrown further.

## `src/prompt.ts` (21 lines)

- Creates and exports a single shared `readline.Interface` (`rl`) over
  `stdin`/`stdout` — both the REPL and the permission gate read from it,
  and readline needs one owner.
- Exports `ReadlineClosedError` and `ask(question): Promise<string>`,
  which throws that error if called after the interface has closed
  (tracked via the `close` event) instead of letting `rl.question()`'s
  native `ERR_USE_AFTER_CLOSE` crash the process.

## `src/tools/types.ts` (11 lines)

Exports the `ToolDefinition` interface: `name`, `description`,
`inputSchema` (JSON Schema object sent to Bedrock as-is),
`requiresPermission: boolean`, and `execute(input): Promise<string>`.

## `src/tools/index.ts` (73 lines)

- `registry: ToolDefinition[]` — the four tools in order:
  `readFileTool`, `listDirTool`, `writeFileTool`, `runCommandTool`.
- `toBedrockTools(): Tool[]` — maps the registry into Bedrock's
  `toolConfig.tools` shape (`{ toolSpec: { name, description,
  inputSchema } }`).
- `executeTool(name, input, toolUseId): Promise<ContentBlock>` — looks up
  the tool by name (returns an error `toolResult` if unknown), runs
  `checkPermission()` first if `requiresPermission` is true (returns an
  error `toolResult` if denied), then calls `tool.execute(input)` and
  wraps the outcome (success or thrown error) as a Bedrock `toolResult`
  content block. `agent.ts` never touches tool internals directly —
  everything funnels through this function.

## `src/tools/fs.ts` (112 lines)

Three tools, all paths resolved relative to `process.cwd()` (captured once
as `WORKDIR` at module load) via `resolveInWorkdir()`:

1. Lexical check: the resolved path must equal `WORKDIR` or start with
   `WORKDIR + path.sep` — blocks `..` and absolute-path escapes.
2. Symlink check: walks up from the resolved path to the nearest existing
   ancestor, resolves it with `fs.realpath`, and confirms the real path is
   still inside the real workdir — blocks a symlink inside `WORKDIR` that
   points outside it (which the lexical check alone can't catch, since it
   never touches the filesystem).

Tools:

- `read_file` (no permission) — `fs.readFile(path, "utf-8")`.
- `list_dir` (no permission) — `fs.readdir(path, { withFileTypes: true })`,
  returns sorted entries, directories suffixed with `/`.
- `write_file` (permission required) — creates parent directories
  (`fs.mkdir(..., { recursive: true })`), then `fs.writeFile`, returns a
  byte-count confirmation string.

## `src/tools/bash.ts` (85 lines)

`run_command` tool (permission required).

- `TIMEOUT_MS = 30_000`, `MAX_OUTPUT_BYTES = 10 * 1024 * 1024`.
- Runs the command via `child_process.exec` in `process.cwd()`. On POSIX,
  `detached: true` puts the child in its own process group; on Windows,
  `detached` has no such effect (Node passes it through even though it's
  not in `exec`'s TS types).
- On timeout, `killTree()` kills the whole process tree, not just the
  direct child, because `exec`'s own `timeout` option only kills the
  immediate child and a command that backgrounds children would otherwise
  leak them. Windows: `taskkill /pid <pid> /T /F`. POSIX:
  `process.kill(-pid, "SIGKILL")` (negative pid targets the process
  group), falling back to `child.kill("SIGKILL")` if that throws.
- stdout/stderr are collected into one buffer, capped at
  `MAX_OUTPUT_BYTES` (further chunks are silently dropped once the cap is
  hit).
- Returns a timeout message, an error message, or trimmed output
  (`"(no output)"` if empty) — never rejects; errors are captured in the
  resolved `RunResult`.

## Configuration

`.env.example` documents `AWS_REGION`, `BEDROCK_MODEL_ID` (must be an
inference-profile id, not a bare model id — see root `README.md`), and
optional `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN`
for when the default SDK credential chain isn't in use. Loaded via
`node --env-file=.env` in the `start` script — no dotenv package needed.
