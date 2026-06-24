## Why

The generated `feature-workflow/SKILL.md` instructs the Phase 1a orchestrator to "Ask targeted questions until every aspect of the feature is understood" (`/Users/LUP1BG/Documents/BoschProjects/meas/.claude/skills/feature-workflow/SKILL.md:464-468`). In an interactive Claude Code terminal session this works — the orchestrator emits assistant `text` blocks and the user types back. In the headless `runFeature` path (`server/src/run/driver.ts:39`), the `query()` iterator is one-way: the SDK streams messages out, but there is no mechanism for the human to inject input mid-flight. The orchestrator's questions land in the Live stream pane as text, the run sits with no way to answer, and the orchestrator eventually proceeds on assumptions or wraps up early. The user reports this as "the workflow finishes" with no spec written.

The codebase already has a proven primitive for "pause the run, wait for a human, resume with a payload": the `gate_request` MCP tool (`server/src/gate/mcp-server.ts:90-121`), used today for the spec+plan approval gate in Phase 1d. Its deferred/resolve plumbing, status transitions (`running` ↔ `paused-gate`), DB persistence, WebSocket events (`gate-request` / `gate-resolved`), and REST endpoint (`POST /api/runs/:runId/gate/:gateId/resolve`) are all already in place. What's missing is (a) a richer resolution payload to carry free-form text answers rather than a binary approve/reject, (b) a UI form to capture those answers, and (c) skill-side prose that calls the new tool instead of expecting an inline conversation.

## What Changes

- **New MCP tool `mcp__bosch__clarify_request`.** Registered alongside `gate_request` in the in-process `bosch` MCP server (`server/src/gate/mcp-server.ts`). Input schema: `{ questions: string[] }` where each question is a non-empty string and the array has at least one entry. The tool reuses the existing gate plumbing: it inserts a row into the `gates` table with `kind = 'clarify'` and `payload = { questions }`, broadcasts `gate-request` over WS, transitions the run to `paused-gate`, awaits the existing per-(run, gate) deferred, returns the resolution as the tool result. From the SDK's perspective it behaves identically to `gate_request` — the tool result string is appended to the agent's context and execution continues.
- **`GateResolution` becomes a discriminated union.** The current shape `{ result: 'approved' | 'rejected', changes?: string }` (`protocol/src/types.ts:68-71`) is widened to a union: the existing approve/reject variant (renamed internally to `ApprovalResolution`) plus a new `ClarifyResolution` variant carrying `{ answers: string[] }` (index-aligned with the original `questions`) OR `{ skipped: true }` when the user explicitly opts out. The `ResolveGateRequest` REST body widens correspondingly; the gate routes handler (`server/src/gate/routes.ts:8-28`) branches on payload shape and validates accordingly.
- **The agent receives answers as the tool result.** When the deferred resolves, the tool returns a JSON string of the resolution. For `clarify` resolutions this is either `{"answers":["...","...",...]}` (one entry per original question, in order; empty string means "no preference, you decide") or `{"skipped":true}`. The orchestrator parses this from the tool result and integrates the answers into its scope understanding.
- **The Active Run gate banner branches on `gateKind`.** When `gateKind === 'spec+plan'`, the existing `ReviewGate` page renders (unchanged). When `gateKind === 'clarify'`, a new `ClarifyGate` page renders: N labeled textareas (one per question), a Submit button (POSTs `{ answers }`), and a "Skip clarification" button (POSTs `{ skipped: true }`). Routing through `App.tsx`'s existing gate route requires the route to fetch the gate's kind before deciding which component to mount.
- **The `feature-workflow` SKILL template is rewritten for Phase 1a.** The "Ask targeted questions" prose at `references/feature-workflow.template/SKILL.md.template` is replaced with explicit instructions to call `mcp__bosch__clarify_request({ questions: [...] })` whenever clarification is needed, parse the returned JSON, and decide whether another round is warranted. The skill guidance soft-caps iterations: aim for ≤2 rounds; only re-ask when the latest answers exposed a new ambiguity, not to polish wording. When the tool returns `{"skipped":true}`, the orchestrator proceeds with whatever scope can be inferred from the prompt alone and notes the skip in the eventual spec+plan gate payload for the human to catch at Phase 1d.

## Capabilities

### New Capabilities

None. Clarification is modeled as a second kind of gate, not as a new system.

### Modified Capabilities

- `gate-bridge`: A new requirement is added registering `clarify_request` as a third typed MCP tool alongside `gate_request` and the event tools, with input schema `{ questions: string[] }` and the same deferred-await semantics. A second new requirement specifies the `GateResolution` discriminated union and the route-handler validation rules. The existing "Gate request awaits a deferred and returns the resolution" requirement is amended to note that `clarify_request` shares the same deferred map and resolution mechanism.
- `web-ui`: A new requirement is added for the `ClarifyGate` screen — N textareas keyed to the questions, Submit and Skip actions, payload validation. The existing gate route in `App.tsx` is described as branching on `gateKind` (fetched via the existing `getRun(runId)` REST call, whose `openGate.kind` field is already populated by `server/src/gate/deferred.ts:29-39`).
- `workflow-instrumentation`: A new requirement is added specifying that the generated SKILL's Phase 1a invokes `mcp__bosch__clarify_request` and loops, replacing the prior "ask the user inline" prose. A soft-cap of "≤2 rounds in practice" is documented as skill guidance, not a protocol limit.

## Impact

- **Code edited.**
  - `protocol/src/types.ts` — `GateResolution` widened to a discriminated union. `ResolveGateRequest` widened similarly. New exported types: `ClarifyPayload`, `ClarifyResolution`, `ApprovalResolution`. Backwards-compatible at the consumer level: existing approve/reject sites still type-check because the union is a superset of the prior shape.
  - `protocol/src/mcp-schemas.ts` — new `ClarifyRequestSchema = z.object({ questions: z.array(z.string().min(1)).min(1) })`. Export `ClarifyRequestInput`.
  - `server/src/gate/mcp-server.ts` — register the new `clarify_request` tool. ~30 LoC mirroring `gate_request`. Refactor opportunity: extract a `createDeferredGateTool(kind, schema, payloadFromInput)` helper to deduplicate the two tools, OR keep them parallel — implementer's call.
  - `server/src/gate/routes.ts` — extend the request-body validator to accept the union. ~15 LoC.
  - `ui/src/components/ClarifyGate/ClarifyGate.tsx` — new component. N controlled textareas, Submit, Skip. POSTs to the same `/api/runs/:runId/gate/:gateId/resolve` endpoint. ~120 LoC.
  - `ui/src/components/ClarifyGate/ClarifyGate.css` — new file, scoped styles. ~40 LoC.
  - `ui/src/App.tsx` — the `route === 'gate'` branch fetches the gate's kind (or receives it as a prop) and conditionally mounts `<ReviewGate>` vs `<ClarifyGate>`. ~20 LoC delta.
  - `ui/src/components/RunBanner/RunBanner.tsx` — copy adjusted so the gate banner text reflects the gate kind (e.g. "Answer clarification questions" vs "Review spec + plan"). ~10 LoC delta.
- **Code added externally (outside this repo).**
  - `/Users/LUP1BG/Documents/claude-repo-scan/skills/claudboard-workflow/references/feature-workflow.template/SKILL.md.template` — Phase 1a section rewritten to call `mcp__bosch__clarify_request`. Note: this file lives in a sibling repo. Editing it requires a separate commit there; this change documents the edit but does not own the file.
  - `/Users/LUP1BG/Documents/BoschProjects/meas/.claude/skills/feature-workflow/SKILL.md` — regenerated from the updated template by re-running `/claudboard-workflow` in the workspace.
- **Tests.**
  - `server/src/gate/__tests__/clarify-request.test.ts` — unit test that calling the tool with a 3-question payload inserts the gate, broadcasts the event, awaits, and the tool result equals what was POSTed to resolve.
  - `server/src/gate/__tests__/routes.test.ts` (or extend existing) — validator accepts both `{ result: 'approved' }` and `{ answers: ['a','b'] }` and `{ skipped: true }`, rejects malformed bodies.
  - `ui/src/components/ClarifyGate/ClarifyGate.test.tsx` — render with 2 questions, type into both textareas, click Submit, assert API called with `{ answers: ['typed-1', 'typed-2'] }`. Then re-render and click Skip, assert API called with `{ skipped: true }`.
- **DB schema.** No new tables. The existing `gates` table already stores `kind`, `payload`, and `resolution` as opaque JSON — the new kind and resolution shape slot in without migration.
- **REST API.** `POST /api/runs/:runId/gate/:gateId/resolve` accepts a wider body shape. Backwards compatible — existing approve/reject callers continue to work.
- **WebSocket protocol.** No new event kinds. `gate-request` and `gate-resolved` already carry opaque `gateKind` and `gatePayload` / `resolution` fields.
- **Skill behavior change is observable to the user.** Phase 1a will pause instead of plowing through. The skill prompt explicitly states: zero rounds is valid if the initial prompt was sufficient — the orchestrator decides whether to call the tool at all.
- **Out of scope.**
  - Per-question follow-up dialogue (treating each textarea as its own mini-thread). Single-round-then-loop is sufficient.
  - Letting the human attach files or images as part of the answer.
  - Persisting clarification history into the JIRA ticket description automatically. The existing Phase 1a logic already updates the description after clarification — that path is unchanged.
  - Per-skill-area customization of the question template (e.g. different question sets for backend vs frontend). The orchestrator generates questions per run; nothing is templated.
  - Streaming partial answers (e.g. the user starts typing, the agent sees a draft). One submit, one round.
  - Time-limiting clarification rounds. If the user wanders away, the run sits in `paused-gate` indefinitely — same behavior as the existing spec+plan gate.
  - Replacing the spec+plan gate with the clarify mechanism. They are two distinct interactions with different semantics; both stay.
