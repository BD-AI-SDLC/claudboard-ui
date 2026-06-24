## ADDED Requirements

### Requirement: clarify_request MCP tool pauses the run and awaits a clarification resolution

The in-process `bosch` MCP server SHALL register a typed tool `clarify_request` with input schema `{ questions: string[] }` (array of one or more non-empty strings).

The handler SHALL:

1. Generate a fresh gate id (UUID).
2. Insert a row into the `gates` table with `kind = 'clarify'`, `payload = JSON.stringify({ questions })`, `status = 'open'`.
3. Transition the run row's status from `running` to `paused-gate`.
4. Broadcast a `gate-request` WebSocket event with payload `{ gate_id, gateKind: 'clarify', gatePayload: { questions } }`.
5. Broadcast a `status-change` WebSocket event with payload `{ status: 'paused-gate' }`.
6. `await` the deferred returned by `createGateDeferred(runId, gateId)` — the same deferred map used by `gate_request`.
7. On resolution: persist the resolution as JSON, transition the run row back to `running`, broadcast `status-change` (`running`) and `gate-resolved`.
8. Return `{ content: [{ type: 'text', text: JSON.stringify(result) }] }` so the SDK appends the JSON answers (or skip flag) to the agent's context.

The tool SHALL share the same deferred plumbing, DB schema, WebSocket events, and REST resolution endpoint as `gate_request`. The only differences are the `kind` value, the input schema, and the resolution shape.

#### Scenario: SKILL calls clarify_request and receives the user's answers

- **GIVEN** a run in `running` status
- **WHEN** the SKILL invokes `mcp__bosch__clarify_request({ questions: ["Which workspace?", "Who are the actors?"] })`
- **THEN** a new gate row is inserted with `kind = 'clarify'`
- **AND** the run transitions to `paused-gate`
- **AND** the broadcast `gate-request` event carries `gateKind: 'clarify'` and `gatePayload.questions` equal to the input
- **AND** when `POST /api/runs/:runId/gate/:gateId/resolve` is later called with `{ answers: ["meas", "platform admins and tenant users"] }`
- **THEN** the tool returns `{ content: [{ type: 'text', text: '{"answers":["meas","platform admins and tenant users"]}' }] }`
- **AND** the run transitions back to `running`
- **AND** the gate row is updated with `status='resolved'` and the resolution JSON

#### Scenario: User skips clarification

- **GIVEN** an open clarify gate
- **WHEN** the resolve endpoint receives `{ skipped: true }`
- **THEN** the tool returns `{ content: [{ type: 'text', text: '{"skipped":true}' }] }`
- **AND** the run transitions back to `running`
- **AND** the orchestrator is free to proceed without answers

#### Scenario: clarify_request with empty questions array is rejected

- **WHEN** the SKILL invokes `mcp__bosch__clarify_request({ questions: [] })`
- **THEN** the tool returns a zod validation error as the tool result
- **AND** no gate row is inserted
- **AND** the run status is unchanged

### Requirement: Resolve route accepts a discriminated resolution union

`POST /api/runs/:runId/gate/:gateId/resolve` SHALL validate the request body as one of three shapes:

- **Approval** — `{ result: 'approved' }` or `{ result: 'rejected', changes?: string }`
- **Clarify answers** — `{ answers: string[] }` where each element is a string (empty strings are allowed; they mean "no preference")
- **Clarify skip** — `{ skipped: true }`

Any body matching none of the three SHALL produce a 400 response with a descriptive error. The validator SHALL NOT cross-check the resolution shape against the gate's `kind` — the in-process tool handler is the source of truth for shape interpretation, and a mismatched resolution simply lands in the tool result for the orchestrator to handle. (This keeps the route stateless and avoids a DB read on every resolve.)

#### Scenario: Approval body for a spec+plan gate

- **GIVEN** an open gate with `kind = 'spec+plan'`
- **WHEN** the resolve endpoint receives `{ result: 'approved' }`
- **THEN** the route returns 200 and resolves the deferred with the approval payload

#### Scenario: Clarify answers body

- **GIVEN** an open gate with `kind = 'clarify'`
- **WHEN** the resolve endpoint receives `{ answers: ['a', '', 'c'] }`
- **THEN** the route returns 200 and resolves the deferred with `{ answers: ['a', '', 'c'] }`

#### Scenario: Skip body

- **GIVEN** an open gate with `kind = 'clarify'`
- **WHEN** the resolve endpoint receives `{ skipped: true }`
- **THEN** the route returns 200 and resolves the deferred with `{ skipped: true }`

#### Scenario: Malformed body

- **WHEN** the resolve endpoint receives `{ foo: 'bar' }`
- **THEN** the route returns 400 with a JSON error describing the accepted shapes
- **AND** the deferred is not resolved

### Requirement: GateResolution is a discriminated union exported from the protocol package

The `@bosch-sdlc/protocol` package SHALL export:

```ts
type ApprovalResolution = { result: 'approved' | 'rejected'; changes?: string }
type ClarifyResolution = { answers: string[] } | { skipped: true }
type GateResolution = ApprovalResolution | ClarifyResolution
type ResolveGateRequest = GateResolution
type GateKind = 'spec+plan' | 'clarify'
interface ClarifyPayload { questions: string[] }
```

The `Gate.kind` field SHALL be typed as `GateKind` rather than the prior loose `string`. The `Gate.resolution` field SHALL be `GateResolution | null`.

Existing consumers (`ReviewGate`, gate routes, `mcp-server.ts`'s `gate_request`) that operate only on the `ApprovalResolution` variant SHALL continue to type-check because the union is a superset of the prior single shape.

#### Scenario: Existing approve/reject code still compiles

- **GIVEN** existing code that calls `api.resolveGate(runId, gateId, { result: 'approved' })`
- **WHEN** the protocol package is rebuilt with the widened union
- **THEN** the call type-checks without modification

### Requirement: In-process MCP server with typed event tools

The system SHALL register an in-process MCP server named `bosch` via `createSdkMcpServer` from `@anthropic-ai/claude-agent-sdk`, exposing the following typed tools to the model:

- `phase_start({ num: number, title: string })`
- `phase_complete({ num: number })`
- `checkpoint_start({ num: number, title: string })`
- `checkpoint_complete({ num: number })`
- `agent_start({ name: string, op: string })`
- `agent_complete({ name: string })`
- `gate_request({ kind: string, payload: object })`

Each tool MUST be callable from the generated `feature-workflow/SKILL.md` and from its sub-agents.

#### Scenario: SKILL calls phase_start

- **WHEN** the SKILL invokes the `phase_start` tool with `{ num: 1, title: "Ticket · Clarify · Specify · Plan" }`
- **THEN** the in-process handler records the event, broadcasts `phase-start` over WS, and returns an empty success result so the SKILL continues

#### Scenario: SKILL calls a tool with invalid arguments

- **WHEN** the SKILL invokes `checkpoint_start` with `{ num: "one" }` (string instead of number)
- **THEN** the tool returns a structured validation error; the SKILL receives the error as the tool result and can recover

### Requirement: Gate request awaits a deferred and returns the resolution

The system SHALL implement `gate_request` such that the tool handler creates a deferred promise keyed by `(run_id, gate_id)`, records the gate payload in the run state, broadcasts `gate-request` over WS, and `await`s the deferred. The deferred SHALL resolve when `/api/runs/:id/gate/:gate_id/resolve` is POSTed with `{ result: "approved" | "rejected", changes?: string }`. The resolution value SHALL be returned as the tool result.

#### Scenario: User approves a gate

- **WHEN** the SKILL calls `gate_request({ kind: "spec+plan", payload: { spec, plan, ticket } })` and the UI later POSTs `{ result: "approved" }`
- **THEN** the deferred resolves with `"approved"`; the tool returns `"approved"`; the SKILL proceeds to Phase 2; run status returns to `running`

#### Scenario: User rejects a gate with feedback

- **WHEN** the UI POSTs `{ result: "rejected", changes: "Add scenario for empty payload" }`
- **THEN** the tool returns `{ status: "rejected", changes: "Add scenario for empty payload" }`; the SKILL interprets this per its own logic (typically: re-run the gated agents)

#### Scenario: WS disconnects mid-gate

- **WHEN** the only WS client for a run with an open gate disconnects
- **THEN** the deferred remains pending; the run stays in `paused-gate`; reconnect or any new WS client receives the open gate via the buffer replay

### Requirement: Gate persistence

Each open gate SHALL be persisted in SQLite so the dashboard can display "1 awaiting gate" across all live runs without holding deferreds in memory for accounting purposes. The deferred itself remains in-memory; persistence is for surface state.

#### Scenario: Awaiting-gate count reflects open gates

- **WHEN** two runs each have an open gate_request
- **THEN** `GET /api/dashboard/summary` returns `awaiting_gate: 2`
