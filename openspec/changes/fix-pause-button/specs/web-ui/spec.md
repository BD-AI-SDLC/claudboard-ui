## ADDED Requirements

### Requirement: Active Run Stream pane exposes a working Pause/Resume control

The Active Run page's Stream pane SHALL render a single interactive control in its header that toggles between Pause and Resume based on the run's current status:

- When `status === 'running'`, the control SHALL be labelled `Pause`, render the `pause` icon, and on click POST to `/api/runs/:id/pause`.
- When `status === 'paused-user'`, the control SHALL be labelled `Resume`, render the `play` icon, and on click POST to `/api/runs/:id/resume`.
- When `status` is any other value (`paused-gate`, `done`, `failed`, `dead`, `suspended`, or any future status that does not transition through pause), the control SHALL render as visibly disabled (greyed-out foreground, `disabled` attribute, `cursor: not-allowed`), SHALL retain the neutral `Pause` label and `pause` icon, and SHALL NOT fire a request on click.

The control SHALL NOT be hidden in any state — its presence is constant so the user always sees that the affordance exists.

#### Scenario: Running run shows Pause and pauses on click

- **GIVEN** the Active Run page is open on a run with `status: 'running'`
- **WHEN** the user clicks the control in the Stream pane header
- **THEN** the UI POSTs to `/api/runs/:id/pause`
- **AND** on the subsequent `status-change` WebSocket event with `payload.status === 'paused-user'`, the control re-renders labelled `Resume` with the `play` icon

#### Scenario: Paused run shows Resume and resumes on click

- **GIVEN** the Active Run page is open on a run with `status: 'paused-user'`
- **WHEN** the user clicks the control in the Stream pane header
- **THEN** the UI POSTs to `/api/runs/:id/resume`
- **AND** on the subsequent `status-change` WebSocket event with `payload.status === 'running'`, the control re-renders labelled `Pause` with the `pause` icon

#### Scenario: Non-pausable statuses render the control disabled

- **GIVEN** the Active Run page is open on a run with `status` in `{'paused-gate', 'done', 'failed', 'dead'}`
- **WHEN** the page renders
- **THEN** the control is visible in the Stream pane header
- **AND** the control has the `disabled` HTML attribute
- **AND** the control carries a class indicating disabled styling
- **AND** clicking the control does NOT issue any HTTP request

### Requirement: Pause/Resume control coalesces double-clicks via in-flight flag

While a pause or resume request is in flight (POST issued, response not yet received AND no `status-change` event yet received for the run), the control SHALL be disabled. Subsequent clicks during this window SHALL NOT issue additional HTTP requests.

The in-flight flag SHALL be cleared by either of:

- The HTTP response (success or error) returning from the original POST.
- A `status-change` WebSocket event for the same run transitioning to `running` or `paused-user`, whichever arrives first.

#### Scenario: Double-click fires exactly one request

- **GIVEN** the Active Run page is open on a `running` run and the Pause control is enabled
- **WHEN** the user clicks the control twice within 50 ms (before either the HTTP response or the WS event has arrived)
- **THEN** exactly one POST to `/api/runs/:id/pause` is issued
- **AND** the second click is a no-op

#### Scenario: WS event clears the in-flight flag

- **GIVEN** the user has clicked the Pause control and the HTTP response has not yet arrived
- **WHEN** a `status-change` event with `payload.status: 'paused-user'` is received for the run
- **THEN** the control becomes enabled again (with the Resume label and play icon)
- **AND** the control is responsive to further clicks without waiting for the original HTTP response to resolve

### Requirement: Pause/Resume control surfaces request failures inline

When the POST to `/api/runs/:id/pause` or `/api/runs/:id/resume` rejects (network error, non-2xx response, JSON parse error, etc.), the UI SHALL render the error message as a single-line inline message immediately below the control in error styling. The message SHALL auto-clear after 4 seconds.

The control's label SHALL NOT be flipped on error — the label tracks the WebSocket-reported status only, so a 409 from the server (e.g. status changed underneath) does not produce a misleading label.

#### Scenario: Network failure surfaces a transient inline error

- **GIVEN** the Active Run page is open on a `running` run
- **WHEN** the user clicks the Pause control and the POST rejects with `Error('boom')`
- **THEN** an inline error message `boom` is rendered under the control within 100 ms
- **AND** 4000 ms after the error first rendered, the inline error message is removed from the DOM
- **AND** the control's label remains `Pause` throughout (it has not transitioned to `Resume` because no `status-change` event arrived)
