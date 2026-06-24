## ADDED Requirements

### Requirement: Project screen surfaces in-flight runs and blocks launching new ones

The Project screen SHALL derive whether a run is in flight for the currently displayed project by polling `GET /api/runs?projectId=<id>` on a fixed cadence (no greater than every 2.5 seconds) and treating any returned run whose `status` equals `"running"` as active for that project. While at least one run is active for the project, the Project screen SHALL:

- Render a banner near the top of the page body that displays the active run's kind in human-readable form (mapping `RunKind` values: `feature` → `Feature workflow`, `prereq` → `Prerequisite setup`, `claudboard-<skill>` → `Claudboard <skill>`, anything else → `Run in progress`) followed by the literal text ` running — open run`. The banner SHALL act as a clickable link that navigates the app to the Active Run view for that run's id.
- Disable the TopBar `Start Feature` button.
- Disable every prereq launch button rendered by `FoundationChain`, `MaintenanceGrid`, and `SetupBanner`.
- Disable every skill button rendered by `ClaudboardLauncher`.

Every disabled button described above SHALL expose the tooltip `A run is in progress — only one at a time`.

When the active run completes (status flips to `done` or `failed`) the banner SHALL disappear within one polling cycle, the buttons SHALL re-enable, and the page SHALL refetch prereqs (`api.getRepoPrereqs(projectId)`) so any state produced by the completed run is reflected.

If multiple runs are concurrently active for the project (the server permits this today), the banner SHALL display information about exactly one of them — the most recently created — and the link SHALL navigate to that run.

#### Scenario: Banner appears when a claudboard run is in flight

- **GIVEN** the user is on the Project screen for project `p1`
- **AND** `GET /api/runs?projectId=p1` returns a single run with `kind: "claudboard-analyse"` and `status: "running"`
- **WHEN** the polling cycle resolves
- **THEN** the screen renders a banner reading `Claudboard analyse running — open run`
- **AND** the banner is a link whose click navigates to the Active Run view for that run's id

#### Scenario: All launch buttons disabled while a run is in flight

- **GIVEN** the Project screen for project `p1`
- **AND** the foundation is complete (`fdnExists` is true) so MaintenanceGrid, FoundationChain, and ClaudboardLauncher are all rendered
- **AND** an active run exists for `p1`
- **WHEN** the screen renders
- **THEN** the TopBar `Start Feature` button is rendered in a disabled state
- **AND** every prereq launch button across FoundationChain and MaintenanceGrid is rendered in a disabled state
- **AND** every Analyse / Generate / Workflow button in ClaudboardLauncher is rendered in a disabled state
- **AND** each disabled button exposes the tooltip `A run is in progress — only one at a time`

#### Scenario: Banner and disables clear when the run completes

- **GIVEN** the Project screen for project `p1` is showing the active-run banner for a `claudboard-analyse` run
- **WHEN** a polling cycle returns the same run with `status: "done"` and no other runs are running
- **THEN** the banner is removed from the DOM within one further polling cycle
- **AND** the previously disabled launch buttons are re-enabled
- **AND** `api.getRepoPrereqs(projectId)` is invoked to refresh prereq state

#### Scenario: Survives navigation away and back

- **GIVEN** a run was launched for project `p1` from the Project screen and remains `status: "running"`
- **WHEN** the user navigates to a different screen and then back to the Project screen for `p1`
- **THEN** within one polling cycle the banner reappears and the launch buttons are disabled
- **AND** this happens without the user needing to relaunch the run or refresh the page

#### Scenario: Polling pauses while the tab is hidden

- **GIVEN** the Project screen is mounted but the browser tab is in `document.visibilityState = "hidden"`
- **WHEN** time passes
- **THEN** no `GET /api/runs?projectId=...` requests are issued
- **AND** when the tab becomes visible again, polling resumes on the next cadence tick

### Requirement: Active Run pipeline pane is run-kind aware

The `buildPipelineFromEvents` function SHALL accept the run's `kind` (a `RunKind` value, optionally undefined) as a parameter and SHALL only seed the 7-entry feature-workflow `PHASE_TEMPLATE` when `kind === "feature"` or `kind` is undefined. For runs whose `kind` is known to be `"prereq"` or any `claudboard-<skill>` value, the function SHALL NOT seed the template; it SHALL produce only the phases derived from `phase-start` events present in the supplied event stream.

When the pipeline pane has zero phases to render for a non-feature run, it SHALL render a single placeholder row reading `CLI run · see stream →` in place of the phase list. The placeholder is non-interactive (no click handler). The Stream and Telemetry panes are unaffected.

The undefined-kind fallback exists to preserve current behavior during the brief window between component mount and the `api.getRun(runId)` response resolving for a feature run, so the user does not see a placeholder flash before the template appears.

#### Scenario: Feature run still seeds the 7-phase template

- **GIVEN** a `feature` run with no phase events received yet
- **WHEN** `buildPipelineFromEvents([], "feature")` is called
- **THEN** the returned phase list has exactly 7 entries with `status: "pending"` and titles matching the existing `PHASE_TEMPLATE`

#### Scenario: Claudboard run produces no phantom phases

- **GIVEN** a `claudboard-analyse` run whose event stream contains only `transcript-message` events and a `status-change` to `done`, with no `phase-start` events
- **WHEN** `buildPipelineFromEvents(events, "claudboard-analyse")` is called
- **THEN** the returned phase list is empty

#### Scenario: Prereq run produces only the phases it emits

- **GIVEN** a `prereq` run whose event stream contains exactly one `phase-start { num: 1, title: "Install Skill" }` followed by `phase-complete { num: 1 }`
- **WHEN** `buildPipelineFromEvents(events, "prereq")` is called
- **THEN** the returned phase list contains exactly one entry with `num: 1`, `title: "Install Skill"`, `status: "done"`
- **AND** none of the 7 feature-workflow template phases appear in the result

#### Scenario: Empty phase list renders the placeholder row

- **GIVEN** the Active Run screen has loaded a run with `kind: "claudboard-analyse"`
- **AND** the pipeline derived from events is empty
- **WHEN** the pipeline pane renders
- **THEN** the pane displays a single non-interactive row with text `CLI run · see stream →`
- **AND** none of the 7 feature-workflow phase titles appear in the DOM

#### Scenario: Undefined kind defers to feature template

- **GIVEN** a feature run whose `api.getRun(runId)` call has not yet resolved (`run` state is null, so `kind` is undefined)
- **WHEN** `buildPipelineFromEvents([], undefined)` is called
- **THEN** the returned phase list has exactly 7 entries matching the `PHASE_TEMPLATE` (same as the `kind === "feature"` path)
- **AND** the user does not see the `CLI run · see stream →` placeholder during the brief hydration window
