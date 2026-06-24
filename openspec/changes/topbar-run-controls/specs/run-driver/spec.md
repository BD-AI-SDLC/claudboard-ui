## ADDED Requirements

### Requirement: Driver maintains a per-run AbortController for clean cancellation

The run driver SHALL maintain a module-level `Map<runId, AbortController>` named `runControllers`. The driver SHALL register an `AbortController` for each run at the start of `runFeature` and unregister it on completion, failure, or stop. The controller's signal SHALL be passed into the SDK `query()` call via `options.abortController` so that an external caller (the `stopRun` driver function) can terminate the run cleanly via `controller.abort()`.

The controller lifecycle SHALL be protected by a `try / finally` block such that `runControllers.delete(runId)` runs on every exit path — normal completion, thrown exception, or stop-triggered abort.

#### Scenario: AbortController is registered for the run's lifetime

- **GIVEN** a fresh call to `runFeature(runId, ...)`
- **WHEN** the function reaches the `query()` call
- **THEN** `runControllers.get(runId)` returns a fresh `AbortController`
- **AND** the controller's `signal` is passed into `query({ options: { abortController } })`
- **AND** on natural completion (the for-await loop exits without throwing), `runControllers.get(runId)` returns `undefined`

#### Scenario: External abort terminates the run cleanly

- **GIVEN** `runFeature` is executing its for-await loop
- **WHEN** an external caller invokes `runControllers.get(runId)!.abort()`
- **THEN** the for-await loop throws and lands in the outer catch
- **AND** the controller is removed from `runControllers` by the `finally` block

### Requirement: Driver `stopRun()` aborts the SDK and updates persistent state

The driver SHALL expose `stopRun(runId: string): { ok: boolean; reason?: string }`. The function SHALL perform these steps in order:

1. Read the current row's `status` and `kind`.
2. Return `{ ok: false, reason: 'not-found' }` if the row is absent.
3. Return `{ ok: false, reason: 'prereq-runs-cannot-be-stopped' }` if `kind === 'prereq'`.
4. Return `{ ok: false, reason: 'already-<status>' }` if `status` is one of `'done' | 'failed' | 'dead' | 'cancelled'`.
5. Update the run row: `UPDATE runs SET status='cancelled' WHERE id=?`. (This step MUST precede the abort — see `runFeature` outer-catch discrimination below.)
6. Update any open gate rows: `UPDATE gates SET status='cancelled', resolved_at=datetime('now') WHERE run_id=? AND status='open'`.
7. Resolve any pause deferred for the run; delete from `pauseDeferreds` and `pauseRequested`.
8. Resolve any open MCP gate deferred with a `{ cancelled: true }` resolution so the agent's in-flight tool call returns rather than hanging.
9. Look up `runControllers.get(runId)`; call `.abort()` on it if present; delete the entry.
10. Broadcast `'run-cancelled' { reason: 'user' }`, THEN `'status-change' { status: 'cancelled' }`, in that order.
11. Return `{ ok: true }`.

#### Scenario: stopRun on a running run aborts cleanly

- **GIVEN** a run with `status='running'`, a registered AbortController, and no open gate
- **WHEN** `stopRun(runId)` is called
- **THEN** the return value is `{ ok: true }`
- **AND** the run row's status is `'cancelled'`
- **AND** the AbortController has been aborted and removed from the map
- **AND** `'run-cancelled' { reason: 'user' }` was broadcast before `'status-change' { status: 'cancelled' }`

#### Scenario: stopRun on a paused-gate run resolves the gate

- **GIVEN** a run with `status='paused-gate'` and one gate row with `status='open'`
- **WHEN** `stopRun(runId)` is called
- **THEN** the gate row's status is `'cancelled'`, `resolved_at` is set to the current timestamp
- **AND** the MCP gate deferred resolves with `{ cancelled: true }` (the agent's tool call returns rather than hanging)
- **AND** the run row transitions to `'cancelled'`

#### Scenario: stopRun on a prereq run is rejected

- **GIVEN** a run with `kind='prereq'`
- **WHEN** `stopRun(runId)` is called
- **THEN** the return value is `{ ok: false, reason: 'prereq-runs-cannot-be-stopped' }`
- **AND** no DB write occurs
- **AND** no event is broadcast

#### Scenario: stopRun on a terminal status is rejected

- **GIVEN** a run with `status` in `{'done', 'failed', 'dead', 'cancelled'}`
- **WHEN** `stopRun(runId)` is called
- **THEN** the return value is `{ ok: false, reason: 'already-<status>' }`
- **AND** no DB write occurs
- **AND** no event is broadcast

### Requirement: `runFeature` outer catch discriminates abort-during-stop from genuine failure

The driver's `runFeature` outer `catch` block SHALL discriminate between an abort that was caused by a user-initiated stop (silent — `stopRun` has already updated the row and broadcast events) and an abort or thrown error that represents a genuine failure (proceed with the existing failed-status path).

The discriminator SHALL be: `controller.signal.aborted === true` AND the current persisted `runs.status === 'cancelled'`. The `stopRun` function MUST update the row to `'cancelled'` BEFORE calling `controller.abort()` (per the ordering above) so the discrimination is correct.

#### Scenario: Abort during stop is silent

- **GIVEN** a run was just stopped: the row is `status='cancelled'`, the controller has been aborted, the abort has propagated to the for-await loop
- **WHEN** the outer catch fires
- **THEN** the catch checks `controller.signal.aborted` and reads the current `runs.status`
- **AND** finding `status='cancelled'`, the catch returns silently
- **AND** NO `UPDATE runs SET status='failed' ...` is executed
- **AND** NO `'status-change' { status: 'failed' }` event is broadcast

#### Scenario: Abort without stop is treated as failure

- **GIVEN** a run is executing and an external bug or unhandled condition causes the controller to abort (or the SDK throws for an unrelated reason), and the row is still `status='running'`
- **WHEN** the outer catch fires
- **THEN** the catch reads the current `runs.status`, finds `'running'`, and proceeds with the existing failed-status path
- **AND** the run row is updated to `status='failed'`
- **AND** the broadcast `'status-change' { status: 'failed' }` is emitted
