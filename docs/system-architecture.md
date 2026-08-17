# System Architecture

## Shape

`mini-harness` is a single-process Node.js CLI — no database, no network
server, no frontend. It's a linear pipeline that loops:

```
src/index.ts (REPL)
      │
      ▼
src/agent.ts (tool-use loop)
      │
      ├──► src/bedrock.ts (Converse API call)
      │
      └──► src/tools/index.ts (registry + dispatch)
                  │
                  ├──► src/tools/fs.ts (read_file, list_dir, write_file)
                  │
                  └──► src/tools/bash.ts (run_command)
                            │
                            ▼
                  src/permissions.ts (gate, for mutating tools)
                            │
                            ▼
                  src/prompt.ts (shared stdin)
```

`index.ts` and `permissions.ts` both depend on `prompt.ts` for the single
shared `readline` interface — readline only works cleanly with one owner
of stdin, so both the REPL's input loop and the permission prompts go
through the same `ask()` function.

## Runtime flow (one REPL turn)

1. `index.ts` reads a line from the user via `ask("> ")`.
2. It calls `runAgent(messages, input)` in `agent.ts`, which:
   a. Pushes the user message onto the shared `messages: Message[]` array
      (module-level in `index.ts`, passed by reference into `agent.ts`).
   b. Calls `converse(messages, systemPrompt, TOOLS)` in `bedrock.ts`,
      which sends the full history to Bedrock's `ConverseCommand` and
      returns the assistant's reply plus a `stopReason`.
   c. If the reply's `stopReason` is `tool_use`, it executes every
      `toolUse` block in that message **sequentially** via
      `executeTool()` in `tools/index.ts`, appends all results as one new
      `user` message, and repeats from (b).
   d. Once `stopReason` isn't `tool_use`, it concatenates the reply's text
      blocks and returns that string — ending the turn.
3. `index.ts` prints the returned string and loops back to (1).

The loop is capped at `MAX_TOOL_ITERATIONS = 25` tool-call rounds per turn
as a safety valve against a model stuck retrying a failing tool
indefinitely.

## Tool dispatch

`tools/index.ts` is the single choke point between the agent loop and
tool implementations:

- `toBedrockTools()` converts the internal `ToolDefinition[]` registry
  into the `Tool[]` shape Bedrock expects in `toolConfig.tools`, built
  once at module load (`const TOOLS = toBedrockTools()` in `agent.ts`).
- `executeTool(name, input, toolUseId)` looks up the tool, runs
  `checkPermission()` first if the tool's `requiresPermission` is true,
  executes it, and wraps the outcome as a Bedrock `toolResult`
  `ContentBlock` (success or error). `agent.ts` never imports or calls
  individual tools directly — it only knows about `executeTool`.

This indirection means adding a tool never requires touching `agent.ts`:
register it in `tools/index.ts` and it's automatically exposed to the
model and routed through the permission gate.

## Permission gate

`permissions.ts` sits between tool dispatch and tool execution for any
`ToolDefinition` with `requiresPermission: true` (`write_file`,
`run_command`). It prompts the user via the shared `ask()` and caches
"always" approvals in an in-memory `Set`, keyed by the exact
`toolName:JSON(input)` pair — not by tool name alone. This is a
deliberate boundary: approving one `run_command` call with "always" does
not silently approve a different shell command later in the same session.

The cache is session-scoped (a module-level `Set`, not persisted) and
resets when the process exits.

## Filesystem sandboxing

`tools/fs.ts`'s `resolveInWorkdir()` is the sandboxing boundary for every
filesystem tool. It performs two checks before any tool touches disk:

1. **Lexical containment** — the resolved absolute path must equal
   `WORKDIR` (captured once as `process.cwd()` at module load) or start
   with `WORKDIR + path.sep`. This blocks `..` traversal and absolute
   paths that escape the working directory.
2. **Symlink resolution** — walking up from the resolved path to its
   nearest existing ancestor and resolving that ancestor with
   `fs.realpath`, confirming the real path still lives inside the real
   (symlink-resolved) working directory. This blocks a symlink placed
   inside `WORKDIR` that points somewhere outside it — a case the lexical
   check alone cannot catch, since it never touches the filesystem.

This is process-level containment for tool-initiated file access, not an
OS sandbox. `run_command` in `tools/bash.ts` executes arbitrary shell
commands via `child_process.exec` and is not subject to the same path
containment — it relies entirely on the permission gate.

## Process/timeout handling (`run_command`)

`child_process.exec`'s built-in `timeout` option only kills the direct
child process; a command that spawns or backgrounds its own children (a
long-running server, a detached script) would leak them past the timeout.
`tools/bash.ts` works around this by tracking the child's process tree and
killing the whole tree on timeout: `taskkill /pid <pid> /T /F` on Windows,
`process.kill(-pid, "SIGKILL")` against the process group on POSIX
(falling back to killing just the direct child if that fails). Output is
capped at 10MB to bound memory use from runaway commands.

## Conversation state and error recovery

`messages: Message[]` lives in `index.ts` and is passed by reference into
every `runAgent()` call — it is the entire persisted state of the session
(nothing is written to disk). Bedrock's Converse API requires messages to
strictly alternate `user`/`assistant` roles. If any step inside a turn
throws (a Bedrock API error, an unexpected tool failure that escapes
`executeTool()`'s own error wrapping, etc.), `agent.ts` resets
`messages.length` back to the length recorded at the start of the turn
before re-throwing — so a failed turn never leaves the array ending on an
unpaired `user` message, which would otherwise break every subsequent call
for the rest of the session.

## External dependencies

- **AWS Bedrock Converse API** (`@aws-sdk/client-bedrock-runtime`) — the
  only external network dependency. Credentials come from the SDK's
  standard credential chain; region and model id come from
  `AWS_REGION`/`BEDROCK_MODEL_ID` env vars (see root `README.md`).
- No database, cache, queue, or other backing service.
- No HTTP server — this is a pure stdin/stdout CLI process.

## Deployment

None. This is a local CLI tool invoked via `npm start`; there is no build
artifact, container image, or hosting target defined in the repo.
