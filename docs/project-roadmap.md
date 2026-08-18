# Project Roadmap

`mini-harness` is a local CLI coding agent. The production-hardening implementation is complete locally; the roadmap records the delivered baseline and the one remaining release-verification step.

## Completed production hardening

- The REPL moved to `src/cli/index.ts`; application logic moved to `src/core/`, making the core independently testable.
- Vitest tests cover agent behavior, retry logic, config validation, permission decisions, and filesystem containment.
- GitHub Actions is configured to run dependency installation, typechecking, formatting, and tests for pushes and pull requests; a real remote run remains pending until the changes are committed and pushed.
- Pino provides structured stderr logs. `LOG_LEVEL` defaults to `info`; full tool inputs, outputs, and permission responses are debug-only.
- Bedrock Converse calls use capped exponential backoff with jitter for known transient service and connection failures, up to four total attempts.
- Startup checks warn about malformed explicitly supplied AWS regions and non-inference-profile model IDs before accepting REPL input. They are warnings, not credential or network validation.
- The existing filesystem sandbox, exact-call permission gate, sequential tool dispatch, command timeout/process-tree termination, and agent-history rollback remain enforced and tested where applicable.

## Follow-on opportunities

- Add an `edit_file` tool if full-file overwrite proves too coarse.
- Stream model responses if response latency becomes a user-facing problem.
- Add an explicit preflight mode only if validating AWS credentials or model access before the first request becomes necessary; it would need to define acceptable network and credential-provider behavior.
- Broaden CI only when new platform or release requirements justify it.

## Out of scope

- Multi-provider/model support beyond AWS Bedrock.
- A hosted, multi-user service or web UI.
- OS-level sandboxing. Filesystem containment protects file tools; `run_command` remains powerful by design and relies on explicit permission.

See [the PDR](./project-overview-pdr.md) for product requirements and [the architecture](./system-architecture.md) for runtime boundaries.
