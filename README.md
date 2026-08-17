# mini-harness

A minimal, from-scratch agentic CLI harness — built to learn how tools like
Claude Code actually work under the hood, not to be a production tool.

## Setup

```bash
npm install
cp .env.example .env   # edit AWS_REGION / BEDROCK_MODEL_ID as needed
```

AWS credentials are picked up from the standard AWS SDK credential chain
(env vars, `~/.aws/credentials`, SSO, etc) — nothing custom to configure.
You need Bedrock model access enabled for the chosen Claude model in your
target region.

Most current Claude models on Bedrock only work through an **inference
profile id**, not the bare model id — using the bare id fails with
`"on-demand throughput isn't supported"`. See "Checking available models"
below if you're not sure which id to use.

```bash
npm start
```

## Checking available models

If `BEDROCK_MODEL_ID` gives an "invalid model identifier" or "on-demand
throughput" error, list what your account actually has access to:

```bash
npm install --no-save @aws-sdk/client-bedrock
node -e "
import('@aws-sdk/client-bedrock').then(async ({ BedrockClient, ListInferenceProfilesCommand }) => {
  const client = new BedrockClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
  const { inferenceProfileSummaries } = await client.send(new ListInferenceProfilesCommand({}));
  for (const p of inferenceProfileSummaries ?? []) console.log(p.inferenceProfileId);
});
"
```

Pick a `*.anthropic.claude-*` id from the output and put it in `.env` as
`BEDROCK_MODEL_ID`. `@aws-sdk/client-bedrock` is only needed for this
one-off check (`--no-save` keeps it out of `package.json`) — the app itself
only uses `@aws-sdk/client-bedrock-runtime`.

## Manual test checklist

Run `npm start` and try these in order — each one exercises a different
part of the loop:

1. **Plain chat, no tools**: `Say hello in one short sentence.`
   → confirms the Bedrock connection and basic loop work.
2. **Read-only tool loop**: `List the files in the current directory, then read package.json and tell me the version field.`
   → confirms multi-round tool-use (`list_dir` → `read_file` → final answer)
   works, with no permission prompt (read-only tools auto-run).
3. **Gated tool, deny**: `Create a file named scratch-test.txt with the content "hello world".`, then answer `n` at the permission prompt.
   → confirms denial is respected and no file is created.
4. **Gated tool, allow**: same prompt as above, answer `y` this time.
   → confirms the file gets written with the right content
   (`cat scratch-test.txt` afterward). Delete it when done.
5. **`run_command`**: `Run "echo hi" and show me the output.`, answer `y`.
   → confirms the shell tool and its own permission prompt work.

(If you script input into `npm start` via a pipe instead of typing it
interactively, add real delays between lines — Node's `readline` reads
piped input eagerly and can drop a `y`/`n` typed before the harness is
actually waiting for it. Typing directly into the terminal doesn't have
this issue.)

## How the loop works

This is the whole idea of an "agent harness": the model doesn't just answer
in one shot — it can ask the harness to run **tools**, see the results, and
decide what to do next, in a loop, until it has enough to give a final
answer.

1. **`src/index.ts`** — a REPL. Reads a line from you, hands it to the agent,
   prints the final answer, repeats.
2. **`src/agent.ts`** — the actual loop:
   - Send the whole conversation so far + the list of available tools to the
     model (`src/bedrock.ts`, via Bedrock's Converse API).
   - The model replies with either plain text (done) or one or more
     `toolUse` blocks (it wants to run something).
   - If it wants tools: run each one (`src/tools/index.ts`), gate risky ones
     through `src/permissions.ts`, and feed the results back in as a new
     message. Loop again.
   - If it's plain text: that's the final answer for this turn.
3. **`src/tools/`** — each tool is one object: a name, a description, a JSON
   Schema for its input (this is what the model reads to know how to call
   it), and an `execute` function. `read_file`/`list_dir` are read-only and
   run immediately; `write_file`/`run_command` require permission first.
4. **`src/permissions.ts`** — before a gated tool runs, you're asked
   `y` (once) / `a` (always this session) / `n` (deny). This is the smallest
   possible version of what Claude Code's permission system does.

## Adding a new tool

1. Create a `ToolDefinition` (see `src/tools/types.ts`) somewhere under
   `src/tools/`.
2. Add it to the `registry` array in `src/tools/index.ts`.

That's it — the model will see it in the next request automatically, and
`executeTool` will dispatch to it by name.
