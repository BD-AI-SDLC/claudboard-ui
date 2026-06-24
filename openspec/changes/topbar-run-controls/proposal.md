## Why

The Active Run page today exposes a single working control on a long-running agent: the Pause/Resume button (shipped by `fix-pause-button`). That button sits in the Stream pane header, mixed with the per-pane chrome, and there is no affordance for the other two verbs a user reaches for during a feature run:

- **Stop** — "I've seen enough; give up on this attempt." Today the only way is to kill the server process, which loses every other in-flight run on the same instance. Users instead let runs they've abandoned burn tokens to completion.
- **Restart** — "Try again with these parameters, maybe tweaked slightly." Today users have to remember the original prompt, navigate to Kickoff, retype it, re-pick autonomy, re-pick target. The history of the failed attempt is forgotten without the user actively cross-referencing.

The `ui/designs/Active Run V2.html` design promotes the run controls to a single topbar cluster — a play/pause primary, a stop secondary, and (in our adaptation) a restart action sitting just outside the cluster proper because it creates a new run rather than acting on the current one. This change adopts that cluster.

This change deliberately replaces the in-flight `add-run-suspend` proposal. Suspend (park to disk via SDK session capture and cold-resume) is a more ambitious feature than Stop+Restart and adds protocol, schema, driver, and MCP-gate idempotency work. The product question "what does a user need when they want to step away from a run?" admits two answers — preserve the agent state for later (suspend), or give up and start fresh (stop+restart). The latter is simpler, covers the common case (a failed attempt), and uses primitives that already exist in the codebase. We choose simpler.

This change also introduces the codebase's first destructive-action UI pattern. The new `Popover` primitive that anchors the Stop confirmation will become the convention every later destructive action (delete repo, abort gate, anything similar) builds on. Investing in it once up front beats reinventing per-feature.

## What Changes

### Protocol (`@bosch-sdlc/protocol`)

- Add `'cancelled'` to the `RunStatus` union in `protocol/src/types.ts`. (And to `RUN_STATUS_VALUES` if added by a sibling change.)
- Add `'run-cancelled'` to `WsEventKind`. Define interface `RunCancelledEvent extends WsEventBase { kind: 'run-cancelled'; payload: { reason: 'user' } }`. Add it to the `WsEvent` discriminated union.
- API client gains `stopRun(id: string): Promise<void>`. No body, no new request/response types.

### Database (`server/src/db.ts`)

No migration. The `runs.status` column is `TEXT`; `'cancelled'` is a new accepted value, not a new column. The `CREATE TABLE` and existing migrations remain unchanged. Existing rows are unaffected.

### Server: driver (`server/src/run/driver.ts`)

- Introduce module-level `runControllers: Map<string, AbortController>` (the same primitive the archived `add-run-suspend` design proposed for Suspend — see Design D2 for ownership).
- In `runFeature`, before the `query()` call: `const controller = new AbortController(); runControllers.set(runId, controller)`. Pass `abortController: controller` into the `query()` options. Wrap the body with `try/finally { runControllers.delete(runId) }` so the map cannot leak on normal or error paths.
- New exported function `stopRun(runId: string): { ok: boolean; reason?: string }`:
  - Read the current row. If absent, terminal (`done`, `failed`, `dead`, `cancelled`), or of `kind='prereq'`, return `{ ok: false, reason: ... }`.
  - Update the row FIRST: `UPDATE runs SET status='cancelled' WHERE id=?`. (Order matters — see Design D1.)
  - Update any open gate rows for this run: `UPDATE gates SET status='cancelled', resolved_at=datetime('now') WHERE run_id=? AND status='open'`.
  - Resolve any pause deferred for this run (so a pending resume cannot fire post-cancel) and delete the pause request.
  - Look up the controller; call `.abort()`; delete from the map.
  - Broadcast `'run-cancelled' { reason: 'user' }` then `'status-change' { status: 'cancelled' }`, in that order.
  - Return `{ ok: true }`.
- In `runFeature`'s outer catch, distinguish abort-during-cancel from genuine failure: if `controller.signal.aborted` AND the current persisted `runs.status === 'cancelled'`, return silently — the stop handler has already done the row update and event broadcast. Otherwise proceed with the existing failed-status path. (Coordinates with `error-classification-and-surfacing` if both are in flight; if that change has landed, the failure-classification path runs only when the abort is not a cancel.)

### Server: routes (`server/src/run/routes.ts`)

- `POST /runs/:id/stop` — Validate run exists (404 if not). Reject `kind='prereq'` with 409 + explanation (per Design D5). Reject terminal statuses (`done`, `failed`, `dead`, `cancelled`) with 409. Call `stopRun(id)`; on `{ ok: false }`, return 409 with reason. On `{ ok: true }`, respond 200 `{ cancelled: true }`.
- No other endpoints change. `GET /runs/:id` continues to return prompt/target/autonomy — already exposed on the `Run` protocol type — which is what Restart's prefill reads.

### Server: sweep (`server/src/run/sweep.ts`)

- Verify `non_terminal` is `['running', 'paused-gate', 'paused-user']`. `'cancelled'` MUST NOT appear — cancelled runs are terminal and survive boot like `done` and `failed`. Add a comment noting `'cancelled'` is intentionally absent (see Design D4).

### UI

- New primitive `ui/src/components/primitives/Popover.tsx` + `Popover.css` — anchored, dismissable, click-outside and ESC handling, ARIA roles, focus trap. This is the first destructive-action confirmation primitive in the codebase and is the lasting artifact of this change (Design D6).
- New `ui/src/components/ActiveRun/RunControlCluster.tsx` + `.css` — owns Pause/Resume + Stop + Restart, mounted in the topbar slot. Reads `run.kind`; if `'prereq'`, renders nothing (Design D5). Internally composes the existing `PauseResumeButton` (no rewrite of its tested logic) and two new buttons.
  - **Stop** — visible for non-terminal feature runs (`running`, `paused-user`, `paused-gate`). On click, opens a Popover anchored to the button with copy "Stop run? In-flight work will be lost. The transcript and workspace files are preserved." + `[Cancel] [Stop run]`. On confirm, calls `api.stopRun(runId)`. Hidden for terminal statuses. Same in-flight flag + 4s inline-error conventions as Pause/Resume.
  - **Restart** — visible in every status (including terminal). On click for terminal runs, navigates immediately to `/kickoff?prefill=<runId>`. On click for non-terminal runs, opens a Popover anchored to the button with three buttons: `[Stop and restart] [Start alongside] [Cancel]`. "Stop and restart" calls `stopRun` then navigates; "Start alongside" navigates immediately; "Cancel" dismisses. Restart never directly mutates the source run beyond the optional stop.
- `ui/src/components/ActiveRun/ActiveRun.tsx` — mount `<RunControlCluster runId={...} run={...} />` in the topbar slot. REMOVE the existing `<PauseResumeButton />` from the Stream pane header (`.active-run__pane-head-actions`). The pane head retains only the pane title.
- `ui/src/components/primitives/StatusChip.tsx` + `.css` — add a `'cancelled'` variant. Slate / muted-grey family (not red) — Design D3 explains why.
- `ui/src/components/Kickoff/Kickoff.tsx` — read `?prefill=<runId>` query param on mount. If present, call `api.getRun(prefillId)`, populate `prompt`, `target`, `autonomy` from the response. On the same mount, clear the query param via `replaceState` so a subsequent refresh doesn't re-prefill (Design D7).
- `ui/src/api/client.ts` — add `stopRun: (id) => request<void>('/api/runs/' + id + '/stop', { method: 'POST' })`.
- Tests: new `ui/src/components/ActiveRun/RunControlCluster.test.tsx`, new `ui/src/components/primitives/Popover.test.tsx`, extend `Kickoff.test.tsx` with the prefill case.

## Capabilities

### Modified Capabilities

- `pause-resume` — extends with the `'cancelled'` status and the `/stop` endpoint. The "no crash recovery" rule continues to hold for `paused-user`; `'cancelled'` is terminal and survives boot.
- `run-driver` — extends with per-run `AbortController` plumbing and the `stopRun` driver function. (This is the same plumbing that `add-run-suspend` had designed; that change is being archived as superseded — see Migration Plan.)
- `web-ui` — extends with the topbar run-control cluster (Pause/Resume + Stop + Restart), the new `Popover` destructive-action primitive, the `cancelled` StatusChip variant, and the Kickoff prefill query-param flow. Removes the Pause/Resume button from the Stream pane header.

### New Capabilities

None.

## Impact

- **Protocol (`protocol/src/`):**
  - `types.ts` — add `'cancelled'` to `RunStatus`.
  - `events.ts` — add `'run-cancelled'` to `WsEventKind`, add `RunCancelledEvent` interface, add to `WsEvent` union.
  - `index.ts` — re-export `RunCancelledEvent` if not already covered by the existing re-exports.

- **Server (`server/src/`):**
  - `db.ts` — no migration. (The CREATE TABLE statement does not enumerate status values; `'cancelled'` is just a new accepted string.)
  - `run/driver.ts` — `runControllers` map, `stopRun()`, outer-catch discrimination of abort-during-cancel vs. genuine failure, `try/finally` for controller cleanup.
  - `run/routes.ts` — new `POST /runs/:id/stop` handler with kind/status validation.
  - `run/sweep.ts` — comment confirming `'cancelled'` is not in `non_terminal`.
  - Tests: new `run/__tests__/stop.test.ts` (driver-level invariants), extend `run/__tests__/routes.test.ts` if it exists (HTTP-level validation matrix).

- **Database:** no schema change. New `'cancelled'` status is a new value in the existing TEXT column.

- **UI (`ui/src/`):**
  - New `components/primitives/Popover.tsx`, `Popover.css`, `Popover.test.tsx` — the codebase's first anchored-confirmation primitive.
  - New `components/ActiveRun/RunControlCluster.tsx`, `RunControlCluster.css`, `RunControlCluster.test.tsx` — owns all three verbs.
  - `components/ActiveRun/ActiveRun.tsx` — mounts the cluster in the topbar; removes the pane-head pause button.
  - `components/ActiveRun/ActiveRun.css` — remove or trim `.active-run__pane-head-actions` styles for the now-empty action area; add topbar slot styles.
  - `components/primitives/StatusChip.tsx`, `StatusChip.css` — `'cancelled'` variant.
  - `components/Kickoff/Kickoff.tsx`, `Kickoff.test.tsx` — `?prefill=<runId>` query-param flow.
  - `api/client.ts` — `stopRun(id)` method.

- **Filesystem:** no new on-disk artifacts owned by this project. Workspace files left over from a cancelled run are not touched — the user owns their git state (Design D8).

- **No breaking changes** to external callers. `'cancelled'` is additive to the status union; existing code that switches on `RunStatus` gains an exhaustive-switch type error that surfaces at compile time. The `/stop` endpoint is net-new. The Pause/Resume button moving from pane head to topbar is a UI relocation visible to users but is the entire point of the change.

- **Out of scope (explicitly deferred):**
  - Suspend / Unsuspend (the `add-run-suspend` change) — superseded by this proposal. See Design D9 for the archival plan.
  - Stop on prereq runs — Design D5 explains why the cluster is hidden entirely for `kind='prereq'`; killing a hung prereq still requires killing the server process. A future `prereq-cli-stop` change MAY add this if demand warrants.
  - Adopting other V2 design elements (status strip, big Gate diamond between phases, full-width Decision Queue, right-rail Implementation Tasks, collapsible activity log, artifacts pill). All deferred to focused follow-up changes.
  - Keyboard shortcuts for Stop / Restart. No global key-handler infrastructure exists; deferred to a separate affordance change (which would also revisit Pause/Resume shortcuts).
  - Automatic git-state recovery on cancel (revert uncommitted edits, etc). Out of scope per Design D8 — the user owns their working tree.
  - Restart with the source run's branch instead of letting the new run pick its own. Out of scope; restart is "new attempt from kickoff inputs", not "checkout the same branch".
