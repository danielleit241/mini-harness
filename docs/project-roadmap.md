# Project Roadmap

`mini-harness` is a working CLI coding agent with its core security
boundaries (working-directory sandbox, permission gate) already in place.
This roadmap tracks what's built versus the production-readiness gaps
still open — those gaps are real work items to close, not deferred
polish.

## Current state (done)

- REPL loop over Bedrock's Converse API with tool use (`index.ts`,
  `agent.ts`, `bedrock.ts`).
- Four tools: `read_file`, `list_dir`, `write_file`, `run_command`
  (`src/tools/`).
- Permission gate for mutating tools, scoped to the exact call
  (`permissions.ts`).
- Filesystem sandboxing via lexical + symlink containment checks
  (`tools/fs.ts`).
- Shell command execution with timeout, output cap, and full
  process-tree kill on timeout (`tools/bash.ts`).
- Conversation-state rollback on error to preserve Bedrock's strict
  message alternation (`agent.ts`).
- Clean exit on `/exit` and stdin EOF (`index.ts`, `prompt.ts`).
- TypeScript strict mode, Prettier formatting.

See `docs/project-overview-pdr.md` for the full functional requirements
table and `docs/codebase-summary.md` for file-level detail.

## Production-readiness gaps

These are evidenced by what's absent from the repo today (no test files,
no CI config, no logging framework, no retry logic in `bedrock.ts`, no
env-var validation in any entry point) and are treated as open work, not
hobby-project polish:

1. **No automated test suite.** Nothing verifies `resolveInWorkdir()`'s
   path containment, `checkPermission()`'s caching key, or `agent.ts`'s
   rollback-on-error behavior beyond manual use. These are the highest-
   priority gap: the first two are security boundaries, and a regression
   there is a real vulnerability, not just a bug.
2. **No CI pipeline.** No GitHub Actions (or equivalent) config exists to
   run `npm run typecheck` / `npm run format:check` / a future test suite
   on every push or PR. Without it, a regression in any of the above can
   land on `main` unnoticed.
3. **No structured logging.** `console.log`/`console.error` calls in
   `index.ts` and `permissions.ts` are fine for an interactive REPL but
   give no consistent, parseable record of what the agent did — which
   tools ran, with what input, what Bedrock returned — for later review
   or debugging a bad session.
4. **No retry/backoff on Bedrock API calls.** `bedrock.ts`'s `converse()`
   makes a single `client.send(command)` call with no retry on transient
   failures (throttling, network blips). A single flaky call currently
   ends the turn with an error surfaced to the user instead of being
   retried transparently.
5. **No startup-time config validation.** `AWS_REGION` and
   `BEDROCK_MODEL_ID` fall back to defaults silently if unset
   (`bedrock.ts`); there's no explicit check that confirms the
   configuration is actually usable (e.g. that credentials resolve, that
   the model id is a valid inference-profile id) before the REPL starts
   accepting input. Failures currently surface only on the first Bedrock
   call, mid-session.

## Plausible next steps beyond the gaps above

Not committed, but reasonable given the shape of a CLI agent harness:

- An `edit_file` tool for targeted diffs instead of `write_file`'s
  whole-file overwrite, if that proves limiting in practice.
- Streaming Bedrock responses, if the wait for a full response before any
  output becomes a real usability issue.

## Explicitly out of scope

- Multi-provider/model support beyond Bedrock + Anthropic.
- A hosted or multi-user deployment mode.
- A UI beyond the terminal REPL.
- OS-level process sandboxing beyond the current path-containment checks
  (a documented boundary — see `docs/system-architecture.md` — not a gap
  to silently close).

Revisit this list only if the project's intended use changes materially;
these are deliberate scope boundaries, not gaps.
