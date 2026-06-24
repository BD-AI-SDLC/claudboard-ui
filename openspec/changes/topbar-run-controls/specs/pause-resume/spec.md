## ADDED Requirements

### Requirement: `'cancelled'` is a user-initiated terminal RunStatus

The system SHALL extend the `RunStatus` union with a new value `'cancelled'`, representing a run that a user has deliberately stopped via the `POST /api/runs/:id/stop` endpoint. `'cancelled'` is distinct from `'dead'` (which is reserved for runs the boot sweep finds in a non-terminal status). Cancelled runs:

- Have no live SDK process, no in-memory MCP server, no in-memory pause deferred.
- DO survive `sweepDeadRuns()` at boot — they are explicitly omitted from the non-terminal sweep list, alongside `'done'` and `'failed'`.
- CANNOT be paused, resumed, restarted (in place), or cancelled again. All four endpoints return HTTP 409 for `'cancelled'` runs.
- DO retain their transcript and their DB row indefinitely; the operator may inspect them via `GET /api/runs/:id` and may use them as a Restart source.

#### Scenario: Cancelled run survives server restart

- **GIVEN** a run with `status='cancelled'`
- **WHEN** the server process is killed and restarted
- **THEN** the row's status remains `'cancelled'` after boot
- **AND** the boot sweep does NOT transition the row to `'dead'`

#### Scenario: Pause on a cancelled run is rejected

- **GIVEN** a run with `status='cancelled'`
- **WHEN** the user POSTs `/api/runs/:id/pause`
- **THEN** the server returns HTTP 409 with an explanation of the current status

### Requirement: Stop endpoint terminates a live run cleanly

The system SHALL expose `POST /api/runs/:id/stop` that transitions a feature run from a non-terminal status (`'running'`, `'paused-user'`, `'paused-gate'`) to `'cancelled'`. The handler SHALL:

1. Validate the run exists; return HTTP 404 otherwise.
2. Validate `kind === 'feature'`; return HTTP 409 with reason `'prereq-runs-cannot-be-stopped'` for prereq runs.
3. Validate the current status is non-terminal; return HTTP 409 with reason `'already-<status>'` otherwise.
4. Update the row to `status='cancelled'` BEFORE aborting any controller (so the for-await loop's outer catch can discriminate user-cancel from genuine failure via the persisted status).
5. Update any open gate rows for the run: `UPDATE gates SET status='cancelled', resolved_at=datetime('now') WHERE run_id=? AND status='open'`.
6. Resolve any pause deferred for the run so a pending resume cannot fire post-cancel.
7. Resolve any open MCP gate deferred with a `{ cancelled: true }` resolution so the agent's in-flight tool call returns rather than hanging.
8. Abort the per-run `AbortController` (see `run-driver` spec).
9. Broadcast `'run-cancelled' { reason: 'user' }`, THEN `'status-change' { status: 'cancelled' }`, in that order.

On success the handler returns HTTP 200 with body `{ cancelled: true }`.

#### Scenario: Stop a running feature run

- **GIVEN** a feature run with `status='running'`
- **WHEN** the user POSTs `/api/runs/:id/stop`
- **THEN** the response is HTTP 200 with `{ cancelled: true }`
- **AND** the run row transitions to `status='cancelled'`
- **AND** `'run-cancelled' { reason: 'user' }` is broadcast before `'status-change' { status: 'cancelled' }`
- **AND** the per-run AbortController has been removed from the driver's `runControllers` map

#### Scenario: Stop a paused-user run

- **GIVEN** a feature run with `status='paused-user'`
- **WHEN** the user POSTs `/api/runs/:id/stop`
- **THEN** the response is HTTP 200
- **AND** the run row transitions to `status='cancelled'`
- **AND** the pause deferred for the run has been resolved (so it cannot fire if a delayed `/resume` arrives)

#### Scenario: Stop a paused-gate run resolves the open gate

- **GIVEN** a feature run with `status='paused-gate'` and one gate row with `status='open'`
- **WHEN** the user POSTs `/api/runs/:id/stop`
- **THEN** the gate row transitions to `status='cancelled'`, `resolved_at` set to the current timestamp
- **AND** the MCP gate deferred resolves with `{ cancelled: true }` (so the agent's tool call returns)
- **AND** the run row transitions to `status='cancelled'`

#### Scenario: Stop on a prereq run is rejected

- **GIVEN** a run with `kind='prereq'` in any status
- **WHEN** the user POSTs `/api/runs/:id/stop`
- **THEN** the response is HTTP 409 with body `{ error: 'prereq-runs-cannot-be-stopped' }`
- **AND** the run is unchanged

#### Scenario: Stop on a terminal run is rejected

- **GIVEN** a feature run with `status` in `{'done', 'failed', 'dead', 'cancelled'}`
- **WHEN** the user POSTs `/api/runs/:id/stop`
- **THEN** the response is HTTP 409 with body `{ error: 'already-<status>' }`
- **AND** no DB write occurs
- **AND** no WebSocket event is broadcast

#### Scenario: Stop on a missing run id returns 404

- **GIVEN** no run exists with id `'no-such-run'`
- **WHEN** the user POSTs `/api/runs/no-such-run/stop`
- **THEN** the response is HTTP 404 with body `{ error: 'not-found' }`

### Requirement: `'cancelled'` is excluded from non-terminal boot sweep

The `sweepDeadRuns()` routine in `server/src/run/sweep.ts` SHALL operate on a `non_terminal` list that includes `'running'`, `'paused-gate'`, and `'paused-user'`, and SHALL NOT include `'cancelled'`. A `'cancelled'` row at boot is left untouched.

#### Scenario: Cancelled row at boot is not transitioned to dead

- **GIVEN** a run row persisted with `status='cancelled'`
- **WHEN** the server process restarts and `sweepDeadRuns()` runs
- **THEN** the row's status remains `'cancelled'`
- **AND** no `'status-change'` event is broadcast for the cancelled row during boot
