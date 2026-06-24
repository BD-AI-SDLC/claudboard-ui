## ADDED Requirements

### Requirement: User-initiated pause holds the SDK iterator

The system SHALL implement user-initiated pause by setting a deferred promise on the run that the iterator consumer `await`s between SDK messages. While paused, no further messages from the SDK query are consumed, and no MCP tool invocations occur because the model is not advanced.

#### Scenario: Pause takes effect at the next message boundary

- **WHEN** the user POSTs `/api/runs/:id/pause` while the SDK is mid-turn (between message yields)
- **THEN** the run status transitions to `paused-user` after the current message is processed; the consumer awaits the resume deferred before reading the next message

#### Scenario: Resume releases the iterator

- **WHEN** the user POSTs `/api/runs/:id/resume` on a `paused-user` run
- **THEN** the deferred resolves, the consumer reads the next SDK message, and the run status returns to `running`

#### Scenario: Pause is rejected for non-running runs

- **WHEN** the user POSTs `/api/runs/:id/pause` for a run already in `paused-gate`, `done`, `failed`, or `dead`
- **THEN** the server returns HTTP 409 with an explanation of the current status

### Requirement: Pause distinct from gate

User-initiated pause (`paused-user`) and SKILL-initiated gate (`paused-gate`) SHALL be tracked as distinct statuses. A run cannot be in both at the same time; resolving one does not affect the other.

#### Scenario: User pauses, then SKILL hits a gate

- **WHEN** a run is in `paused-user` and the user later resumes it, and the SKILL then calls `gate_request`
- **THEN** status transitions: `paused-user → running → paused-gate`; the gate awaits its own resolution

### Requirement: No crash recovery

The system SHALL NOT attempt to resume any run after the server process restarts. Runs whose persisted status is non-terminal at boot are transitioned to `dead`, with their transcripts left intact.

#### Scenario: Run cannot be resumed after server restart

- **WHEN** a run was `paused-user` when the server died, and the server boots fresh
- **THEN** the run is marked `dead`; any attempt to POST `/api/runs/:id/resume` returns HTTP 409 with explanation; the run's transcript remains readable
