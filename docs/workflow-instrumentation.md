# Workflow Instrumentation Contract

This document is for plugin authors who want to write a custom workflow driver that is compatible with `bosch-sdlc`. It defines the contract between a SKILL and the server.

---

## Overview

The `bosch-sdlc` server registers an **in-process MCP server** named `bosch` before calling `@anthropic-ai/claude-agent-sdk`'s `query()`. The SKILL running inside that SDK call reaches the `bosch` MCP server through the normal `mcp__bosch__<tool>` call syntax, exactly like any other MCP tool. Each tool either fires an event (broadcast to the browser via WebSocket) or blocks until a human resolves a gate (the `gate_request` tool).

The run driver bridges MCP tool calls to the UI:

```
SKILL → mcp__bosch__<tool> → in-process MCP server → SQLite + WebSocket broadcast → Browser
```

For `gate_request`, the flow is bidirectional:

```
SKILL → mcp__bosch__gate_request → deferred (awaiting UI)
Browser → POST /api/runs/:id/gate/:gate_id/resolve → deferred resolved → SKILL continues
```

---

## Tool Reference

All tools are available as `mcp__bosch__<tool_name>` inside the SKILL.

| Tool | Input fields | Semantics | When to call |
|---|---|---|---|
| `phase_start` | `phase_number: number`, `phase_title: string` | Marks the start of a workflow phase. Broadcasts a `phase-start` WebSocket event. Returns immediately. | At the top of each phase block. |
| `phase_complete` | `phase_number: number`, `phase_title: string`, `summary?: string` | Marks successful completion of a phase. Broadcasts `phase-complete`. Returns immediately. | After all work for a phase is done. |
| `checkpoint_start` | `phase_number: number`, `checkpoint_id: string`, `label: string` | Marks the start of a named sub-step within a phase. Broadcasts `checkpoint-start`. Returns immediately. | Before each distinct step within a phase (e.g. "Generating BDD spec"). |
| `checkpoint_complete` | `phase_number: number`, `checkpoint_id: string`, `label: string`, `status: "ok" \| "skipped"` | Marks a sub-step as finished. Broadcasts `checkpoint-complete`. Returns immediately. | After the step finishes. |
| `agent_start` | `agent_name: string`, `phase_number: number`, `input_summary?: string` | Signals that a sub-agent invocation is beginning. Broadcasts `agent-start`. Returns immediately. | Immediately before invoking a sub-agent (e.g. `sdd-expert-agent`). |
| `agent_complete` | `agent_name: string`, `phase_number: number`, `output_summary?: string` | Signals that a sub-agent invocation finished. Broadcasts `agent-complete`. Returns immediately. | Immediately after the sub-agent returns. |
| `gate_request` | `kind: string`, `payload: object` | **Blocks** the SKILL until a human resolves the gate. Returns `{ status: "approved" }` or `{ status: "rejected", changes: string }`. See Gate Lifecycle below. | At any human-approval checkpoint (required at the Phase 1d spec+plan gate). |

All tool inputs are validated against Zod schemas defined in `protocol/src/mcp.ts`. Calls with invalid payloads return an MCP error and the run transitions to `failed`.

### Standard `gate_request` payload shape for spec+plan gates

```json
{
  "kind": "spec+plan",
  "payload": {
    "ticket": "<ticket ID or title>",
    "spec": "<BDD spec markdown>",
    "plan": "<architect plan markdown>"
  }
}
```

The `kind` field is a free string — the server passes it through to the UI unchanged. Use `"spec+plan"` for the standard Phase 1d gate so the Review Gate screen renders correctly.

---

## Gate Lifecycle

When the SKILL calls `mcp__bosch__gate_request`:

1. The server creates a gate record in the `gates` SQLite table with `status: "open"`.
2. The run status transitions to `paused-gate`.
3. A `gate-request` WebSocket event (carrying `gate_id`, `kind`, and `payload`) is broadcast to all subscribers of the run's WebSocket room.
4. The MCP tool call **blocks** — the SKILL's execution is suspended at this point.
5. When a user acts in the browser, the UI calls `POST /api/runs/:id/gate/:gate_id/resolve` with one of:
   - `{ "status": "approved" }` — accept the spec and plan as-is.
   - `{ "status": "rejected", "changes": "<freetext describing what to change>" }` — send the run back for revision.
6. The server resolves the deferred, updates the gate record, and broadcasts a `gate-resolved` event.
7. The run status returns to `running`.
8. The MCP tool call returns the resolution object to the SKILL.

### Handling rejection

On `{ status: "rejected", changes }`, the SKILL must:

1. Re-invoke the relevant sub-agents (e.g. `sdd-expert-agent` and `architect-agent`) with the `changes` string injected as additional context.
2. Re-issue `mcp__bosch__gate_request` with the updated spec and plan.
3. Repeat until the user approves.

The server does not enforce this re-invocation — it is the SKILL's responsibility to branch on the returned status. Example:

```markdown
## Phase 1d — Human Gate

Call mcp__bosch__gate_request with:
  kind: "spec+plan"
  payload: { ticket, spec, plan }

Store the result as `gate_result`.

If gate_result.status is "rejected":
  Pass gate_result.changes to sdd-expert-agent and architect-agent as additional context.
  Regenerate spec and plan.
  Go back to Phase 1d (re-issue gate_request with updated artifacts).

If gate_result.status is "approved":
  Continue to Phase 2.
```

### WS reconnect handling

If the browser disconnects while a gate is open, the gate remains in `paused-gate` state. When the WS reconnects, the server re-emits the `gate-request` event for any open gate associated with that run, so the UI can reconstruct the Review Gate screen without user action.

---

## Detection Requirement

The run driver inspects the SKILL file before starting a run. If the SKILL does not contain at least one `mcp__bosch__` reference, kickoff is rejected with **HTTP 409** and the error body:

```json
{
  "error": "SKILL_NOT_INSTRUMENTED",
  "message": "The feature-workflow SKILL in this repo does not contain mcp__bosch__ tool calls. Re-generate the skill by running /claudboard-workflow inside the repo."
}
```

This check exists to fail fast with a clear message rather than silently running a workflow whose events will never reach the UI. Re-run `/claudboard-workflow` in the target repo to generate an instrumented SKILL.

---

## Example SKILL Snippet

The following is a minimal example showing Phase 1 start, a sub-agent invocation, and the Phase 1d gate with reject branch. Adapt the agent names and payload fields to match your workflow.

```markdown
## Phase 1 — Discovery and Specification

Call mcp__bosch__phase_start with:
  phase_number: 1
  phase_title: "Discovery and Specification"

### Phase 1a — Ticket analysis

Call mcp__bosch__checkpoint_start with:
  phase_number: 1
  checkpoint_id: "1a-ticket"
  label: "Analysing ticket"

<!-- ... ticket analysis work ... -->

Call mcp__bosch__checkpoint_complete with:
  phase_number: 1
  checkpoint_id: "1a-ticket"
  label: "Analysing ticket"
  status: "ok"

### Phase 1b — BDD spec generation

Call mcp__bosch__agent_start with:
  agent_name: "sdd-expert-agent"
  phase_number: 1
  input_summary: "Generate BDD spec for: {{ticket}}"

<!-- invoke sdd-expert-agent -->

Call mcp__bosch__agent_complete with:
  agent_name: "sdd-expert-agent"
  phase_number: 1
  output_summary: "Spec written to spec.md"

### Phase 1d — Human gate

Call mcp__bosch__gate_request with:
  kind: "spec+plan"
  payload:
    ticket: "{{ticket_id}}"
    spec: "{{spec_markdown}}"
    plan: "{{plan_markdown}}"

Store result as gate_result.

If gate_result.status is "rejected":
  <!-- Re-run sdd-expert-agent and architect-agent with gate_result.changes as context -->
  <!-- Then re-issue gate_request with the revised artifacts -->

If gate_result.status is "approved":
  Call mcp__bosch__phase_complete with:
    phase_number: 1
    phase_title: "Discovery and Specification"
  Continue to Phase 2.
```
