## Why

The prereq CLI flow ships, but it only works for skills that never ask a question. `/analyse` is fine (read-only). `/claudboard-workflow` is not: the skill calls `AskUserQuestion` to gather config (tracker type, repo type, branch pattern, etc.). Under `claude --print --output-format stream-json` the subprocess has no way to answer, so the CLI returns the placeholder `tool_result` `{ content: "Answer questions?", is_error: true }`, Claude hallucinates answers from CLAUDE.md, makes partial progress, then exits code 0 without writing `.claude/skills/feature-workflow/SKILL.md`. The route's artifact-presence guard correctly downgrades the run to failed — but the user sees a confusing "Command exited 0 but expected artifact … was not written" error, the chip stays missing, and there is no way forward from the dashboard.

The same trap waits for `/generate` and any future claudboard skill that prompts. The current one-click model is fundamentally broken for any interactive skill.

The `claude` CLI supports a bidirectional streaming mode: `--input-format stream-json --output-format stream-json` (only with `--print`). In that mode, `AskUserQuestion` is surfaced as a `tool_use` block on stdout, and the parent process can write a `tool_result` JSON message back on stdin to deliver the answer. This change adopts that mode for the prereq path and adds an inline question-stream UI on the Project page so users can answer the skill's questions without leaving the dashboard.

## What Changes

- **Server: switch the prereq cli-runner to bidirectional stream-json.**
  - In `server/src/prereq/cli-runner.ts`, change the spawn args from `--output-format stream-json --verbose` (output only) to `--input-format stream-json --output-format stream-json --verbose --replay-user-messages`. Change `stdio` from `['ignore', 'pipe', 'pipe']` to `['pipe', 'pipe', 'pipe']`. Keep the child's stdin open for the lifetime of the run.
  - Wrap the initial user prompt (the slash command argv we currently pass) as the first stream-json user message written to stdin, since `--input-format stream-json` expects the prompt as a stdin message rather than an argv positional. The slash command remains a literal slash, not a body expansion.
  - Parse each output line as today, but additionally detect assistant `tool_use` blocks where `name === 'AskUserQuestion'`. When detected, the runner SHALL register a pending-question record keyed by `tool_use_id` and broadcast a new `interactive-question` WS event carrying the questions payload. The runner SHALL NOT auto-answer, and SHALL NOT close stdin until the run exits.
- **Server: new endpoint to deliver answers back to the subprocess.**
  - `POST /api/runs/:id/cli-answer` accepts `{ toolUseId: string; answers: Array<{ answer: string }> }`. The handler SHALL look up the run's child-process stdin, write a stream-json user message containing a `tool_result` block (matching `tool_use_id`, `content: <serialized answer payload>`, `is_error: false`), and clear the pending-question record. Returns 200 on success, 404 when the run or tool_use_id is unknown, 409 when the run has already exited.
  - Per-run pending-question state is in-memory only (lives in the cli-runner module). On server restart, in-flight runs lose their pending question and the user must abort and retry; this is acceptable for first-shipping scope.
- **Protocol: add the new WS event and request/response shapes.**
  - `WsEvent` gets a new variant `kind: 'interactive-question'` with `payload: { toolUseId: string; questions: Array<{ question: string; header?: string; options: Array<{ label: string; description?: string }>; multiSelect?: boolean }> }` (matching the existing AskUserQuestion tool input schema).
  - New `CliAnswerRequest` interface for the POST body.
- **UI: new InlineStreamCards component, rendered inline on the Project page.**
  - New `ui/src/components/PrereqInterview/PrereqInterview.tsx` (with `.css`) implementing Variant C from `ui/designs/Interview Designs.html`: a vertical stream of question cards. Each answered card collapses to a one-liner (`? <question> → ✓ <answer>` + edit affordance). The current question expands to show the full card: header chip, big question text, optional `why` line, radio options with label+description, optional note input, Skip and Submit buttons.
  - The component subscribes to the run's WebSocket stream, accumulates `interactive-question` events into a local question history, tracks per-question answers, and POSTs the selected answer to `/api/runs/:id/cli-answer` on Submit.
  - On the Project page, the component renders below the FoundationChain section whenever there is a live prereq run in progress for this project. When the run completes (status moves to `done` or `failed`), the component fades out, and any answered cards collapse into the run history (not yet rendered in this change — out of scope).
  - The existing `InterviewPane` for the SDK feature flow is **not** modified. The visual idiom (option cards, markdown rendering) is borrowed; the gate/single-submit model is not.
- **No changes to:** the analyse path (no AskUserQuestion → no pending questions → identical end-to-end behavior), the feature-workflow SDK flow, gate handling, autonomy, transcript JSONL format on disk, bootstrap, or workspace registry.

## Capabilities

### Modified Capabilities

- **prereq-runner** — the runner gains the ability to capture and route interactive `AskUserQuestion` tool calls. Adds the `cli-answer` endpoint. Existing requirements (run record creation, dependency validation, completion detection, output-path surfacing, WS streaming, exit-code → status mapping, artifact-presence downgrade) are preserved.
- **web-ui** — adds the InlineStreamCards rendering requirement on the Project screen for in-flight prereq runs.

## Impact

- **Protocol (`protocol/src/`):**
  - `WsEvent` discriminated union gains `'interactive-question'` variant.
  - New `CliAnswerRequest` interface and `InteractiveQuestion` type (mirrors AskUserQuestion tool input schema).
- **Server (`server/src/`):**
  - `prereq/cli-runner.ts`: spawn arg changes, stdio change, initial-prompt-via-stdin write, AskUserQuestion detection, per-run stdin handle registry, exported `submitCliAnswer(runId, toolUseId, answers)` helper.
  - `prereq/routes.ts`: new `POST /api/runs/:id/cli-answer` handler.
  - `prereq/__tests__/cli-runner.test.ts`: new cases for bidirectional flow (AskUserQuestion → broadcast → submitCliAnswer → tool_result written to stdin → run continues).
  - No DB schema changes.
- **UI (`ui/src/`):**
  - `api/client.ts`: `submitCliAnswer(runId, toolUseId, answers)`.
  - New `components/PrereqInterview/` directory: `PrereqInterview.tsx`, `PrereqInterview.css`, unit tests.
  - `components/Project/Project.tsx`: render `<PrereqInterview>` below `<FoundationChain>` when a prereq run is in flight.
  - `hooks/useRunWebSocket.ts` or equivalent subscription — if no such hook exists, add a small dedicated hook for the question stream.
- **Spec changes:**
  - `openspec/specs/prereq-runner/spec.md` gains a new requirement "Capture and route interactive AskUserQuestion tool calls" and a new requirement "Deliver user answers to the running CLI subprocess".
  - `openspec/specs/web-ui/spec.md` gains a new requirement "Inline question-stream cards for in-flight prereq runs".
- **No breaking changes for end users.** Analyse continues to work the same way. The new endpoint is additive. The UI section is conditionally rendered, so non-interactive prereqs see no UI difference.
- **Out of scope, called out as follow-up:**
  - History pane for answered questions after run completes (the stream cards are ephemeral; they disappear when the run ends).
  - Edit-answered-card UX (the visual exists in the design but reissuing an already-submitted tool_result is non-trivial and out of scope here).
  - Multi-select question support beyond what AskUserQuestion's `multiSelect: true` indicates (single-select only for v1; multi-select renders as checkbox group but the answer payload uses the same `{ answer: string }` array — the skill receives a comma-joined string for multi-select).
  - Re-attaching to in-flight runs across server restarts. If the server restarts mid-question, the run effectively orphans; the user aborts and re-runs.
