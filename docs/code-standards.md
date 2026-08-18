# Code Standards

These conventions describe the implemented `mini-harness` structure and the standards expected of future changes.

## Language, runtime, and quality gates

- TypeScript uses strict `NodeNext` ESM targeting ES2022. Relative imports use explicit `.js` extensions.
- Node.js `>=22.3.0` is required. `tsx` executes the CLI directly; no build artifact is needed to run `npm start`.
- Run `npm run typecheck`, `npm test`, and `npm run format:check` before completion. CI runs the same checks on Node 22 for pushes and pull requests.
- Prettier is the formatting authority; defer to `.prettierrc.json` and `.prettierignore` for its exact rules.

## Module boundaries

- `src/cli/` is the driving adapter (an Ink/React app), layered by concern: `index.tsx` starts it and prints startup warnings; `App.tsx` is a thin composition root with no business logic; `hooks/` owns state and side effects (`use-agent-session.ts` for the conversation loop, `use-permission-bridge.ts` for wiring the permission prompter); `components/` are presentation-only (`TranscriptView.tsx`, `PermissionPrompt.tsx`, `PromptInput.tsx`); `services/ink-permission-prompter.ts` is the non-React bridge into `core/permissions.ts`.
- `src/core/` contains framework-independent application behavior. It must not import the CLI or tests.
- `src/core/tools/` contains tool contracts, registry/dispatch, filesystem tools, and shell execution. The agent calls `executeTool()` rather than individual tools.

## Errors and state integrity

- Tool implementations may throw. `executeTool()` converts unknown tools, denials, and thrown execution errors into Bedrock `toolResult` blocks.
- `runAgent()` restores the conversation array to its pre-turn length on any failure. Code that mutates history inside a turn must preserve this rollback guarantee.
- A closed stdin denies a permission request and ends REPL input cleanly; neither path may default to approval.
- Bedrock retry is deliberately narrow: only documented transient service or connection failures retry. Preserve the maximum-attempt, capped-backoff, and jitter behavior when changing the client boundary.

## Logging and sensitive data

- Use the shared `logger` from `src/core/logger.ts` for core audit events. Pino writes structured output to stderr; user conversation remains plain terminal output from the CLI.
- Info-level events must contain operational metadata, not full tool input, command output, or permission answers. Payload logging belongs at `debug` only.

## Tool contract and security invariants

Each tool is a `ToolDefinition` with a snake_case `name`, description, JSON Schema `inputSchema`, `requiresPermission`, and async `execute(input)`.

1. Implement the definition in `src/core/tools/` and register it in `src/core/tools/index.ts`.
2. Set `requiresPermission` for any state-changing or command-executing tool.
3. Route filesystem paths through `resolveInWorkdir()`; it is the lexical and symlink-aware containment boundary.
4. Do not broaden `always` permission caching: it is scoped to the exact `toolName:JSON(input)` value for one process session.
5. Preserve full process-tree termination on `run_command` timeout.

## Testing expectations

Tests live in `tests/unit/` and `tests/integration/` and run with Vitest. Mock external or interactive boundaries (Bedrock and readline) rather than calling AWS or requiring terminal input. Security-boundary changes must add or update containment or permission-scope tests; retry and configuration changes need deterministic tests using injected retry dependencies or direct validation inputs.
