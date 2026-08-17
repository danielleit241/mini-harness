# Code Standards

Conventions observed in the existing `mini-harness` codebase. This is the
bar for all future contributions: a clean `npm run typecheck`, no
shortcuts around error handling or the security boundaries described
below, and no fake data, mocks, or stubbed behavior committed as if it
were real. This file describes what's actually there today, not
aspirational rules — extend it as the codebase grows, don't relax it.

## Language & module system

- TypeScript, `strict: true`, target `ES2022`, `module`/`moduleResolution`
  `NodeNext`. Run `npm run typecheck` before considering a change done.
- Pure ESM (`"type": "module"` in `package.json`). Relative imports use
  explicit `.js` extensions even though the source is `.ts`
  (`import { converse } from "./bedrock.js"`) — this is required by
  `NodeNext` module resolution, not a typo.
- No build step for running the app — `tsx` executes TypeScript directly
  (`npm start` → `node --env-file=.env --import tsx src/index.ts`).
  `outDir: dist` exists in `tsconfig.json` for `typecheck`/future builds
  but nothing currently emits there.

## File organization

- One concern per file: REPL (`index.ts`), agent loop (`agent.ts`), API
  client (`bedrock.ts`), permission gate (`permissions.ts`), shared stdin
  (`prompt.ts`), tool contracts and implementations under `tools/`.
- Tool implementations are grouped by kind: `tools/fs.ts` for filesystem
  tools, `tools/bash.ts` for shell execution, `tools/index.ts` for the
  registry and dispatch, `tools/types.ts` for the shared interface.
- New files: descriptive, lowercase, matching the existing single-word
  pattern where a single word is clear; use kebab-case for multi-word
  names, per the repo's baseline convention.

## Naming

- Functions and variables: `camelCase` (`checkPermission`,
  `resolveInWorkdir`, `runCommandTool`).
- Types/interfaces: `PascalCase` (`ToolDefinition`, `ConverseResult`).
- Constants that are effectively fixed config: `UPPER_SNAKE_CASE`
  (`MAX_TOOL_ITERATIONS`, `TIMEOUT_MS`, `MAX_OUTPUT_BYTES`, `WORKDIR`).
- Tool object exports are named `<verb><Noun>Tool` (`readFileTool`,
  `writeFileTool`, `runCommandTool`) and their `name` field is the
  matching `snake_case` string the model sees (`read_file`, `write_file`,
  `run_command`) — the JS binding and the wire name are deliberately
  different cases; don't try to unify them.

## Error handling

- Tool `execute()` functions throw on failure; `executeTool()` in
  `tools/index.ts` is the single place that catches and converts thrown
  errors into a Bedrock `toolResult` with `status: "error"`. Individual
  tools do not need their own try/catch for this.
- `agent.ts` wraps the whole per-turn loop in try/catch and rolls
  `messages` back to the pre-turn length on any error before re-throwing —
  preserving Bedrock's required strict user/assistant message alternation
  is the reason for this, not general defensiveness. Any new code that
  mutates `messages` mid-turn must respect this rollback contract.
- Permission and readline failures fail safe: a closed stdin during a
  permission prompt denies the action (`permissions.ts`) rather than
  throwing or assuming approval.
- `index.ts` catches per-turn errors from `runAgent()` and logs them
  without crashing the REPL loop — a bad turn should not end the session.

## Comments

- Comments explain *why*, not *what*, and stay short — see existing
  examples like the rollback-reason comment in `agent.ts` and the
  symlink-escape rationale in `tools/fs.ts`. Do not add comments that
  restate the following line in English.
- Non-obvious platform differences (Windows vs POSIX process killing,
  `detached` not being in `exec`'s TS types) are called out inline because
  they're easy to "fix" incorrectly without that context.

## Tool contract pattern

Every tool is a `ToolDefinition` object (see `src/tools/types.ts`):
`name`, `description`, `inputSchema` (JSON Schema, passed to Bedrock
as-is), `requiresPermission`, `execute(input)`. To add a tool:

1. Implement it as a `ToolDefinition` in an appropriately-named file under
   `src/tools/` (new file per kind of tool, following `fs.ts`/`bash.ts`).
2. Add it to the `registry` array in `src/tools/index.ts`.
3. Set `requiresPermission: true` for anything that mutates state,
   executes code, or has side effects outside returning information.

Do not bypass `executeTool()`'s permission gate or error wrapping by
calling a tool's `execute()` directly from `agent.ts`.

## Security-relevant invariants (do not weaken silently)

- All filesystem tool paths must go through `resolveInWorkdir()` in
  `tools/fs.ts` — it is the sandboxing boundary. Any new file-touching
  tool must reuse it, not reimplement path resolution.
- Permission "always" approval is scoped to the exact
  `toolName:JSON(input)` pair, never to the tool name alone. Preserve this
  scoping if the caching mechanism changes.
- `run_command` timeouts kill the full process tree, not just the direct
  child. Preserve this if the execution mechanism changes.

## Formatting

- Prettier is the formatter of record: `npm run format` /
  `npm run format:check`. `.prettierrc.json` and `.prettierignore` define
  the actual rules and excluded paths — defer to those files over any
  description here.

## Testing

No test suite exists yet — this is a production-readiness gap tracked in
`docs/project-roadmap.md`, not an accepted permanent state. When tests are
added, prioritize the two pieces where a regression would be a security
issue, not just a correctness bug: `resolveInWorkdir()`'s path-containment
logic and `checkPermission()`'s caching key. The Bedrock-dependent agent
loop needs a mocked client and should follow once the client boundary is
testable in isolation. New code that touches these areas should ship with
tests once the harness exists — don't wait for a separate "add tests"
pass.
