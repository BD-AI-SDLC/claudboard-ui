## ADDED Requirements

### Requirement: Run-control cluster lives in the Active Run topbar

The Active Run page SHALL render a single run-control cluster in its topbar (the area above the Stream pane, alongside the breadcrumb and any other run-level metadata). The cluster SHALL contain three controls in this order: Pause/Resume, Stop, Restart. The Pause/Resume button SHALL NOT be rendered anywhere else on the page — specifically, it is REMOVED from the Stream pane header where it lived prior to this change.

The cluster SHALL render nothing (no slot, no buttons) when the run's `kind === 'prereq'`. Prereq runs use a different runner and the cluster's verbs do not apply.

#### Scenario: Topbar cluster renders for a feature run

- **GIVEN** the Active Run page is open on a run with `kind='feature'` and `status='running'`
- **THEN** the topbar contains a control cluster with Pause, Stop, and Restart buttons
- **AND** the Stream pane header does NOT contain a Pause or Resume button

#### Scenario: Cluster is hidden for a prereq run

- **GIVEN** the Active Run page is open on a run with `kind='prereq'` in any status
- **THEN** the topbar contains NO run-control cluster
- **AND** the page is otherwise rendered normally

### Requirement: Stop button surfaces only for non-terminal feature runs and is gated by a confirmation popover

The Stop button SHALL be visible when `run.kind === 'feature'` AND `run.status` is one of `'running'`, `'paused-user'`, `'paused-gate'`. The button SHALL be hidden in all other states.

Clicking the Stop button SHALL open an anchored Popover with the title "Stop run?" and body copy "In-flight work will be lost. The transcript and workspace files are preserved." The popover SHALL contain two buttons: `[Cancel]` and `[Stop run]`. Clicking Cancel (or pressing Escape, or clicking outside the popover) SHALL dismiss the popover with no side effect. Clicking "Stop run" SHALL call `api.stopRun(runId)` and close the popover.

The Stop button SHALL apply the same in-flight protections established by the Pause/Resume button (`fix-pause-button` change): an in-flight flag prevents duplicate POSTs during a slow response; a network failure surfaces as a single-line inline error message immediately below the cluster for 4 seconds, then clears.

#### Scenario: Stop button visible for running run

- **GIVEN** the Active Run page is open on a feature run with `status='running'`
- **THEN** the Stop button is rendered in the cluster

#### Scenario: Stop button hidden for terminal run

- **GIVEN** the Active Run page is open on a feature run with `status` in `{'done', 'failed', 'dead', 'cancelled'}`
- **THEN** the Stop button is NOT rendered in the cluster

#### Scenario: Stop click opens popover and confirms

- **GIVEN** the Active Run page is open on a feature run with `status='running'` and Stop is visible
- **WHEN** the user clicks Stop
- **THEN** a Popover anchored to the Stop button opens with title "Stop run?" and a Cancel + Stop run button pair
- **WHEN** the user clicks "Stop run" inside the popover
- **THEN** the UI POSTs to `/api/runs/:id/stop`
- **AND** the popover closes
- **AND** on the subsequent `status-change` WebSocket event with `payload.status === 'cancelled'`, the Stop button is no longer rendered

#### Scenario: Stop popover Cancel dismisses without side effect

- **GIVEN** the Active Run page is open on a feature run with `status='running'`, and the Stop popover is open
- **WHEN** the user clicks Cancel (or presses Escape, or clicks outside the popover)
- **THEN** the popover closes
- **AND** NO HTTP request is issued
- **AND** the run continues in its previous status

#### Scenario: Stop network failure surfaces inline

- **GIVEN** the Active Run page is open on a feature run with `status='running'` and the Stop popover is open
- **WHEN** the user clicks "Stop run" and `api.stopRun` rejects with `Error('boom')`
- **THEN** an inline error message `boom` is rendered under the cluster within 100 ms
- **AND** 4000 ms after the error first rendered, the inline error message is removed from the DOM

### Requirement: Restart button navigates to Kickoff pre-filled with the source run's parameters

The Restart button SHALL be visible in every status (including terminal). The button's click behaviour SHALL differ based on whether the source run is currently active:

- For terminal source statuses (`'done'`, `'failed'`, `'dead'`, `'cancelled'`): a click SHALL navigate immediately to `/kickoff?prefill=<runId>` with no confirmation.
- For non-terminal source statuses (`'running'`, `'paused-user'`, `'paused-gate'`): a click SHALL open an anchored Popover with three buttons:
  - `[Stop and restart]` — calls `api.stopRun(runId)`, awaits the response, then navigates to `/kickoff?prefill=<runId>`.
  - `[Start alongside]` — navigates immediately to `/kickoff?prefill=<runId>` with no mutation of the source run. The popover SHALL display a short hint: "This run will keep running."
  - `[Cancel]` — closes the popover with no side effect.

#### Scenario: Restart on terminal run navigates immediately

- **GIVEN** the Active Run page is open on a feature run with `status='failed'`
- **WHEN** the user clicks Restart
- **THEN** the UI navigates to `/kickoff?prefill=<runId>` immediately
- **AND** no popover is rendered

#### Scenario: Restart on live run opens 3-way popover

- **GIVEN** the Active Run page is open on a feature run with `status='running'`
- **WHEN** the user clicks Restart
- **THEN** a Popover anchored to the Restart button opens with three buttons: "Stop and restart", "Start alongside", "Cancel"

#### Scenario: Restart Start-alongside leaves source untouched

- **GIVEN** a 3-way Restart popover is open over a `status='running'` run
- **WHEN** the user clicks "Start alongside"
- **THEN** the UI navigates to `/kickoff?prefill=<runId>`
- **AND** no call to `api.stopRun` is made
- **AND** the source run remains in `status='running'`

#### Scenario: Restart Stop-and-restart cancels then navigates

- **GIVEN** a 3-way Restart popover is open over a `status='running'` run
- **WHEN** the user clicks "Stop and restart"
- **THEN** the UI POSTs to `/api/runs/:id/stop`
- **AND** after the response, the UI navigates to `/kickoff?prefill=<runId>`

### Requirement: Kickoff page pre-fills form fields from `?prefill=<runId>` query param

The Kickoff page SHALL, on mount, inspect the URL for a `prefill` query parameter. If present, the page SHALL:

1. Display a loading state while the source-run fetch is in flight.
2. Call `api.getRun(prefillId)` (the existing `GET /api/runs/:id` endpoint).
3. On success: populate form state from `run.prompt`, `run.target`, `run.autonomy`.
4. On error: render an inline notice "Could not pre-fill from run X — start fresh below." The form SHALL remain interactive with default empty values.
5. After applying (success or error), clear the query param via `window.history.replaceState({}, '', '/kickoff')` so a subsequent refresh of the Kickoff page does NOT re-trigger the prefill.

#### Scenario: Kickoff with prefill pre-fills the form

- **GIVEN** the user navigates to `/kickoff?prefill=runX` and `api.getRun('runX')` returns a run with `prompt='Add outbox'`, `target='/repo'`, `autonomy='balanced'`
- **WHEN** the Kickoff page mounts
- **THEN** the form's prompt field contains `'Add outbox'`
- **AND** the form's target field contains `'/repo'`
- **AND** the form's autonomy field is set to `'balanced'`
- **AND** the URL bar shows `/kickoff` (the query param has been cleared)

#### Scenario: Kickoff with missing prefill source renders inline notice

- **GIVEN** the user navigates to `/kickoff?prefill=missing` and `api.getRun('missing')` throws
- **WHEN** the Kickoff page mounts
- **THEN** an inline notice mentioning the missing source is rendered
- **AND** the form remains interactive with default empty values
- **AND** the URL bar shows `/kickoff` (the query param has been cleared)

#### Scenario: Kickoff without prefill renders empty form

- **GIVEN** the user navigates to `/kickoff` with no query param
- **WHEN** the Kickoff page mounts
- **THEN** no call to `api.getRun` is made
- **AND** the form renders empty

### Requirement: `StatusChip` renders a distinct `'cancelled'` variant

The `StatusChip` primitive SHALL render the new `'cancelled'` run status with a distinct visual variant from `'dead'`. The variant SHALL use a slate / muted-grey colour family (NOT red). The label SHALL be `'Cancelled'`. The chip SHALL NOT pulse (it is a terminal state, not awaiting anything).

#### Scenario: StatusChip renders cancelled

- **GIVEN** a `<StatusChip status='cancelled' />` is rendered
- **THEN** the chip's visible label is `'Cancelled'`
- **AND** the chip's class indicates a slate / muted-grey variant
- **AND** the chip does NOT animate

### Requirement: `Popover` primitive provides the codebase's destructive-action confirmation pattern

The UI SHALL provide a `Popover` primitive at `components/primitives/Popover.tsx` that anchors a small confirmation panel to a trigger element. The primitive SHALL:

- Accept an anchor `ref`, an `open` boolean, an `onClose` callback, an optional `placement` (default `'bottom-end'`), and `children` (the panel content).
- Position itself relative to the anchor's `getBoundingClientRect()` on mount and on window resize.
- Dismiss on ESC keypress.
- Dismiss on click outside the popover and outside the anchor (clicks on the anchor itself do NOT dismiss — the parent decides whether to toggle).
- NOT dismiss on clicks inside the popover content (so internal buttons can do their work before calling `onClose` themselves).
- Move keyboard focus into the popover on open (first focusable element) and trap focus within the popover while open.
- Restore keyboard focus to the anchor on close.
- Use ARIA `role='dialog'`, `aria-modal='true'`, and `aria-labelledby` if a header is supplied.

The `Popover` primitive SHALL be used by both the Stop confirmation and the Restart-while-active 3-way confirmation in the run-control cluster. It SHALL become the codebase's pattern for any future destructive-action confirmation.

#### Scenario: Popover opens, focuses content, closes on ESC

- **GIVEN** a `<Popover>` is rendered with `open=true`, anchored to a button, containing a `[Confirm]` and `[Cancel]` button
- **THEN** the popover's first focusable element receives focus
- **WHEN** the user presses Escape
- **THEN** `onClose` is called
- **AND** focus is returned to the anchor button

#### Scenario: Popover dismisses on outside click

- **GIVEN** a `<Popover>` is rendered with `open=true` and anchored to a button
- **WHEN** the user clicks an element outside both the popover and the anchor
- **THEN** `onClose` is called

#### Scenario: Popover does not dismiss on inside click

- **GIVEN** a `<Popover>` is rendered with `open=true` containing internal buttons
- **WHEN** the user clicks an internal button
- **THEN** `onClose` is NOT called by the popover itself (the parent decides whether the button's handler closes the popover)
