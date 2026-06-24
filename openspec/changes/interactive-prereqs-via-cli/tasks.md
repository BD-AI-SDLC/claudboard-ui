## 1. Protocol: WsEvent variant + answer request types

- [x] 1.1 In `protocol/src/types.ts`, add the `InteractiveQuestion` interface mirroring the AskUserQuestion tool input shape: `{ question: string; header?: string; multiSelect?: boolean; options: Array<{ label: string; description?: string }> }`. Add the discriminated `WsEvent` variant `{ kind: 'interactive-question'; payload: { toolUseId: string; questions: InteractiveQuestion[] } }`. Add `interface CliAnswerRequest { toolUseId: string; answers: Array<{ answer: string }> }`. Re-export all three from `protocol/src/index.ts`.
- [x] 1.2 Run `npm run build -w protocol` and confirm the new symbols appear in `protocol/dist/`.

## 2. Server: cli-runner bidirectional rewrite

- [x] 2.1 In `server/src/prereq/cli-runner.ts`, change the spawn argv from `['--print', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'bypassPermissions', slashCommand]` to `['--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--replay-user-messages', '--permission-mode', 'bypassPermissions']`. Remove `slashCommand` from argv.
- [x] 2.2 Change the `stdio` option from `['ignore', 'pipe', 'pipe']` to `['pipe', 'pipe', 'pipe']`. Update the `ChildProcessByStdio` type parameter (first generic) from `null` to `Writable`. Import `Writable` from `node:stream`.
- [x] 2.3 Immediately after spawn succeeds, write the initial user message to stdin: `child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: slashCommand } }) + '\n')`. Do not close stdin; the child reads more messages as the conversation proceeds.
- [x] 2.4 Add a module-scoped registry: `const runRegistry = new Map<string, { stdin: Writable; pendingQuestions: Map<string, InteractiveQuestion[]> }>()`. Populate with `{ stdin: child.stdin, pendingQuestions: new Map() }` on spawn. Delete the entry inside the existing `'exit'` and `'error'` handlers (idempotent).
- [x] 2.5 In the existing `streamLines` callback, after the `appendTranscriptLine` + `JSON.parse` block, detect AskUserQuestion tool_use calls: when `parsed.type === 'assistant'` and `parsed.message?.content` is an array, scan for items where `type === 'tool_use'` and `name === 'AskUserQuestion'`. For each match, extract `id` and `input.questions`. Register the pending question on the run's `pendingQuestions` map and broadcast a `{ kind: 'interactive-question', payload: { toolUseId: id, questions: input.questions } }` event.
- [x] 2.6 Export `submitCliAnswer(runId: string, toolUseId: string, answers: Array<{ answer: string }>): { ok: true } | { ok: false; reason: 'unknown-run' | 'unknown-tool-use' | 'run-exited' }`. Implementation: look up the registry entry by runId (404 if missing); look up the pending question by toolUseId (404 if missing); construct the tool_result stream-json message `{ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: serializeAnswerPayload(answers), is_error: false }] } }`; `stdin.write(JSON.stringify(message) + '\n')`; remove the pending entry from the map; return `{ ok: true }`. `serializeAnswerPayload` joins `answers.map(a => a.answer)` with `\n` for v1 (single string per answer, newline-separated for multi-select).
- [x] 2.7 Update tests in `server/src/prereq/__tests__/cli-runner.test.ts` for the new spawn args + stdio pipe (existing successful-exit, non-zero-exit, malformed-line, ENOENT cases stay green). Add new cases: (a) an AskUserQuestion tool_use line produces an `interactive-question` WS event with the right payload; (b) `submitCliAnswer` writes a stream-json tool_result message to the child's stdin matching the toolUseId; (c) calling `submitCliAnswer` for an unknown runId returns `{ ok: false, reason: 'unknown-run' }`; (d) calling `submitCliAnswer` for an unknown toolUseId returns `{ ok: false, reason: 'unknown-tool-use' }`; (e) the registry entry is removed on `'exit'` and a subsequent `submitCliAnswer` returns `{ ok: false, reason: 'run-exited' }`.

## 3. Server: REST endpoint for delivering answers

- [x] 3.1 In `server/src/prereq/routes.ts`, add a new route `POST /runs/:id/cli-answer`. The handler reads `{ toolUseId, answers }` from the body. Reject with 400 when the shape is wrong. Call `submitCliAnswer(runId, toolUseId, answers)`. Map `{ ok: true }` → 200. Map `reason: 'unknown-run'` → 404 with `{ error: 'Run not found' }`. Map `reason: 'unknown-tool-use'` → 404 with `{ error: 'Tool use id not pending for this run' }`. Map `reason: 'run-exited'` → 409 with `{ error: 'Run has exited' }`.
- [x] 3.2 The new route does NOT need the bootstrap guard — it is a response to an in-flight run that started after bootstrap was ready. Confirm bootstrapGuard is not in the chain.
- [x] 3.3 Add an integration test in `server/src/__tests__/cli-answer-routes.test.ts`: mock `submitCliAnswer`, drive the four response paths (200, 400 shape, 404 unknown-run, 404 unknown-tool-use, 409 run-exited).

## 4. UI: client method + WS subscription scaffolding

- [x] 4.1 In `ui/src/api/client.ts`, add `submitCliAnswer: (runId: string, body: CliAnswerRequest) => request<{ ok: true }>(`/api/runs/${runId}/cli-answer`, { method: 'POST', body: JSON.stringify(body) })`.
- [x] 4.2 Inspect `ui/src/api/ws.ts` (or equivalent — locate the existing WS client used by ActiveRun). Confirm `interactive-question` events flow through unchanged (the discriminated union just gained a new variant; no client-side branching is needed at the transport layer).

## 5. UI: PrereqInterview component (Variant C — inline stream cards)

- [x] 5.1 Create `ui/src/components/PrereqInterview/PrereqInterview.tsx`. Props: `{ runId: string; cmd: string; onRunComplete?: () => void }`. The component:
  - Maintains local state: `history: Array<{ toolUseId: string; questions: InteractiveQuestion[]; answers: string[]; status: 'pending' | 'submitted' }>`, `currentToolUseId: string | null`, `currentAnswerIndex: number` (for option selection), `currentNote: string`.
  - Subscribes to the run's WS stream via a small hook `useRunEvents(runId)` (write it if it doesn't exist; otherwise reuse). On each `interactive-question` event, append a new entry to `history` and set it as the current entry.
  - Renders a vertical stack: a header row "Interview · <cmd> · question N of M", then one row per history entry. Entries with `status: 'submitted'` render as a collapsed `inline-card`: `<timestamp> <? muted question text> <green arrow + answer label> <Edit ghost button (disabled in v1)>`. The current pending entry renders as `inline-card cur` matching the design — violet header `QUESTION N · header`, big question text, optional why line, radio option list, note input, Skip and Submit buttons.
  - On Submit, calls `api.submitCliAnswer(runId, { toolUseId, answers: [{ answer: selectedOptionLabelOrNote }] })`. On 200, marks the entry submitted and clears `currentToolUseId`. Errors render a small inline error chip on the card.
  - On Skip, calls the same endpoint with `answers: []`.
- [x] 5.2 Create `ui/src/components/PrereqInterview/PrereqInterview.css` lifting the styles from `ui/designs/Interview Designs.html` Variant C — `.inline-card`, `.inline-card.cur`, `.q-mark`, `.qt`, `.ans`, `.inline-cur-h`, `.q-badge`, `.qt-big`, `.why`, `.ans-opt`, `.ans-actions`. Scope all classes under a `.prereq-interview` root to avoid leaking. Use the same CSS variables (`--violet`, `--violet-dim`, `--surface`, etc.) that the rest of the UI uses; do NOT redeclare them.
- [x] 5.3 Unit tests in `ui/src/components/PrereqInterview/PrereqInterview.test.tsx`: (a) renders nothing when history is empty; (b) renders a pending card when an `interactive-question` event arrives via the WS hook (mock the hook); (c) submitting an option calls `api.submitCliAnswer` with the correct payload and collapses the card to submitted state; (d) two sequential questions render as one collapsed + one pending; (e) Skip POSTs `answers: []`; (f) a 409 response surfaces an inline error.

## 6. UI: wire PrereqInterview into Project

- [x] 6.1 In `ui/src/components/Project/Project.tsx`, determine the active prereq run for this project. The existing component already polls `api.getRun(id)` inside `handleRunPrereq`. Hoist the active run id into component state (`const [activeRunId, setActiveRunId] = useState<string | null>(null)`) and set it when a prereq POST returns. Clear it when the run's status transitions to `done` or `failed` (in the same poll handler that already updates prereqs).
- [x] 6.2 Render `<PrereqInterview runId={activeRunId} cmd={activeRunCmd} />` between `<FoundationChain>` and `<MaintenanceGrid>` when `activeRunId !== null`. The component handles its own empty-history rendering (nothing visible until the first `interactive-question` arrives).
- [x] 6.3 Add a small e2e-ish UI test (or extend the existing `Project` component test if one exists) that simulates the full loop: POST prereq → `interactive-question` event arrives via mocked WS → user clicks an option → submit → status moves to done → component unmounts. Use react-testing-library + a fake WS.

## 7. Manual end-to-end verification

- [ ] 7.1 With `analyse: done` already on the ficetro project, click Run on the FoundationChain's "Feature-workflow" card. Observe:
  - The OperationCard shows Running.
  - Within ~30s, the PrereqInterview section appears below FoundationChain with the first AskUserQuestion (the skill asks about branch types or similar).
  - Selecting an option and clicking Submit causes the card to collapse to a one-liner showing the chosen answer.
  - The next question appears (probably about branch pattern, then tracker, etc.).
  - After all questions are answered, the run completes within ~30s, the OperationCard flips to Done, and `.claude/skills/feature-workflow/SKILL.md` exists in ficetro.
- [ ] 7.2 Regression check: re-run `/analyse` on a fresh repo. The PrereqInterview section never appears (analyse doesn't ask questions). The run completes the same way as before this change. The analysis file is written.
- [ ] 7.3 Failure-path check: kill the server mid-question. The UI surfaces an error when Submit POSTs (409 or similar). Restart the server. The run is orphaned (expected for v1). Re-run from the OperationCard.

## 8. Verification

- [x] 8.1 `npm run typecheck` clean across all workspaces. _(Protocol + server clean. UI has pre-existing failures in `ActiveRun/stream*` and `ReviewGate.test.tsx`, unrelated to this change — same set documented in `prereqs-via-cli` task 9.1.)_
- [x] 8.2 `npm run lint` clean. _(8 errors total, all pre-existing; this change introduces zero new lint issues.)_
- [x] 8.3 `npm test` clean — 139 server tests (incl. new cli-runner bidirectional + cli-answer routes) and 116 UI tests (incl. new PrereqInterview + Project wiring) all green.
- [x] 8.4 README + CHANGELOG entry added. README "Quickstart" mentions inline question cards; CHANGELOG entry covers the interactive flow plus the two adjacent bug fixes (prereqs map shape, last_run stamping).
