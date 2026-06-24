## MODIFIED Requirements

### Requirement: Live data over REST and WebSocket

The UI SHALL fetch initial data via REST endpoints and subscribe to live updates via WebSocket. There SHALL be no mock data shipped in the production build. **The Dashboard activity / recent runs panel SHALL render real run data only; no hardcoded sample feed SHALL exist in the production bundle.**

The Active Run page's event-derived state (Pipeline pane phases, Live stream entries, gate-request projection) SHALL survive navigation away from and back to the page on a single long-running run, even when the WebSocket replay buffer's 200-event cap would otherwise have evicted critical events (such as the active phase's `phase-start`). To guarantee this, the Active Run page SHALL hydrate from `GET /api/runs/:id/events` *before* attaching to the WebSocket:

1. On mount (or whenever `runId` changes), the page SHALL call `GET /api/runs/:id/events` and seed the local `events` state with the returned array.
2. The page SHALL then open the WebSocket connection to `/api/runs/:id/stream` and append every incoming event to the same `events` array.
3. The WebSocket's replay-on-connect events (the in-memory ring buffer) MAY duplicate some of the events already fetched via REST. The client SHALL deduplicate by `(kind, t, payload)` identity so the pipeline projection is not double-counted.

Until the REST hydration resolves, the page MAY render the pre-hydration empty state; it SHALL NOT render a misleading "no phase active" Pipeline pane derived from a half-loaded event list.

#### Scenario: Dashboard fetches from REST

- **WHEN** the dashboard mounts
- **THEN** it calls `GET /api/dashboard/summary` and `GET /api/projects` and `GET /api/runs`; no `window.DATA` global exists in the production bundle **and no `STATIC_FEED` constant is bundled**

#### Scenario: Active Run hydrates events history before attaching WS

- **WHEN** the user opens an active run page for the first time in a session
- **THEN** the page first issues `GET /api/runs/:id/events` and seeds local event state from the response
- **AND** it then opens a WS connection to `/api/runs/:id/stream`
- **AND** any events that arrive via WS that match an already-seeded event (by `kind`, `t`, and `payload`) are deduplicated rather than appended a second time

#### Scenario: Pipeline pane survives navigation on a long-running run

- **GIVEN** a run has been running long enough that more than 200 events have been broadcast since its `phase-start` (so the WS ring buffer no longer contains that event)
- **AND** the user has the Active Run page open and sees phase 1 expanded, status `active`, with a ticking duration counter
- **WHEN** the user navigates to the Dashboard and then back to the same Active Run page
- **THEN** the Pipeline pane again shows phase 1 expanded, status `active`, with a non-zero duration that matches (within rendering tolerance) the value displayed before navigation
- **AND** the highlighted current-phase visual state is restored

#### Scenario: Dashboard recent runs panel renders live data

- **WHEN** the dashboard renders with one or more runs in the database
- **THEN** the panel displays the 5 most recent runs (by `createdAt` descending), each row showing status chip, project name, prompt summary (max 60 chars), and relative age; clicking a row navigates to that Run view

#### Scenario: Dashboard recent runs panel empty state

- **WHEN** the dashboard renders with zero runs in the database
- **THEN** the panel displays the message "No runs yet — start a feature from any project."

### Requirement: Gate approval flow

The Review Gate screen SHALL provide actions to approve or reject the open gate. Approve SHALL POST `{ result: "approved" }`; reject SHALL open an inline form for the change request text and POST `{ result: "rejected", changes }`.

After either action resolves successfully, the user SHALL be returned to the Active Run page for the same `runId`, NOT to the Dashboard. The Active Run page is the correct landing surface for both outcomes: on approve, the run advances and the user sees subsequent phases stream live; on request-changes, the run re-enters work on the rejected artifacts and the user sees that work resume.

The "Request changes" text input SHALL be a multi-line `<textarea>` (initial `rows={4}`), NOT a single-line `<input>`. The textarea SHALL grow only vertically (`resize: vertical` in CSS, NOT `resize: both` or `resize: horizontal`), SHALL have a `min-height` that accommodates at least 4 lines at the page's base font size, and SHALL inherit the page's font family (`font-family: inherit`) so it does not fall back to the browser's monospace default.

The "Submit changes" and "Cancel" buttons SHALL be laid out below the textarea (stacked-row layout), NOT inline to its right. This guarantees that vertical growth of the textarea does not push the buttons off-screen or break the row's wrap behavior.

#### Scenario: Approve closes the gate and returns to the Active Run page

- **WHEN** the user clicks "Approve" on the Review Gate screen for a run `r1`
- **THEN** the UI POSTs to `/api/runs/r1/gate/:gate_id/resolve` with `{ result: "approved" }`
- **AND** on success the app route changes to the Active Run page for `r1` (NOT to the Dashboard)
- **AND** the Active Run page shows the workflow advancing past the gate

#### Scenario: Request changes captures feedback and returns to the Active Run page

- **WHEN** the user clicks "Request changes" on the Review Gate screen for a run `r1`, types feedback into the textarea, and submits
- **THEN** the UI POSTs `{ result: "rejected", changes: <text> }` to the resolve endpoint
- **AND** on success the app route changes to the Active Run page for `r1` (NOT to the Dashboard)
- **AND** the run banner reflects the SKILL's next move (typically re-running the gated agents)

#### Scenario: Request-changes input is a multi-line textarea

- **WHEN** the user clicks the "Request changes" button and the inline form opens
- **THEN** the text input rendered is a `<textarea>` element with at least 4 visible rows
- **AND** the element's computed CSS `resize` is `vertical`
- **AND** dragging the textarea's resize handle increases its height but does NOT change its width
- **AND** the textarea's font family is the same as the surrounding page text (no monospace fallback)

#### Scenario: Submit and Cancel buttons sit below the textarea

- **WHEN** the inline "Request changes" form is open
- **THEN** the "Submit changes" and "Cancel" buttons render on a row below the textarea, not inline to its right
- **AND** resizing the textarea taller does not push either button off-screen or out of the visible viewport region of the form
