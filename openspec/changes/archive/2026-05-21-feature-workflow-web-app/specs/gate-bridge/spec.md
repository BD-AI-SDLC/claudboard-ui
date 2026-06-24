## ADDED Requirements

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
