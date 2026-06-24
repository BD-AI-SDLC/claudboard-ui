## 1. Protocol: widen resolution union, add clarify schema

- [x] 1.1 In `protocol/src/types.ts`, rename the existing `GateResolution` interface to `ApprovalResolution` (keep the shape). Add `export interface ClarifyResolution { answers: string[] } | { skipped: true }`. Export `type GateResolution = ApprovalResolution | ClarifyResolution`. Update `ResolveGateRequest` to `type ResolveGateRequest = GateResolution`.
- [x] 1.2 In `protocol/src/types.ts`, add `export interface ClarifyPayload { questions: string[] }`. The existing `GatePayload` stays as the loose spec+plan shape. Add `export type GateKind = 'spec+plan' | 'clarify'` and tighten `Gate.kind` to `GateKind` (currently `string`).
- [x] 1.3 In `protocol/src/mcp-schemas.ts`, add `export const ClarifyRequestSchema = z.object({ questions: z.array(z.string().min(1)).min(1) })` and `export type ClarifyRequestInput = z.infer<typeof ClarifyRequestSchema>`.
- [x] 1.4 `npm run build -w protocol` — confirm types compile and nothing downstream breaks (other than expected new union narrowing requirements).

## 2. Server: register clarify_request MCP tool

- [x] 2.1 In `server/src/gate/mcp-server.ts`, import `ClarifyRequestSchema` from `@bosch-sdlc/protocol`. Register a new tool `clarify_request` alongside `gate_request`. The handler mirrors `gate_request`'s structure: insert into `gates` with `kind='clarify'` and `payload=JSON.stringify({ questions: input.questions })`, transition run status to `paused-gate`, emit `gate-request` and `status-change` WS events, await `createGateDeferred(runId, gateId)`, persist the resolution, transition status back to `running`, emit `gate-resolved`, return `{ content: [{ type: 'text', text: JSON.stringify(result) }] }`.
- [x] 2.2 Optional refactor: extract a private helper `createDeferredGateTool(name, description, schema, kind, payloadFromInput)` and have both `gate_request` and `clarify_request` go through it. Skip if the parallel pair is clearer in context.
- [x] 2.3 Verify the `emit('gate-request', { gate_id, gateKind, gatePayload })` payload includes `gateKind: 'clarify'` so the UI can distinguish.

## 3. Server: widen resolve route validator

- [x] 3.1 In `server/src/gate/routes.ts`, replace the current `if (!body.result || ...)` validation with a discriminated check: accept either `{ result: 'approved' | 'rejected', changes?: string }` or `{ answers: string[] }` or `{ skipped: true }`. Reject anything else with 400. Use a small zod schema if it keeps the code clean.
- [x] 3.2 The `resolveGateDeferred(runId, gateId, body)` call passes whichever shape was accepted; the deferred is opaque to shape.
- [x] 3.3 Test: extend `server/src/__tests__/integration.test.ts` (or add `server/src/gate/__tests__/routes.test.ts`) with three cases: approve body resolves, clarify-answers body resolves, skip body resolves. Malformed bodies return 400.

## 4. Server: clarify_request unit test

- [x] 4.1 Add `server/src/gate/__tests__/clarify-request.test.ts`. Wire a test DB, instantiate the MCP server via `createBoschMcpServer(testRunId, db)`, call the `clarify_request` tool handler with `{ questions: ['Q1?', 'Q2?'] }` while in parallel POSTing `{ answers: ['a1', 'a2'] }` to the resolve route. Assert: (a) the tool resolves with content equal to `JSON.stringify({ answers: ['a1', 'a2'] })`, (b) a `gates` row exists with `kind='clarify'` and `status='resolved'`, (c) the run row transitioned `running -> paused-gate -> running`.
- [x] 4.2 Second test: same setup, but POST `{ skipped: true }`. Assert tool resolves with content `JSON.stringify({ skipped: true })`.

## 5. UI: ClarifyGate component

- [x] 5.1 Create `ui/src/components/ClarifyGate/ClarifyGate.tsx`. Props: `{ runId: string, gateId: string, questions: string[], onResolved?: () => void }`. State: `answers: string[]` (one per question, initialized to empty strings), `resolving: boolean`.
- [x] 5.2 Render a `TopBar` (`title="Clarification"`, breadcrumb `['runs', runId, 'clarify']`), a header explaining "the orchestrator needs more context to write a precise spec", and one labeled `<textarea>` per question. Below: a Submit button and a Skip button.
- [x] 5.3 Submit handler: `api.resolveGate(runId, gateId, { answers })`. Empty answers are allowed (semantically "no preference") — do not require all fields. Disable the button while `resolving` is true.
- [x] 5.4 Skip handler: `api.resolveGate(runId, gateId, { skipped: true })`. Same disable behavior.
- [x] 5.5 Create `ui/src/components/ClarifyGate/ClarifyGate.css` with minimal styling consistent with `ReviewGate.css` (same color tokens, same button styling).
- [x] 5.6 Add unit test `ui/src/components/ClarifyGate/ClarifyGate.test.tsx`: render with 2 questions, mock `api.resolveGate`, type into both textareas, click Submit, assert mock called with `{ answers: ['<typed-1>', '<typed-2>'] }`. Second test: click Skip without typing, assert mock called with `{ skipped: true }`.

## 6. UI: routing and banner branch

- [x] 6.1 In `ui/src/App.tsx`, the gate route currently mounts `<ReviewGate>` unconditionally. To branch on kind, the `goGate(gId)` function (line 56) needs to know the kind. Two options: (a) accept a second arg `goGate(gId, kind)` and store it in state alongside `gateId`, propagating from `ActiveRun.tsx`'s `onReviewGate` and from `Sidebar.tsx`'s gate navigation; (b) fetch the gate by `runId` via `api.getRun(runId)` inside the route render and read `openGate.kind`. Choose (a) — it's local and avoids an extra fetch. Add `const [gateKind, setGateKind] = useState<string | null>(null)` next to the existing `gateId` state.
- [x] 6.2 Update the route render at `App.tsx:85`: when `gateKind === 'clarify'`, mount `<ClarifyGate runId={runId} gateId={gateId} questions={...} onResolved={goDashboard} />`. When `gateKind === 'spec+plan'` (or any other value), mount `<ReviewGate ...>`. The `questions` array comes from the gate's payload; fetch via `api.getRun(runId)` on mount and read `openGate.payload.questions`, OR plumb it through navigation. Implementer's call.
- [x] 6.3 In `ui/src/components/ActiveRun/ActiveRun.tsx`, extend the gate detection (line 238) so the navigation call carries the kind. The `gate-request` event already includes `gateKind` in its payload (per task 2.3).
- [x] 6.4 In `ui/src/components/primitives/Sidebar.tsx`, the gate-nav callback needs to thread the kind too. The Sidebar reads from the `runs` list whose entries already include `openGate.kind` (`Run.openGate.kind`).
- [x] 6.5 In `ui/src/components/RunBanner/RunBanner.tsx`, branch the banner text on gate kind: `clarify` → "Answer clarification questions"; default → existing "review spec + plan to continue". The "Review" button label can stay the same.

## 7. Skill: rewrite Phase 1a in the template

- [x] 7.1 Edit `/Users/LUP1BG/Documents/claude-repo-scan/skills/claudboard-workflow/references/feature-workflow.template/SKILL.md.template`. Locate the "### 1a. Clarify scope" section (~line 464 in the generated form). Replace the prose "Ask targeted questions until every aspect of the feature is understood" with explicit instructions to call `mcp__bosch__clarify_request({ questions: [...] })`.
- [x] 7.2 The new prose SHALL describe the loop: (a) decide whether the initial prompt already gives a complete picture; if yes, skip clarification entirely and proceed to 1a-ws. (b) if not, formulate 1-5 targeted questions, call the tool, parse the JSON result. (c) if the tool returned `{"skipped":true}`, proceed with what's known and mention the skip in the eventual spec+plan gate payload. (d) if the answers exposed new ambiguity, formulate sharper follow-ups and call the tool again. Soft cap: aim for ≤2 rounds total in practice; do NOT enforce a hard cap in the protocol.
- [x] 7.3 Update the "Things worth clarifying" bullet list to be guidance for *what* to ask about (it stays), not *how* to ask (the tool call replaces the inline conversation).
- [x] 7.4 Note in the template comments that the human's answers arrive as the tool result, NOT as a fresh user turn in the conversation. The orchestrator reads `result.answers[i]` paired with `questions[i]` by index.
- [x] 7.5 Commit the template change in the `claude-repo-scan` repo (separate commit; not part of this repo's PR).
- [x] 7.6 Regenerate the local meas skill: `cd /Users/LUP1BG/Documents/BoschProjects/meas && claude /claudboard-workflow` (or whatever the regenerate invocation is). Confirm `/Users/LUP1BG/Documents/BoschProjects/meas/.claude/skills/feature-workflow/SKILL.md` now contains `mcp__bosch__clarify_request` and no longer says "Ask targeted questions until every aspect of the feature is understood."

## 8. Manual end-to-end verification

- [ ] 8.1 Start a fresh feature run against `/Users/LUP1BG/Documents/BoschProjects/meas/` with a deliberately under-specified prompt (e.g. "add a status field"). Within Phase 1a, confirm: (a) the Live stream shows a `clarify_request` tool call, (b) the run transitions to `paused-gate`, (c) the gate banner shows "Answer clarification questions", (d) clicking Review navigates to the new ClarifyGate page with the orchestrator's questions rendered as textareas.
- [ ] 8.2 Type answers, click Submit. Confirm: (a) the run transitions back to `running`, (b) the orchestrator's next assistant message references the answers, (c) the spec written in Phase 1c reflects the clarified scope.
- [ ] 8.3 Repeat with a thorough prompt that should not need clarification. Confirm Phase 1a does NOT call `clarify_request` at all and proceeds directly to 1a-ws.
- [ ] 8.4 Repeat with an under-specified prompt, click Skip on the first round. Confirm the orchestrator proceeds with what it can infer and the eventual spec+plan gate payload notes the skip.
- [ ] 8.5 During an active clarification, refresh the browser tab. Confirm the gate page re-renders correctly (questions still visible, no answers preserved — that's fine for v1; preservation is out of scope).

## 9. Validation

- [x] 9.1 `npm run build -w protocol -w server -w ui` — all three workspaces compile.
- [x] 9.2 `npm test -w server -w ui` — new tests pass; existing tests are not broken by the union widening.
- [x] 9.3 `openspec validate add-clarification-gate --strict` — proposal, tasks, and spec deltas parse cleanly.
