## ADDED Requirements

### Requirement: ReviewGate renders actual spec and plan files from the gate payload

The `ReviewGate` component SHALL render content sourced exclusively from the `spec+plan` gate's payload (path manifest plus snapshot delivered by the server), with no placeholder fallback text. When the payload is missing or empty, the component SHALL render an explicit empty-state message rather than a hardcoded sample.

For each entry in `payload.specFiles`, the component SHALL produce one tab. The active tab's content SHALL render the corresponding file body through the existing Gherkin highlighter. Tab labels SHALL be the file basename.

The plan panel SHALL render `payload.plan.content` as Markdown. The previous structured `PlanCheckpoint[]` rendering path SHALL be removed along with its placeholder constant.

#### Scenario: Multi-file spec produces one tab per file

- **GIVEN** a `spec+plan` gate event with `specFiles = [{ path: ".../business-behavior-spec.md", content: "Feature: A …", … }, { path: ".../authorization-spec.md", content: "Feature: B …", … }]`
- **WHEN** the ReviewGate renders
- **THEN** two tabs appear in the spec column with labels `business-behavior-spec.md` and `authorization-spec.md`
- **AND** the active tab body renders the corresponding `content` through the Gherkin highlighter
- **AND** no PLACEHOLDER_SPEC text appears anywhere in the rendered output

#### Scenario: Plan renders as Markdown

- **GIVEN** a `spec+plan` gate event with `plan.content` containing markdown headings, lists, and tables
- **WHEN** the ReviewGate renders
- **THEN** the plan panel renders the markdown — headings become `<h*>`, lists become `<ul>/<ol>`, tables become `<table>`
- **AND** no PLACEHOLDER_PLAN checkpoint cards appear in the rendered output

#### Scenario: Empty payload renders explicit empty state

- **GIVEN** a `spec+plan` gate event with `specFiles = []` and `plan = null`
- **WHEN** the ReviewGate renders
- **THEN** an empty-state message is shown in both panels
- **AND** no placeholder spec text or checkpoint cards are shown

### Requirement: ReviewGate shows file provenance on each panel

The `ReviewGate` component SHALL display a provenance header on the spec panel and the plan panel. The provenance header SHALL include, for the currently-displayed file: the file path relative to the workspace root, the byte size, and a human-readable last-modified timestamp. When the active spec tab changes, the provenance header SHALL update to reflect the newly active file.

#### Scenario: Provenance header shows path, size, mtime

- **GIVEN** the active spec tab shows `specFiles[0]` with `path = "specs/001-FOO-1/business-behavior-spec.md"`, `size = 4096`, `mtime = "2026-05-20T14:30:00Z"`
- **WHEN** the ReviewGate renders
- **THEN** the spec panel header text includes `specs/001-FOO-1/business-behavior-spec.md`
- **AND** the header text shows the size (e.g., `4 KB` or `4096 bytes`)
- **AND** the header text shows a human-readable timestamp derived from the mtime

#### Scenario: Switching tabs updates provenance

- **GIVEN** the spec column has two tabs, `business-behavior-spec.md` (size 4 KB, mtime T1) active, and `authorization-spec.md` (size 2 KB, mtime T2) inactive
- **WHEN** the user clicks the second tab
- **THEN** the spec panel header text updates to show `authorization-spec.md`, 2 KB, and a timestamp derived from T2

### Requirement: ReviewGate surfaces snapshot/disk drift

When the ReviewGate is open, the component SHALL be able to refresh any file's content from disk via the `GET /gates/:id/files/:idx` endpoint. When the live content differs from the snapshot captured at gate-open (the server's `drifted` flag is true), the component SHALL display a drift banner on the affected panel inviting the reviewer to either keep reviewing the snapshot or refresh to the live content. Approving the gate SHALL not be blocked by the presence of drift; the reviewer chooses.

#### Scenario: Drift banner appears when disk content differs from snapshot

- **GIVEN** a ReviewGate is open and a refresh is triggered for `specFiles[0]`
- **AND** the server response for `GET /gates/<gateId>/files/0` has `drifted = true`
- **WHEN** the response is received
- **THEN** a drift banner appears on the spec panel
- **AND** the banner offers a control to switch the panel content from snapshot to live and back

#### Scenario: Drift banner does not block approval

- **GIVEN** a drift banner is visible on the spec panel
- **WHEN** the user clicks Approve
- **THEN** the gate resolves with `result: 'approved'` and is dismissed
