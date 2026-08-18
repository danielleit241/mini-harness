# mini-harness — Overview & PDR

## What it is

`mini-harness` is a local CLI coding agent. Its REPL sends user messages to AWS Bedrock's Converse API and gives the model filesystem and shell tools. File access is confined to the working directory, while state-changing actions require an explicit permission decision.

## Goals

- Provide a reliable Bedrock tool-use loop with valid conversation-history recovery.
- Read, list, and write files and run shell commands in the current working directory.
- Require per-call human approval for `write_file` and `run_command`.
- Maintain filesystem containment against lexical and symlink escapes.
- Keep the core independently testable and observable without expanding into a hosted service.

## Non-goals

- Multi-provider or hosted, multi-user operation.
- OS-level sandboxing. `run_command` is intentionally powerful and protected by the permission gate rather than process isolation.
- Persistent conversation history or parallel tool calls.

## Functional requirements

| Requirement | Status | Implementation |
| --- | --- | --- |
| REPL input/output, `/exit`, EOF handling, and startup warnings | Done | `src/cli/index.ts` |
| Bedrock tool-use loop, 25-round safety cap, and history rollback | Done | `src/core/agent.ts` |
| Bedrock Converse call with transient-error retry/backoff | Done | `src/core/bedrock.ts` |
| Non-blocking warnings for malformed supplied region/model configuration | Done | `src/core/config.ts` |
| Shared structured core logging | Done | `src/core/logger.ts` |
| Exact-call, session-scoped permission approvals | Done | `src/core/permissions.ts` |
| Read/list/write filesystem tools with lexical and symlink containment | Done | `src/core/tools/fs.ts` |
| Permission-gated shell command with output cap and process-tree timeout kill | Done | `src/core/tools/bash.ts` |
| Automated unit/integration tests and CI verification | Done | `tests/`, `.github/workflows/ci.yml` |

## Non-functional requirements

- **Filesystem containment**: all filesystem tool paths use `resolveInWorkdir()`, which blocks lexical and symlink-based escapes.
- **Permission safety**: a closed stdin denies permission; `always` approval applies only to the exact `toolName:JSON(input)` call during the current process.
- **Conversation integrity**: any turn failure restores its starting message-history length.
- **Reliability**: only known transient Bedrock failures retry; the default permits at most four attempts with capped exponential backoff and jitter.
- **Observability**: Pino writes structured logs to stderr. Full tool inputs, outputs, and permission responses remain debug-only.
- **Verification**: `npm run typecheck`, `npm test`, and `npm run format:check` must pass; CI runs those checks on pushes and pull requests.

## Acceptance criteria

- `npm start` launches the REPL and displays relevant configuration warnings before input.
- The agent can read/list files and can write files or execute commands only after permission.
- Tool errors and denied permissions become model-visible tool results without crashing the REPL.
- Transient Bedrock failures retry according to the implemented policy; other failures surface immediately.
- The quality commands pass locally and in CI.

## Constraints and dependencies

- Requires AWS Bedrock access and a valid inference-profile model ID for successful model calls.
- AWS credentials are resolved by the AWS SDK credential provider chain.
- Uses Node ESM, the AWS Bedrock Runtime SDK, Pino, and Vitest.

## Production-hardening status

The production-hardening plan is complete for the local-CLI scope: core/CLI separation, Vitest coverage, CI, structured logging, retry/backoff, and startup configuration warnings are all implemented. The warnings deliberately do not validate credentials or model access because doing so would require an AWS interaction.
