## ADDED Requirements

### Requirement: Inline question-stream cards for in-flight prereq runs

The Project screen SHALL render an "Interview" section below the FoundationChain and above the MaintenanceGrid whenever an interactive prereq run is in progress for the project. The section SHALL subscribe to the active run's WebSocket stream and accumulate every `interactive-question` event into a local question history. The visual idiom SHALL match Variant C from `ui/designs/Interview Designs.html` (inline stream cards).

Each entry in the history SHALL render in one of two visual states:

- **Submitted** (the user has already answered this question): a collapsed one-row card showing the timestamp, the question text (muted), the chosen answer (green check + label), and an Edit affordance (the affordance is rendered for visual fidelity but is non-functional in v1 — clicking it SHALL be a no-op with no UI feedback indicating breakage).
- **Pending** (the most recent unanswered question): an expanded card showing a violet header chip ("QUESTION N · <header>" where N is the 1-indexed position in the history and header is the question's `header` field), the question text rendered in the question-text type style, the optional `why` field as a dimmed italic line beneath the question (omitted when absent), and the option list rendered as a radio group with one `.ans-opt` row per option (label + optional description). Below the options sit an optional note input, a Skip ghost button, and a Submit primary button.

When the user clicks Submit, the component SHALL POST `/api/runs/:id/cli-answer` with `{ toolUseId: <entry.toolUseId>, answers: [{ answer: <selected option label, or note text when no option is selected> }] }`. On 200 the entry transitions to Submitted. On any non-200 response the entry remains Pending and an inline error chip appears on the card showing the server message.

When the user clicks Skip, the component SHALL POST the same endpoint with `answers: []`.

The component SHALL NOT render any history entries until the first `interactive-question` event arrives — there is no empty state when a run is in progress but no question has been asked yet. The component SHALL unmount when the active run's status transitions to `done` or `failed`.

The component is scoped exclusively to the prereq CLI flow. The SDK feature-workflow flow continues to use the existing `InterviewPane` (Gate-based, all-answers-at-once) without modification.

#### Scenario: First interactive question renders inline below FoundationChain

- **GIVEN** the Project page is open and a `/claudboard-workflow` run has just been started for this project
- **WHEN** the server broadcasts a WebSocket event `{ kind: 'interactive-question', payload: { toolUseId: 'toolu_a', questions: [{ question: 'Which branch type prefixes?', header: 'Branch types', options: [{ label: 'feature, fix, refactor', description: 'Matches existing convention' }, { label: 'feature, bugfix, hotfix' }] }] } }`
- **THEN** an Interview section appears between FoundationChain and MaintenanceGrid
- **AND** the section contains exactly one Pending card showing the violet header `QUESTION 1 · Branch types`, the question text, and two option rows

#### Scenario: Submitting an option collapses the card and POSTs the answer

- **GIVEN** the Pending card from the previous scenario is visible
- **WHEN** the user clicks the option `feature, fix, refactor` and then clicks Submit
- **THEN** the component POSTs `/api/runs/<runId>/cli-answer` with body `{ toolUseId: 'toolu_a', answers: [{ answer: 'feature, fix, refactor' }] }`
- **AND** on a 200 response the card collapses to a Submitted one-liner showing `? Which branch type prefixes? → ✓ feature, fix, refactor`

#### Scenario: Sequential questions render as collapsed + pending

- **GIVEN** the first question has been submitted and the previous scenario completed
- **WHEN** a second `interactive-question` event arrives with `toolUseId: 'toolu_b'`, a new question, and a new header
- **THEN** the section now shows the first card collapsed (Submitted) above a new Pending card for the second question
- **AND** the violet header on the new card reads `QUESTION 2 · <new header>`

#### Scenario: Skip POSTs an empty answers array

- **GIVEN** a Pending card is visible
- **WHEN** the user clicks Skip
- **THEN** the component POSTs `/api/runs/<runId>/cli-answer` with body `{ toolUseId: <id>, answers: [] }`
- **AND** the card collapses to Submitted showing `→ (skipped)` in place of the answer label

#### Scenario: Server-side error surfaces inline on the card

- **GIVEN** a Pending card is visible
- **WHEN** the user clicks Submit and the POST returns 409 with `{ error: 'Run has exited' }`
- **THEN** the card remains Pending and a small error chip appears below the actions row showing the server message
- **AND** the user can click Submit or Skip again (the component does not lock the card on error)

#### Scenario: Component unmounts when the run completes

- **GIVEN** the Interview section is visible with one or more cards (submitted and/or pending)
- **WHEN** the active run's status transitions to `done` or `failed`
- **THEN** the Interview section is removed from the DOM on the next render

#### Scenario: Analyse run never shows the Interview section

- **GIVEN** the user starts a `/analyse` run
- **WHEN** the run executes without ever emitting an `interactive-question` event
- **THEN** the Interview section never appears between FoundationChain and MaintenanceGrid
- **AND** the rest of the Project page renders identically to its behavior before this change
