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
