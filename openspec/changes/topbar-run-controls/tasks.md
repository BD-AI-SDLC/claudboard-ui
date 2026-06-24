## 1. Protocol: cancelled status + run-cancelled event

- [x] 1.1 In `protocol/src/types.ts`, extend `RunStatus` with `'cancelled'`. The union becomes `'running' | 'paused-gate' | 'paused-user' | 'cancelled' | 'done' | 'failed' | 'dead'`. Add a JSDoc note on the union or the new value: "User-initiated terminal status. Distinct from `'dead'` (which is the crash-recovery sweep target). Cancelled runs survive server boot and are never resumed."
- [x] 1.2 If `RUN_STATUS_VALUES` exists (added by a sibling change), include `'cancelled'` in the array.
- [x] 1.3 In `protocol/src/events.ts`:
  - Add `'run-cancelled'` to the `WsEventKind` union.
  - Define `RunCancelledEvent extends WsEventBase { kind: 'run-cancelled'; payload: { reason: 'user' } }`. JSDoc: "Emitted when a user POSTs `/api/runs/:id/stop` and the cancel succeeds. Always followed immediately by `'status-change' { status: 'cancelled' }`. The `reason` field is currently only `'user'`; reserved for future automated-cancel cases."
  - Add `RunCancelledEvent` as a new arm of the `WsEvent` discriminated union.
- [x] 1.4 In `protocol/src/index.ts`, verify `RunCancelledEvent` is re-exported via the existing star-export or add it explicitly.
- [x] 1.5 Build the protocol package: from `protocol/`, run `npm run build`. Confirm no type errors.

## 2. Server: driver — AbortController + stopRun

- [x] 2.1 In `server/src/run/driver.ts`, add a module-level map next to `pauseRequested` and `pauseDeferreds`:
  ```ts
  // Per-run AbortController used by stopRun() to abort the SDK query. See change topbar-run-controls D2.
  const runControllers = new Map<string, AbortController>()
  ```
- [x] 2.2 Inside `runFeature`, before the `query()` call: `const controller = new AbortController(); runControllers.set(runId, controller)`. Pass `abortController: controller` into the `options` object passed to `query()`. Wrap the body with `try { ... } finally { runControllers.delete(runId) }` so the map cannot leak on completion or error.
- [x] 2.3 Add an exported function `export function stopRun(runId: string): { ok: boolean; reason?: string }`. Implementation:
  - Read the current row: `const row = getDb().prepare('SELECT status, kind FROM runs WHERE id = ?').get(runId)`.
  - If absent, return `{ ok: false, reason: 'not-found' }`.
  - If `row.kind === 'prereq'`, return `{ ok: false, reason: 'prereq-runs-cannot-be-stopped' }`.
  - If `row.status` is one of `done`, `failed`, `dead`, `cancelled`, return `{ ok: false, reason: 'already-' + row.status }`.
  - Update the row FIRST (order matters — see Design D1):
    ```sql
    UPDATE runs SET status='cancelled' WHERE id=?
    ```
  - Update any open gates:
    ```sql
    UPDATE gates SET status='cancelled', resolved_at=datetime('now') WHERE run_id=? AND status='open'
    ```
  - Resolve any pause deferred (`pauseDeferreds.get(runId)?.resolve()`) so a pending resume cannot fire post-cancel. Delete from `pauseDeferreds` and `pauseRequested`.
  - Resolve any open MCP gate deferred so the agent's tool call returns. The MCP gate handlers await deferreds keyed by gate id; the stop handler needs a way to wake them up with a `{ cancelled: true }` resolution. Reuse whichever mechanism the gate-bridge already exposes (e.g. `resolveGate(gateId, { cancelled: true })`); if no such API exists, add a minimal helper at the gate-bridge layer.
  - Look up the controller: `const controller = runControllers.get(runId); controller?.abort(); runControllers.delete(runId)`.
  - Broadcast `'run-cancelled' { reason: 'user' }`, THEN `'status-change' { status: 'cancelled' }`, in that order.
  - Return `{ ok: true }`.
- [x] 2.4 In `runFeature`'s outer catch, discriminate abort-during-cancel from genuine failure:
  ```ts
  } catch (err) {
    if (controller.signal.aborted) {
      const cur = getDb().prepare('SELECT status FROM runs WHERE id=?').get(runId) as { status: string } | undefined
      if (cur?.status === 'cancelled') return  // silent — stopRun already updated row and broadcast
    }
    // ...existing failed-status path
  }
  ```
  Coordinate with `error-classification-and-surfacing` if both are in flight: the new failure-classification path should run only when the abort is NOT a cancel.
- [x] 2.5 Add `server/src/run/__tests__/stop.test.ts` covering:
  - Stop a running run: status transitions to `'cancelled'`; `runControllers.get(id)` is `undefined` after; the for-await catch is silent (no `'status-change' { status: 'failed' }` emitted); `'run-cancelled'` event precedes `'status-change' { status: 'cancelled' }`.
  - Stop a `paused-user` run: deferred is resolved, status → `'cancelled'`.
  - Stop a `paused-gate` run: open gate row transitions to `status='cancelled'`, `resolved_at` set; the MCP gate deferred resolves with `{ cancelled: true }`; the run row → `'cancelled'`.
  - Stop on terminal statuses (`done`, `failed`, `dead`, `cancelled`): returns `{ ok: false, reason: 'already-X' }`, no DB mutation, no broadcast.
  - Stop on a prereq run: returns `{ ok: false, reason: 'prereq-runs-cannot-be-stopped' }`.
  - Stop on a missing run id: returns `{ ok: false, reason: 'not-found' }`.

## 3. Server: routes — POST /stop

- [x] 3.1 In `server/src/run/routes.ts`, import `stopRun` from `./driver.js`.
- [x] 3.2 Add `POST /runs/:id/stop` handler. Pattern:
  ```ts
  router.post('/:id/stop', (req, res) => {
    const result = stopRun(req.params.id)
    if (!result.ok) {
      const code = result.reason === 'not-found' ? 404 : 409
      return void res.status(code).json({ error: result.reason })
    }
    return void res.status(200).json({ cancelled: true })
  })
  ```
  (Use the file's existing handler conventions — early-return pattern with `return void`, etc.)
- [x] 3.3 Add a route test under `server/src/run/__tests__/` (or extend the existing routes test file) covering: stop on each valid source status (3 cases) returns 200; stop on each invalid status returns 409 with an explanation; stop on prereq returns 409; stop on non-existent id returns 404.

## 4. Server: sweep — confirm cancelled is terminal

- [x] 4.1 Open `server/src/run/sweep.ts`. Confirm `non_terminal` does NOT include `'cancelled'`. Add a one-line comment above the array: `// 'cancelled' is intentionally terminal — see change topbar-run-controls D4.`
- [x] 4.2 Add a sweep test asserting a row with `status='cancelled'` at boot is left untouched (not transitioned to `'dead'`).

## 5. Server: build + type checks

- [x] 5.1 From repo root, run `npm run build`. Protocol → server build cleanly.
- [x] 5.2 From repo root, run `npm run typecheck`. All workspaces pass. Exhaustive `RunStatus` switches in the server gain compile errors if any missed `'cancelled'`; fix in place.

## 6. UI: Popover primitive

- [x] 6.1 Create `ui/src/components/primitives/Popover.tsx`. Props:
  ```ts
  interface PopoverProps {
    anchor: React.RefObject<HTMLElement>     // element to anchor against
    open: boolean
    onClose: () => void                       // fires on ESC, click-outside, or Cancel button
    placement?: 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end'  // default 'bottom-end'
    children: React.ReactNode                 // popover content
  }
  ```
  Implementation:
  - Compute position from `anchor.current.getBoundingClientRect()` on mount and on window resize. Render as a fixed-position element via a portal (or as a sibling absolute element inside the same stacking context — pick the simpler approach for this codebase; no `react-dom` portal infrastructure exists yet).
  - Attach a `keydown` listener on `document` that calls `onClose` on `Escape`. Attach a `mousedown` listener that calls `onClose` if the click target is outside both the popover and the anchor.
  - Focus the first focusable element inside the popover on open. Trap focus inside the popover while open. Restore focus to the anchor on close.
  - ARIA: `role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing to a content header if provided.
- [x] 6.2 Create `Popover.css`. Minimal styling: `background: var(--surface)`, `border: 1px solid var(--border-hi)`, `border-radius: 8px`, `box-shadow: 0 12px 36px rgba(0,0,0,0.32)`, padding for content, small arrow / pointer optional (skip for v1).
- [x] 6.3 Create `Popover.test.tsx`. Cover:
  - Renders content when `open=true`, does not render when `open=false`.
  - ESC key calls `onClose`.
  - Click outside the popover calls `onClose`.
  - Click inside the popover does NOT call `onClose`.
  - Focus is moved into the popover on open.
  - Focus is restored to the anchor on close.

## 7. UI: API client + StatusChip

- [x] 7.1 In `ui/src/api/client.ts`, add a `stopRun` method:
  ```ts
  stopRun: (id: string) => request<void>(`/api/runs/${id}/stop`, { method: 'POST' }),
  ```
- [x] 7.2 In `ui/src/components/primitives/StatusChip.tsx`, add a `'cancelled'` entry to the status map:
  ```ts
  'cancelled': { cls: 'slate', label: 'Cancelled', pulse: false }
  ```
  (Verify the file's existing variant naming convention; if `'slate'` does not exist, choose a sibling muted-grey variant.)
- [x] 7.3 In `ui/src/components/primitives/StatusChip.css`, add the corresponding `.status-chip--slate` (or chosen variant) rule. Use the `--muted` token family for the background, `--text-soft` (or equivalent) for the foreground. Distinguish visually from `'dead'` (presumably red) — slate / grey is the intent.
- [x] 7.4 Extend `ui/src/components/primitives/StatusChip.test.tsx` (or create if absent) with a `'cancelled'` case asserting the label is "Cancelled" and the variant class is present.

## 8. UI: RunControlCluster

- [x] 8.1 Create `ui/src/components/ActiveRun/RunControlCluster.tsx`. Props:
  ```ts
  interface RunControlClusterProps {
    runId: string
    run: Run | null  // null while not yet hydrated
  }
  ```
- [x] 8.2 If `run === null`, render nothing (or a skeleton placeholder).
- [x] 8.3 If `run.kind === 'prereq'`, render nothing — return `null`. (Design D5.)
- [x] 8.4 Otherwise render a segmented row:
  - Pause/Resume — compose the existing `<PauseResumeButton runId={runId} status={run.status} />` as the first child. Do NOT rewrite its logic.
  - Stop button — visible only if `run.status` is `'running'`, `'paused-user'`, or `'paused-gate'`. Otherwise hidden.
  - A small visual divider.
  - Restart button — visible in every status. Different click behaviour based on status (see 8.6).
- [x] 8.5 Stop button click handler:
  - Open a `<Popover>` anchored to the Stop button.
  - Popover content: title "Stop run?" + body "In-flight work will be lost. The transcript and workspace files are preserved." + `[Cancel] [Stop run]`.
  - "Stop run" button calls `api.stopRun(runId)` and closes the popover. In-flight flag prevents double-clicks. On network failure, render an inline 4-second error message under the cluster (same convention as Pause/Resume).
- [x] 8.6 Restart button click handler:
  - If `run.status` is terminal (`done`, `failed`, `dead`, `cancelled`): navigate immediately to `/kickoff?prefill=<runId>`. No popover.
  - Otherwise: open a `<Popover>` anchored to the Restart button with three actions:
    - "Stop and restart" — calls `api.stopRun(runId)`, awaits the response, then navigates to `/kickoff?prefill=<runId>`.
    - "Start alongside" — navigates immediately to `/kickoff?prefill=<runId>` without touching the source run. (Copy hint: "This run will keep running.")
    - "Cancel" — closes the popover.
- [x] 8.7 Create `RunControlCluster.css`. Mirror the V2 design's `.runctrl` look — a segmented cluster with rounded corners, padded gap between buttons, and a divider between Stop and Restart. Use existing theme tokens.
- [x] 8.8 Create `RunControlCluster.test.tsx`. Cover:
  - Renders nothing when `run.kind === 'prereq'`.
  - Renders Pause + Stop + Restart for a `'running'` feature run.
  - Stop hidden, Restart visible (one-click, no popover) for terminal statuses.
  - Clicking Stop opens the popover; clicking "Stop run" calls `api.stopRun` exactly once.
  - Clicking Stop, then Cancel in the popover, does NOT call `api.stopRun`.
  - Clicking Restart on a terminal run navigates to `/kickoff?prefill=<runId>` immediately.
  - Clicking Restart on a live run opens the 3-way popover; "Start alongside" navigates without calling stopRun; "Stop and restart" calls stopRun then navigates.
  - In-flight Stop coalesces double-clicks (mock api.stopRun with a slow promise; rapid double-click fires once).
  - Stop network failure renders an inline error for 4 seconds.

## 9. UI: mount cluster in ActiveRun, remove pane-head pause

- [x] 9.1 In `ui/src/components/ActiveRun/ActiveRun.tsx`, locate the topbar slot (the area that currently shows the breadcrumb on the design's `.ftb`). Mount `<RunControlCluster runId={runId} run={run} />` at the right side of that area. If no topbar component exists yet, add one inline in `ActiveRun.tsx`. (The wider topbar refactor from V2 — artifacts pill, status strip, etc. — is out of scope for this change.)
- [x] 9.2 Remove the existing `<PauseResumeButton />` from `.active-run__pane-head-actions` (the Stream pane header). Remove the surrounding `<div className="active-run__pane-head-actions">...</div>` if it becomes empty.
- [x] 9.3 In `ActiveRun.css`, trim or remove the `.active-run__pane-head-actions` rule if it is now unused. Add topbar slot styles as needed for the cluster's placement.
- [x] 9.4 Update existing UI tests that depended on the Pause/Resume button being inside the Stream pane (`PauseResumeButton.test.tsx` should still pass — it tests the button in isolation; integration assertions in `ActiveRun.test.tsx` may need adjustment).

## 10. UI: Kickoff prefill

- [x] 10.1 In `ui/src/components/Kickoff/Kickoff.tsx`, on mount, read `?prefill=<runId>` from the URL.
- [x] 10.2 If `prefill` is present:
  - Call `api.getRun(prefill)`.
  - On success, set form state: `prompt = run.prompt`, `target = run.target`, `autonomy = run.autonomy`.
  - On error (404, network error), render an inline notice "Could not pre-fill from run X — start fresh below." Do NOT block the form.
  - After applying (success or error), clear the query param: `window.history.replaceState({}, '', '/kickoff')`. The prefill fires exactly once per navigation.
  - Show a small loading state while the fetch is in flight (e.g. disable the form fields with a "Loading run parameters…" placeholder).
- [x] 10.3 Extend `Kickoff.test.tsx` with:
  - Renders empty form when no `?prefill=` is in URL.
  - With `?prefill=runX`: calls `api.getRun('runX')`, populates form fields from the response, removes the query param from the URL.
  - With `?prefill=missing`: api.getRun throws → form renders with an inline notice, fields remain empty/default.

## 11. UI: build + lint + tests

- [x] 11.1 From `ui/`, run `npm run typecheck`. Exhaustive `RunStatus` switches in the UI surface compile errors for any missed `'cancelled'` case. Fix in place.
- [x] 11.2 From `ui/`, run `npm run lint`. Includes the CSS prefix check; verify all new classes are prefixed (`popover-`, `run-control-cluster-`).
- [x] 11.3 From `ui/`, run `npx vitest run`. All new and existing tests pass. Specifically: `Popover.test.tsx`, `RunControlCluster.test.tsx`, the extended `Kickoff.test.tsx`, the extended `StatusChip.test.tsx`, and the existing `PauseResumeButton.test.tsx` (unchanged behaviour — still passes).

## 12. Full repo verification

- [x] 12.1 From repo root, run `npm run build`. All three workspaces build cleanly.
- [x] 12.2 From repo root, run `npm run typecheck && npm run lint && npm test`. All pass.
- [x] 12.3 Manual smoke (deferred — requires user to exercise the dev server):
  - Start a long-running feature run. Observe the topbar cluster: Pause + Stop + Restart visible; Stream pane head no longer has Pause.
  - Click Pause → status → `paused-user` → button label flips to Resume.
  - Click Stop → popover appears. Click Cancel → popover dismisses, run keeps running.
  - Click Stop → popover appears. Click "Stop run" → status → `cancelled`. StatusChip shows the new slate variant.
  - Restart the server. Verify the cancelled run row is still `'cancelled'` after boot (NOT swept to `'dead'`).
  - Open a terminal-status run. Click Restart → navigates to `/kickoff?prefill=<runId>` → form pre-populated with the run's prompt/target/autonomy. URL bar shows `/kickoff` (query param cleared).
  - Open a live run. Click Restart → 3-way popover appears. Click "Start alongside" → navigates to Kickoff pre-filled; source run continues running in another tab / via sidebar.
  - Open a prereq run. Verify the topbar cluster is NOT rendered (entire cluster hidden).
  - Try `curl -X POST /api/runs/<prereqId>/stop` → 409 with `prereq-runs-cannot-be-stopped`.
