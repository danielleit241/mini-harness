# mini-harness

A CLI coding agent. It loops a REPL against AWS Bedrock's Converse API
(Anthropic Claude models), giving the model tools to read/write files and
run shell commands in the current working directory, with a permission
gate for anything that mutates state and a sandbox that confines tool
access to the working directory.

## Requirements

- Node.js 22.3+ (ESM, `type: "module"`)
- An AWS account with Bedrock model access enabled in your target region
- AWS credentials available via the standard SDK credential chain (env
  vars, `~/.aws/credentials` profile, SSO, etc.)

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env`:

| Variable                                                            | Required | Default                                     | Notes                                                                                                                     |
| ------------------------------------------------------------------- | -------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `AWS_REGION`                                                        | no       | `us-east-1`                                 | Region with Bedrock model access; startup warns on an implausible format                                                  |
| `BEDROCK_MODEL_ID`                                                  | no       | `anthropic.claude-3-5-sonnet-20241022-v2:0` | Prefer an inference-profile id (e.g. `global.anthropic.claude-sonnet-4-5-20250929-v1:0`), not a bare model id — see below |
| `LOG_LEVEL`                                                         | no       | `info`                                      | Pino verbosity; use `debug` to opt into tool payload details                                                              |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN` | no       | —                                           | Only needed if not using the default credential chain                                                                     |

Startup validation warns about a bare model id or implausible region before
input is accepted. It does not make a network request or validate credentials.

### Checking available models

Most current Claude models on Bedrock only support on-demand invocation
through an inference profile — a bare model id fails with "on-demand
throughput isn't supported." Use a profile id prefixed `global.`, `us.`,
`eu.`, or `apac.` depending on what your account has access to. List what
you have available with the AWS CLI or SDK against the
`bedrock:ListInferenceProfiles` / `bedrock:ListFoundationModels` APIs.

## Running

```bash
npm start
```

This runs `node --env-file=.env --import tsx src/cli/index.tsx` — an Ink
(React-based terminal UI) REPL that reads a line, sends it to the agent
loop, and streams the model's reply as it arrives instead of waiting for
the full response. Type `/exit` or press Ctrl+D to quit.

Structured core audit logs are emitted as JSON lines by pino. Conversational
REPL output remains plain terminal text; at the default `info` level, logs
contain tool names, outcomes, timing, permission decisions, and retry/error
metadata, not file or conversation payloads.

The agent may ask for permission before writing files or running shell
commands, via a select menu ("No" listed and highlighted first, so an
accidental Enter denies rather than approves):

```
[permission] agent wants to run "write_file" with input:
{ "path": "notes.txt", "content": "..." }
> No
  Yes, once
  Always (this exact call)
```

"Always" only re-approves an _identical_ future call (same tool name +
same JSON input) — it does not grant blanket approval for the tool.

## Available tools

| Tool          | Permission required | Description                                               |
| ------------- | ------------------- | --------------------------------------------------------- |
| `read_file`   | no                  | Read a text file, path relative to CWD                    |
| `list_dir`    | no                  | List entries in a directory, path relative to CWD         |
| `write_file`  | yes                 | Create or overwrite a file, path relative to CWD          |
| `run_command` | yes                 | Run a shell command in CWD (30s timeout, 10MB output cap) |

All file paths are resolved and sandboxed to the directory the harness was
started in — see [`docs/system-architecture.md`](./docs/system-architecture.md)
for the containment details.

## Scripts

| Script                 | Command                                               | Purpose                                                                                  |
| ---------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `npm start`            | `node --env-file=.env --import tsx src/cli/index.tsx` | Run the Ink REPL                                                                         |
| `npm run eval`         | `node --env-file=.env --import tsx eval/run.ts`       | Run the mini-eval task set against live Bedrock — see [`eval/tasks.md`](./eval/tasks.md) |
| `npm run typecheck`    | `tsc --noEmit`                                        | Type-check source and tests without emitting                                             |
| `npm test`             | `vitest run`                                          | Run the one-shot test suite                                                              |
| `npm run test:watch`   | `vitest`                                              | Run Vitest in watch mode for development                                                 |
| `npm run format`       | `prettier --write .`                                  | Format the codebase                                                                      |
| `npm run format:check` | `prettier --check .`                                  | Check formatting                                                                         |

GitHub Actions runs typecheck, format:check, and test on every push and pull
request.

## Project layout

```
src/
  cli/
    index.tsx                     Entry point: renders the Ink app
    App.tsx                       Composition root only, no business logic
    components/
      TranscriptView.tsx          Completed lines, tool-progress lines, streaming text
      PermissionPrompt.tsx        Yes/always/no menu for a pending permission request
      PromptInput.tsx             The "> " input row
    hooks/
      use-agent-session.ts        Owns Bedrock history, runAgent(), history trimming
      use-permission-bridge.ts    Registers the Ink prompter, holds pending-request state
    services/
      ink-permission-prompter.ts  Bridges checkPermission() into the rendered prompt
  core/
    agent.ts          Tool-use loop (runAgent), forwards text_delta when streaming
    bedrock.ts        Bedrock Converse/ConverseStream wrapper and retry policy
    config.ts         Startup configuration validation
    logger.ts         Structured pino audit logger
    permissions.ts    Permission gate for mutating tools (pluggable prompter)
    prompt.ts         Lazily-created readline interface, used by the default prompter
    tools/
      types.ts        ToolDefinition interface
      index.ts        Tool registry + dispatch
      fs.ts           read_file / list_dir / write_file
      bash.ts         run_command
      log.ts          Shared tool-outcome audit logging

tests/
  unit/               Security-boundary, retry, and config tests
  integration/        Mocked Bedrock agent-loop tests

eval/
  tasks.md            10-task mini-eval set with expected behavior per task
  run.ts              Runs the task set against live Bedrock (npm run eval)
  results/            Dated pass/fail notes from past eval runs
```

See [`docs/system-architecture.md`](./docs/system-architecture.md) for how
these pieces fit together, and
[`docs/codebase-summary.md`](./docs/codebase-summary.md) for a per-file
breakdown.

## Documentation

- [`docs/system-architecture.md`](./docs/system-architecture.md) — component design and data flow
- [`docs/codebase-summary.md`](./docs/codebase-summary.md) — file-by-file reference
- [`docs/code-standards.md`](./docs/code-standards.md) — conventions used in this codebase

## Security notes

- Tool file access is sandboxed to the working directory (lexical +
  symlink-resolution checks); it is not a full OS-level sandbox.
- `run_command` executes arbitrary shell commands the model requests,
  gated by the permission prompt. Treat "always" approvals accordingly —
  they only cover the exact repeated command.
- AWS credentials are never read or exposed by tool code; the Bedrock SDK
  client handles them via its own credential chain.
