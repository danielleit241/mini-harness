# mini-harness — Overview & PDR

## What it is

`mini-harness` is a CLI coding agent: a REPL that loops user messages
against AWS Bedrock's Converse API (Anthropic Claude models), giving the
model tools to read/write files and run shell commands in the current
working directory, gated by a permission prompt for anything that mutates
state and confined to that directory by a path sandbox.

It is scoped and built as a real, standalone tool. Its security boundaries
— the working-directory sandbox (`resolveInWorkdir`) and the permission
gate (`checkPermission`) — are first-class product requirements, not
optional polish: they are what make it safe to hand an LLM the ability to
write files and run shell commands at all. Contributions are held to that
standard: correctness, safety, and clean error handling take priority over
adding surface area.

## Problem statement

Giving an LLM the ability to read/write files and run shell commands is
only safe if two things hold: the model's tool access is confined to a
known directory, and anything that mutates state requires explicit human
approval before it executes. `mini-harness` implements a Bedrock Converse
tool-use loop with both of those guarantees built in from the start, in a
codebase small enough to audit in full.

## Goals

- Implement a correct, reliable agent loop against Bedrock's Converse API
  with tool use (`src/agent.ts`, `src/bedrock.ts`), including safe
  recovery from mid-turn errors.
- Provide a working set of tools (file read/write/list, shell exec) the
  model can use to accomplish real tasks in a directory.
- Gate every state-mutating tool call behind an explicit user permission
  prompt, scoped to the exact call rather than the whole tool — this is a
  hard requirement, not a default that may be relaxed.
- Keep tool access sandboxed to the working directory the process was
  started in, with both lexical and symlink-escape checks.
- Keep the codebase auditable: small, single-purpose modules with no
  hidden control flow.

## Non-goals

- Not a multi-model or multi-provider harness — Bedrock/Anthropic only, by
  design.
- Not a full OS-level sandbox — the containment in `tools/fs.ts` blocks
  lexical and symlink path escapes at the filesystem-tool boundary; it is
  not process isolation, and `run_command` relies on the permission gate
  rather than path containment. This is a documented boundary, not an
  oversight (see `docs/system-architecture.md`).
- No persistence across process runs — conversation history lives only in
  the `messages` array for the life of the REPL process.
- No deployment target — this is a local CLI tool, run via `npm start`;
  it is not intended to run as a hosted service.
- No parallel tool execution — tool calls in one turn run sequentially
  because permission prompts share a single readline interface. This is a
  deliberate correctness/clarity trade-off, not a performance gap to fix.

## Users

Whoever runs `npm start` locally with AWS Bedrock access configured. No
multi-user, multi-tenant, or hosted use case exists or is planned.

## Functional requirements

| Requirement | Status | Where |
|---|---|---|
| REPL reads user input, prints agent replies | Done | `src/index.ts` |
| Agent loop calls Bedrock Converse, executes tool_use blocks, loops until text-only reply | Done | `src/agent.ts` |
| Iteration cap prevents infinite tool-call loops | Done | `src/agent.ts` (`MAX_TOOL_ITERATIONS = 25`) |
| Conversation history rolled back on error to preserve Bedrock's strict role alternation | Done | `src/agent.ts` |
| Read/list files relative to CWD, no permission needed | Done | `src/tools/fs.ts` |
| Write files relative to CWD, permission required | Done | `src/tools/fs.ts` |
| Run shell commands, permission required, timeout + output cap, kills full process tree on timeout | Done | `src/tools/bash.ts` |
| Path containment: block `..`/absolute escapes and symlink escapes | Done | `src/tools/fs.ts` (`resolveInWorkdir`) |
| Permission prompt with y/always/no, always-approval scoped to exact call | Done | `src/permissions.ts` |
| `/exit` and Ctrl+D (EOF) both exit cleanly | Done | `src/index.ts`, `src/prompt.ts` |

## Non-functional requirements

- **Security boundary: filesystem sandbox**: every filesystem tool must
  resolve paths through `resolveInWorkdir()`, which blocks both lexical
  (`..`, absolute path) and symlink-based escapes from the working
  directory. This is a required invariant, not a best-effort check.
- **Security boundary: permission gate**: every state-mutating tool
  (`write_file`, `run_command`) must go through `checkPermission()`
  before executing, with "always" approval scoped to the exact call, not
  the tool. No new mutating tool may bypass this gate.
- **Correctness over throughput**: tool calls run sequentially, not in
  parallel, to keep permission prompts unambiguous to the user.
- **Fail-safe permissions**: if stdin closes mid-prompt, permission is
  denied rather than assumed granted (`src/permissions.ts`).
- **No silent corruption of conversation state**: any error during a turn
  rolls the `messages` array back to its state before that turn started,
  preserving Bedrock's required strict user/assistant alternation.
- **Type safety**: TypeScript `strict: true`; `npm run typecheck` must
  pass with zero errors before any change is considered complete.

## Acceptance criteria

- `npm start` launches a working REPL against a configured Bedrock model.
- The model can read a file, list a directory, write a file (with
  permission prompt), and run a shell command (with permission prompt) in
  the current working directory.
- A denied permission or a tool error does not crash the REPL — it's
  reported back to the model or user and the loop continues.
- `npm run typecheck` passes with no errors.

## Constraints & dependencies

- Requires AWS Bedrock access and a valid inference-profile model id (see
  `.env.example` and the root `README.md`).
- Depends on `@aws-sdk/client-bedrock-runtime` for the Converse API; `tsx`
  for running TypeScript directly without a build step.
- Node ESM only (`type: "module"` in `package.json`).

## Production-readiness gaps

Tracked in detail in `docs/project-roadmap.md`. Summary: no automated test
suite, no CI pipeline, no structured logging, no retry/backoff on Bedrock
API calls, and no startup-time validation of required environment
variables. These are treated as gaps to close, not deferred polish —
`docs/project-roadmap.md` orders them by risk.
