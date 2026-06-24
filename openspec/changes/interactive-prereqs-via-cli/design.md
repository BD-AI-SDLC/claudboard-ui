## Decision: bidirectional stream-json over the existing CLI subprocess

### Context

The current cli-runner spawns `claude --print --output-format stream-json --verbose /<slash>` with `stdio: ['ignore', 'pipe', 'pipe']`. Output flows out as line-delimited JSON. There is no input channel. When the skill calls `AskUserQuestion`, the CLI's non-interactive mode synthesizes a tool_result of the form `{ content: "Answer questions?", is_error: true }` and continues. The skill receives a useless answer, behavior depends on the skill's failure path (usually: hallucinate from CLAUDE.md and bail without writing).

The CLI supports a streaming input mode: `--input-format stream-json` (only with `--print`). In that mode, the prompt is delivered as a stdin message rather than an argv positional, and the parent process can write subsequent stream-json messages — including tool_result messages — to advance the conversation.

### Decision

Switch the prereq cli-runner spawn to:

```
claude --print
  --input-format stream-json
  --output-format stream-json
  --verbose
  --replay-user-messages
  --permission-mode bypassPermissions
```

Open stdin as a pipe and keep it open for the lifetime of the run. Write the initial slash command as the first stream-json user message. When an `AskUserQuestion` tool_use appears on stdout, broadcast it and wait for the UI to deliver an answer via a new endpoint, which writes the corresponding tool_result back to stdin.

### Why this is the smallest-diff path

- Same subprocess model. Same transcript persistence. Same WebSocket envelope. The only new wire-level mechanic is "write a tool_result back to stdin when the UI answers" — everything else is unchanged.
- Analyse and any other non-interactive skill behave identically — they simply never emit an `AskUserQuestion`. No conditional branching at spawn time.
- `--replay-user-messages` echoes the user messages we write back into the output stream, which keeps the transcript file accurate (the user's answers appear in the transcript exactly where they happened in the conversation, in the same shape as everything else).
- Reuses the existing `transcript-message` pipe for everything that isn't an explicit question; the new `interactive-question` event is purely additive.

### Why not normalize all of this to argv-positional prompts

`--input-format stream-json` requires the prompt as a stdin message. The slash-command argv positional is **not** accepted in this mode (the CLI explicitly conflicts). The migration is therefore: delete `slashCommand` from argv, write `{"type":"user","message":{"role":"user","content":"/<slash>"}}\n` to stdin as the first thing, then drain output as today. Same string the CLI saw before, different delivery channel.

### Why a separate endpoint instead of overloading the existing transcript event

Symmetric design: the inbound (UI → server → stdin) channel and the outbound (stdin → stdout → WS) channel are conceptually one stream, but the inbound path needs HTTP request semantics (auth scope, status codes, idempotency). A REST endpoint matches what the rest of the app does for "user action against a run" (gate resolve, run pause, run abort) and slots in beside `POST /api/runs/:id/gate/:gateId/resolve` without surprise.

## Decision: in-memory per-run stdin handle registry

### Context

Stream-json answers must reach the exact child process that asked the question. The cli-runner currently holds the child reference in a per-call promise closure and doesn't expose it. The new endpoint needs to find that child by runId.

### Decision

Add a module-scoped `Map<runId, { stdin: Writable; pendingQuestions: Map<toolUseId, InteractiveQuestion[]> }>` in `cli-runner.ts`. Populate on spawn, delete on child exit. Export `submitCliAnswer(runId, toolUseId, answers): { ok: boolean; reason?: 'unknown-run' | 'unknown-tool-use' | 'run-exited' }` that the route handler calls.

### Trade-offs accepted

- In-memory only. Server restart drops the registry; in-flight runs orphan. Acceptable for v1 — restarts are rare in dev, and the user can re-run the prereq.
- Single-process only. We don't run multiple server processes; if we ever do, the inbound endpoint needs to route to the right process. Out of scope.
- Not persisted to SQLite. The pending-question state is ephemeral by definition (only useful for a live subprocess); no value in persisting it.

## Decision: route the inbound endpoint under `/api/runs/:id/cli-answer`

### Context

The endpoint operates against a specific run and is conceptually similar to `POST /api/runs/:id/gate/:gateId/resolve`. The shape `POST /api/prereqs/:cmd/answer` was considered and rejected because it doesn't carry the runId in a place that's natural to look up; the runner registry is keyed by runId, not by cmd.

### Decision

`POST /api/runs/:id/cli-answer` with body `{ toolUseId: string; answers: Array<{ answer: string }> }`. Returns:
- 200 on success.
- 404 with `{ error: 'Run not found' }` when the runId doesn't exist.
- 404 with `{ error: 'Tool use id not pending for this run' }` when the toolUseId isn't registered (already answered, or never seen).
- 409 with `{ error: 'Run has exited' }` when the run is no longer running.

The endpoint is intentionally narrow — it only delivers answers to the subprocess. Aborting a question (Skip) is modeled as `{ answers: [] }` or `{ answers: [{ answer: '' }] }`; the skill is responsible for handling empty answers (most call sites prompt with an "or skip" option already).

## Decision: render the question stream inline below FoundationChain, not in a modal

### Context

The user explicitly chose Variant C from `ui/designs/Interview Designs.html` — "Inline stream cards" — over the conversation pane (Variant A), form rail (Variant B), or focus mode (Variant D). The design rationale is that a question is just another event in the run's event stream; the UI should reinforce that mental model.

### Decision

A new section on the Project page, conditionally rendered between FoundationChain and MaintenanceGrid, titled "Interview · <cmd>" with a running progress indicator (`question N of M · 〜elapsed`). The component:

- Subscribes to the run's WebSocket and collects every `interactive-question` event into a local question history.
- Renders each answered question as a collapsed one-liner (`? <question text> → ✓ <answer label>`) with an Edit affordance (the affordance is rendered for visual fidelity to the design but is disabled in v1 — see proposal "out of scope").
- Renders the current pending question as an expanded card matching Variant C: violet header chip "QUESTION N OF M · <header>", big question text, optional why line (italic, dimmed), option list with radio + label + description, optional note input, Skip and Submit buttons.
- On Submit, calls `api.submitCliAnswer(runId, toolUseId, answers)` and optimistically advances the local state (the next question may or may not be the next `interactive-question` event the runner emits — could be tool calls in between).
- When the run's status transitions to `done` or `failed`, the component shows a brief summary line and then unmounts on the next render cycle (parent decides; in v1 the parent just stops rendering it once status != running).

### Why inline and not a modal or side panel

- Matches the user's explicit design choice.
- Keeps the dashboard layout stable — no flying-in panels disrupting other operations.
- Lets the user see the surrounding context (FoundationChain progress, project header) while answering.
- Easy to extend to other run kinds later (techdebt, generate, refresh) without a layout overhaul.

### Why a separate component instead of extending InterviewPane

InterviewPane is bound to the SDK Gate model: a single resolve-all submission against a Gate row in SQLite. The CLI flow is the opposite: one question at a time, no Gate row, no all-at-once submit. Forcing them into one component would conflate two protocols. They share visual idioms only — the markdown renderer and option card styling are extractable in a follow-up cleanup; for now, copy what's needed.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| `--input-format stream-json` rejects the message shape we write | First implementation pass writes a known-good single user message and we'll validate manually in section 6 of tasks.md before wiring the rest. If the shape is wrong, the child exits with a parse error on stderr that surfaces via existing failure path. |
| Skill emits AskUserQuestion with surprising payload shape (deeply nested options, no `header`) | The protocol type is intentionally permissive on optional fields. Renderer falls back to `q.question` and `(no options)` defaults when fields are absent. |
| User closes the browser mid-question | The subprocess remains alive on the server. Reconnecting via WebSocket replays the event stream (existing mechanism) and the user sees the same pending question. If they want to bail, they abort the run. |
| Two browser tabs open on the same project both try to answer | The endpoint is last-write-wins. The runner pops the pending-question entry on the first write; the second write returns 404 "Tool use id not pending". Acceptable. |
| Race: user answers and the child exits before the answer flushes | The endpoint returns 409 "Run has exited" and the UI surfaces a one-shot toast. No data corruption — the question was already answered by the runner's existing failure path. |
