## ADDED Requirements

### Requirement: ClarifyGate screen captures free-form answers per question

The web UI SHALL render a `ClarifyGate` screen when the user navigates to an open gate whose `kind === 'clarify'`. The screen SHALL contain:

- A header explaining that the orchestrator needs more context to write a precise spec.
- One labeled `<textarea>` per question in the gate's `payload.questions` array, in the order the questions were submitted by the orchestrator. The textarea is initially empty.
- A **Submit** button. On click, POST to `/api/runs/:runId/gate/:gateId/resolve` with body `{ answers: string[] }` where each element is the corresponding textarea's current value (in order). Empty strings are sent as-is; they represent "no preference, you decide" and the orchestrator interprets accordingly.
- A **Skip** button. On click, POST the same endpoint with body `{ skipped: true }`. The Skip button is always enabled.
- A `resolving` state that disables both buttons between submit and the API response, to prevent double-submit.

On successful resolution the screen calls the `onResolved` callback (typically navigating back to the dashboard or active run view).

The `ClarifyGate` screen SHALL NOT enforce that all textareas be non-empty before Submit is enabled. The orchestrator is the consumer; it can choose how to interpret blanks.

#### Scenario: Render with the gate's questions

- **GIVEN** an open gate with `kind === 'clarify'` and `payload.questions = ["Which workspace?", "Who are the actors?", "Auth requirements?"]`
- **WHEN** the user navigates to the gate
- **THEN** the ClarifyGate screen renders three textareas, each labeled with the corresponding question text, in order

#### Scenario: Submit sends answers in array order

- **GIVEN** the user has typed `"meas"` into the first textarea and `"platform admin"` into the second; the third is empty
- **WHEN** the user clicks Submit
- **THEN** the client POSTs `{ answers: ["meas", "platform admin", ""] }` to the resolve endpoint

#### Scenario: Skip sends the skip flag

- **GIVEN** the user has typed nothing
- **WHEN** the user clicks Skip
- **THEN** the client POSTs `{ skipped: true }` to the resolve endpoint

#### Scenario: Buttons disable during submission

- **GIVEN** the user has clicked Submit and the API call is in flight
- **WHEN** the user attempts to click Submit again
- **THEN** the click has no effect (the button is disabled)

### Requirement: Gate routing in App.tsx branches on gate kind

The `App.tsx` gate route SHALL branch on the gate's `kind`:

- `kind === 'spec+plan'` → mount `<ReviewGate>` (existing behavior, unchanged).
- `kind === 'clarify'` → mount `<ClarifyGate>` with the gate's `payload.questions` passed as a prop.
- Unknown kinds → fall back to `<ReviewGate>` so the user sees *something* rather than a blank screen.

The kind SHALL be threaded into the route at navigation time: callers of `goGate(gateId)` (`ActiveRun.onReviewGate`, `Sidebar.onNavigateGate`) SHALL pass the kind as a second argument, sourced from the `gate-request` WebSocket event's `gateKind` field (in `ActiveRun`'s case) or from the `Run.openGate.kind` field of the `runs` list (in `Sidebar`'s case). A new `gateKind` state in `App.tsx` SHALL track it alongside `gateId`.

#### Scenario: Clarify gate opens directly to ClarifyGate

- **GIVEN** an active run with an open clarify gate
- **WHEN** the user clicks the gate banner's Review button
- **THEN** the App route changes to `'gate'` with `gateKind === 'clarify'`
- **AND** the `<ClarifyGate>` component is mounted (not `<ReviewGate>`)

#### Scenario: Spec+plan gate continues to use ReviewGate

- **GIVEN** an active run with an open spec+plan gate
- **WHEN** the user clicks the gate banner's Review button
- **THEN** the App route changes to `'gate'` with `gateKind === 'spec+plan'`
- **AND** the `<ReviewGate>` component is mounted

### Requirement: RunBanner copy reflects the gate kind

The `RunBanner` SHALL show different prompt text depending on the gate's kind:

- `clarify` → "Answer clarification questions" (or equivalent wording — short, action-oriented)
- `spec+plan` (or any other) → existing copy ("review spec + plan to continue")

The Review button label MAY remain "Review" for both kinds; the disambiguation is in the prompt copy.

#### Scenario: Banner copy when a clarify gate is open

- **GIVEN** a run is in `paused-gate` with an open clarify gate
- **WHEN** the Active Run screen renders the banner
- **THEN** the prompt text includes "clarification" or "answer"
- **AND** does NOT include "spec" or "plan"
