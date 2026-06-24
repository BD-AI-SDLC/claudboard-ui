## REMOVED Requirements

### Requirement: ClarifyGate screen captures free-form answers per question

**Reason:** Page-takeover treatment is disproportionate to the typical clarification interaction (a sentence or two per question). Replaced by an inline composer rendered on the Active Run page so the user can read and answer the question without leaving the live stream context. The `ClarifyGate` component, its CSS, its test file, and the `App.tsx` mount branch are deleted.

**Migration:** No data migration. The MCP tool, WebSocket events, REST resolve endpoint, and DB schema are unchanged; the only difference is where the answer is collected in the UI. See the new requirement `Active Run page renders an inline ClarifyComposer when a clarify gate is open`.

## ADDED Requirements

### Requirement: Active Run page renders an inline ClarifyComposer when a clarify gate is open

When the active run's `openGate.kind === 'clarify'`, the Active Run page SHALL render a `ClarifyComposer` component pinned below the live stream area. The composer SHALL:

- Read the gate's `payload.questions: string[]` from the run state populated by the existing `gate-request` WebSocket event handler.
- Render a single-line `<input>` labeled with the question text when `questions.length === 1` and the question is ≤80 characters.
- Render N labeled `<textarea>` elements stacked vertically otherwise (multiple questions, or any single question longer than 80 characters).
- Always render a Submit button and a Skip button. Submit POSTs `{ answers: string[] }` (index-aligned with `questions`) to `/api/runs/:runId/gate/:gateId/resolve`. Skip POSTs `{ skipped: true }`.
- Disable both buttons while a resolve request is in flight to prevent double-submit.
- Unmount when the `gate-resolved` WebSocket event clears `openGate` in the run state.

The composer SHALL NOT enforce that all inputs be non-empty before Submit is enabled. Empty strings are semantically "no preference, you decide" — the orchestrator interprets blanks.

The composer's pinned position SHALL NOT interfere with the live stream's existing auto-scroll behavior: stream messages continue to append above the composer as they arrive.

#### Scenario: Single-question short clarify renders as single-line input

- **GIVEN** an active run with `openGate.kind === 'clarify'` and `payload.questions = ["Which workspace are we targeting?"]`
- **WHEN** the Active Run page renders
- **THEN** a single-line `<input>` is rendered below the live stream
- **AND** no separate gate page is opened

#### Scenario: Multi-question clarify renders as stacked textareas

- **GIVEN** an active run with `openGate.kind === 'clarify'` and `payload.questions` containing three questions
- **WHEN** the Active Run page renders
- **THEN** three labeled `<textarea>` elements are rendered, one per question, in order

#### Scenario: Long single question renders as textarea, not single-line input

- **GIVEN** an active run with `openGate.kind === 'clarify'` and one question whose length exceeds 80 characters
- **WHEN** the Active Run page renders
- **THEN** a `<textarea>` is rendered, not a single-line `<input>`

#### Scenario: Submit posts index-aligned answers

- **GIVEN** the composer is rendered with three questions and the user has typed `"a"`, `""`, `"c"` into the three fields (the middle field left empty)
- **WHEN** the user submits
- **THEN** the client POSTs `{ answers: ["a", "", "c"] }` to the resolve endpoint

#### Scenario: Skip posts the skip flag

- **GIVEN** the composer is rendered (any number of questions, any content)
- **WHEN** the user clicks Skip
- **THEN** the client POSTs `{ skipped: true }` to the resolve endpoint

#### Scenario: Composer unmounts on gate-resolved

- **GIVEN** the composer is rendered for an open clarify gate
- **WHEN** the `gate-resolved` WebSocket event arrives for this gate
- **THEN** the composer is no longer mounted on the page
- **AND** the live stream continues to receive subsequent run output

### Requirement: ClarifyComposer keyboard affordances

The `ClarifyComposer` SHALL support keyboard shortcuts as follows:

- **Single-input layout** (one short question): Enter submits the answer. Shift+Enter is not applicable (single-line `<input>`).
- **Multi-input layout** (textareas): Enter inserts a newline inside the focused textarea (default browser behavior). Cmd+Enter (macOS) or Ctrl+Enter (other platforms) submits all answers from any focused field. Tab moves focus to the next field; Shift+Tab to the previous.

Both layouts also support clicking Submit or Skip with the pointer. Keyboard support is an additive affordance, not a substitute.

#### Scenario: Enter submits a single-input composer

- **GIVEN** the composer is rendered with one short question and the user has typed `"meas"` into the input
- **WHEN** the user presses Enter
- **THEN** the client POSTs `{ answers: ["meas"] }` to the resolve endpoint

#### Scenario: Cmd-Enter submits a multi-input composer

- **GIVEN** the composer is rendered with two questions and the user has typed answers into both textareas, focus in either textarea
- **WHEN** the user presses Cmd+Enter (macOS) or Ctrl+Enter (other platforms)
- **THEN** the client POSTs `{ answers: ["<first>", "<second>"] }` to the resolve endpoint

#### Scenario: Enter in a textarea inserts a newline, does not submit

- **GIVEN** the composer is rendered as multi-input with focus in one textarea
- **WHEN** the user presses Enter (without modifier)
- **THEN** a newline is inserted in the textarea
- **AND** no submit is triggered

## MODIFIED Requirements

### Requirement: Gate routing in App.tsx branches on gate kind

The `App.tsx` gate route SHALL branch on the gate's `kind`:

- `kind === 'spec+plan'` → mount `<ReviewGate>` (existing behavior, unchanged).
- `kind === 'clarify'` → do NOT mount a page component. Instead, change the application route to the Active Run page for the gate's owning `runId`. The inline `<ClarifyComposer>` on Active Run renders the gate.
- Unknown kinds → fall back to mounting `<ReviewGate>` so the user sees *something* rather than a blank screen.

The kind continues to be threaded into the route at navigation time as established by `add-clarification-gate` (the `gate-request` event carries `gateKind`; the runs list carries `openGate.kind`).

#### Scenario: Spec+plan gate continues to use ReviewGate

- **GIVEN** an active run with an open spec+plan gate
- **WHEN** the user clicks the gate banner's Review button
- **THEN** the App route changes to `'gate'` with `gateKind === 'spec+plan'`
- **AND** the `<ReviewGate>` component is mounted

#### Scenario: Clarify gate does not open a separate page

- **GIVEN** an active run with an open clarify gate
- **WHEN** the user navigates to the gate (via banner pointer, sidebar click, or direct URL to `/gate/:gateId`)
- **THEN** the App route resolves to the Active Run page for the gate's owning run
- **AND** no `ClarifyGate` page component is mounted (because the component no longer exists)
- **AND** the inline `<ClarifyComposer>` is visible at the bottom of Active Run

#### Scenario: Sidebar opens Active Run for clarify gates

- **GIVEN** a run with `openGate.kind === 'clarify'` in the sidebar's runs list
- **WHEN** the user clicks the run's entry in the sidebar
- **THEN** the Active Run page opens for that run
- **AND** the composer is already visible at the bottom

### Requirement: RunBanner copy reflects the gate kind

The `RunBanner` SHALL render different content depending on the gate's kind:

- `clarify` → render a one-line pointer "Awaiting your input below" (or equivalent wording). The pointer SHALL be clickable; clicking it scrolls the page to the inline `ClarifyComposer` via `element.scrollIntoView({ behavior: 'smooth', block: 'end' })`. No "Review" button.
- `spec+plan` (or any other) → existing copy and Review button (unchanged from the prior `add-clarification-gate` requirement; the prior wording "review spec + plan to continue" stays).

#### Scenario: Banner for a clarify gate points to the composer

- **GIVEN** a run is in `paused-gate` with an open clarify gate
- **WHEN** the Active Run screen renders the banner
- **THEN** the banner shows a "Awaiting your input below" pointer
- **AND** the banner does NOT show a "Review" button
- **AND** clicking the pointer scrolls the page so the ClarifyComposer is in view

#### Scenario: Banner for a spec+plan gate still uses Review button

- **GIVEN** a run is in `paused-gate` with an open spec+plan gate
- **WHEN** the Active Run screen renders the banner
- **THEN** the banner shows the existing "review spec + plan to continue" copy
- **AND** the banner shows a clickable "Review" button that navigates to `ReviewGate`
