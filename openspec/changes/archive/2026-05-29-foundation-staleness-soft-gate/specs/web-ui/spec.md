## MODIFIED Requirements

### Requirement: Five screens at visual parity with bosch-workflow

The UI SHALL implement five screens with layouts, typography, color tokens, spacing, and component shapes that visually match the bosch-workflow design at `/Users/LUP1BG/Documents/BoschProjects/bosch-workflow/project`:

- **Dashboard** — workspace overview, metrics tiles, repository list with health bars, recent runs panel, "vertical operations" grid.
- **Project** — per-Project deep view including prereq panel. The page composition depends on whether all three foundation artifacts (`analyse`, `generate`, `claudboard-workflow`) exist on disk:
  - **Setup mode** (any foundation artifact is `missing`): renders the `SetupBanner` ("Set up Mileva for this repo") above the full `FoundationChain` (3 step cards), with `MaintenanceGrid` (2 cards) below.
  - **Operational mode** (all three foundation artifacts exist, regardless of staleness): the `SetupBanner` SHALL NOT render. Instead, if at least one foundation artifact is `stale`, a `FoundationDriftStrip` SHALL render at the top of the body. The `MaintenanceGrid` SHALL render above the Foundation section in this mode. The Foundation section SHALL continue to render the full `FoundationChain` (3 step cards) — there SHALL NOT be a compact or collapsed-summary surface. Per-op staleness is communicated by the `OperationCard` reason line on each card.
- **Kickoff** — feature prompt entry and submit. No scope picker for any topology; the form is identical regardless of the Project's `topology` value. When the active Project is in Operational mode AND has at least one stale foundation artifact, a single-line drift hint SHALL render above the prompt textarea.
- **Active Run** — split view with phases/agents (left), live stream (middle), telemetry rail (right), run banner with gate CTA when applicable.
- **Review Gate** — spec + plan side-by-side, approve / request-changes actions.

Each screen SHALL use the Geist and Geist Mono fonts and the existing color tokens (`--teal`, `--amber`, `--violet`, `--bg`, `--bg-2`, `--text`, `--text-2`, `--muted`, `--dim`, `--border`).

The `Project.topology` value MAY be rendered as a display badge on the Project card and Project view (e.g. "Monolith" / "Monorepo" / "Workspace"), but SHALL NOT drive any branching in form layout, kickoff inputs, or submitted request shape.

#### Scenario: Dashboard renders all required regions

- **WHEN** the user opens the dashboard with at least one Project registered
- **THEN** the page shows: topbar with crumb + Start-feature CTA, h1 title, four metric tiles (active runs, awaiting gate, in review, merged this week), repositories card with rows matching the design's grid, recent runs panel, and the vertical operations grid

#### Scenario: Kickoff form is identical across topologies

- **WHEN** the user opens the Kickoff screen for a monolith Project
- **THEN** the form shows a prompt textarea and a submit button, with no scope dropdown
- **AND WHEN** the user opens the Kickoff screen for a monorepo Project
- **THEN** the form is identical — no scope dropdown is rendered
- **AND WHEN** the user opens the Kickoff screen for a multi-repo-workspace Project
- **THEN** the form is identical — no scope dropdown is rendered

#### Scenario: Kickoff submits a prompt-only request

- **WHEN** the user submits the Kickoff form with prompt `"Add invoice PDF"` for any Project
- **THEN** the UI POSTs `/api/runs` with body `{ projectId, target, prompt: "Add invoice PDF" }`
- **AND** the request body does NOT include a `scope` field
- **AND** the request body does NOT include a `workspaceRoot` field

#### Scenario: Active Run shows three panes

- **WHEN** the user opens a running run in the default `split` layout
- **THEN** the page shows three panes — Pipeline (left), Live stream (middle), Run telemetry (right) — with the run banner at the top

#### Scenario: Review Gate shows spec and plan

- **WHEN** the user navigates to an open gate via the Run banner's "Review spec + plan" CTA
- **THEN** the page renders the BDD spec text with Gherkin keyword highlighting and the architect plan as a numbered list of checkpoints with files and contracts; two action buttons are present: "Approve" and "Request changes"

#### Scenario: Topology badge is informational

- **WHEN** a Project card renders a `topology` badge
- **THEN** the badge text reflects the topology (e.g. "Workspace" for `multi-repo-workspace`)
- **AND** clicking the card behaves identically regardless of topology — it routes to the Project view for that single Project

#### Scenario: Project screen in Setup mode renders the banner and full Foundation chain

- **GIVEN** a Project whose prereq states are `analyse: done`, `generate: missing`, `claudboard-workflow: missing`
- **WHEN** the user opens the Project screen
- **THEN** the `SetupBanner` renders with the "Set up Mileva for this repo" headline and the `▶ Run /mileva-generate` CTA
- **AND** the `FoundationChain` renders below the banner with three step cards in order (analyse `done`, generate `next`, workflow `locked`)
- **AND** the `MaintenanceGrid` renders below the FoundationChain
- **AND** the `FoundationDriftStrip` does NOT render
- **AND** the `FoundationCollapsed` view does NOT render

#### Scenario: Project screen in Operational mode reorders Maintenance above Foundation

- **GIVEN** a Project whose prereq states are `analyse: done`, `generate: done`, `claudboard-workflow: done` (all fresh)
- **WHEN** the user opens the Project screen
- **THEN** the `SetupBanner` does NOT render
- **AND** the `FoundationDriftStrip` does NOT render
- **AND** the `MaintenanceGrid` renders above the Foundation section
- **AND** the full `FoundationChain` (3 step cards in DAG order) renders below the MaintenanceGrid
- **AND** there is no compact-summary surface and no expand/collapse caret on the Foundation section

#### Scenario: Operational mode with drift shows the strip and chips the Refresh card

- **GIVEN** a Project whose prereq states are `analyse: done`, `generate: stale (upstream-changed)`, `claudboard-workflow: stale (upstream-changed)`
- **WHEN** the user opens the Project screen
- **THEN** the `SetupBanner` does NOT render
- **AND** the `FoundationDriftStrip` renders with the copy `↻  Foundation drift detected — 2 of 3 artifacts stale. Run Refresh below to update, or re-run individual steps.`
- **AND** the `MaintenanceGrid`'s Refresh card displays a `Recommended` chip next to its title
- **AND** the full `FoundationChain` renders below the MaintenanceGrid with each card in its computed state — the Generate card shows the `Stale` status badge and the reason line `Stale — Analyse was re-run`, and the Feature-workflow card shows the `Stale` badge and the reason line `Stale — Generate was re-run`

#### Scenario: Kickoff screen renders the drift hint when foundation is stale-but-complete

- **GIVEN** a Project whose foundation exists but at least one foundation prereq is `stale`
- **WHEN** the user opens the Kickoff screen for that Project
- **THEN** a single-line hint renders above the prompt textarea reading `↻ Foundation may be out of date — refresh first`
- **AND** the hint text "refresh first" is a link that navigates to the Project screen for that Project
- **AND** the form is otherwise unchanged — the prompt textarea, autonomy radio, and submit button render as today

#### Scenario: Kickoff screen omits the drift hint when foundation is fresh

- **GIVEN** a Project whose foundation prereqs are all `done`
- **WHEN** the user opens the Kickoff screen for that Project
- **THEN** no drift hint renders above the prompt textarea

### Requirement: Sidebar items are context-aware

Sidebar navigation items that target a screen requiring a `projectId`, `runId`, or `gateId` SHALL be enabled only when a sensible default target exists, and SHALL be visibly disabled with an explanatory tooltip otherwise. Enabled clicks SHALL smart-pick the target according to a documented rule per item.

| Item | Enabled when | Smart target | Disabled tooltip |
|---|---|---|---|
| Project · health | ≥1 active project | last-visited project if still active, else first by `createdAt` | "Attach a repo first" |
| Start feature | ≥1 active project AND at least one project has all three foundation artifacts on disk (`state` is `done` OR `stale` for each of `analyse`, `generate`, `claudboard-workflow`) | last-visited eligible project if still eligible, else first eligible by `createdAt` | "Complete foundation setup on at least one project first" |
| Active run | ≥1 in-progress run | most recent non-terminal run | "Start a feature first" |
| Review gate | ≥1 open gate | gate with oldest `created_at` | "No open gates" |

The Start Feature sidebar item and the TopBar Start Feature button SHALL share the same eligibility predicate (presence of all three foundation artifacts, regardless of staleness). Staleness alone SHALL NOT disable Start Feature on any surface.

The TopBar Start Feature button's disabled tooltip SHALL read `"Foundation is missing — run setup first"` when disabled because no eligible project exists; the equivalent sidebar item SHALL read `"Complete foundation setup on at least one project first"`.

#### Scenario: Sidebar disables Project · health when no projects exist

- **WHEN** the user opens the app with no attached projects
- **THEN** the sidebar "Project · health" item is rendered with a visibly disabled style (reduced opacity, no hover affordance) and a tooltip "Attach a repo first"

#### Scenario: Sidebar enables Start feature once any project has foundation artifacts

- **GIVEN** the user has attached one project whose `analyse`, `generate`, `claudboard-workflow` prereqs are all `done`
- **WHEN** the user opens the dashboard
- **THEN** the sidebar "Start feature" item is enabled
- **AND** clicking it routes to the Kickoff screen for that project (the most-recently-visited eligible project; if none has been visited, the first eligible project ordered by `createdAt`)

#### Scenario: Start Feature stays enabled when foundation exists but is stale

- **GIVEN** the user has attached one project whose `analyse: done`, `generate: stale`, `claudboard-workflow: done`
- **WHEN** the user opens the Project screen
- **THEN** the TopBar Start Feature button is enabled (not disabled and not tooltipped)
- **AND** clicking it routes to the Kickoff screen for that project
- **AND** the sidebar "Start feature" item is also enabled

#### Scenario: Start Feature disabled tooltip names foundation specifically

- **GIVEN** the user has attached one project whose `claudboard-workflow: missing`
- **WHEN** the user hovers the TopBar Start Feature button on that project's screen
- **THEN** the tooltip reads `"Foundation is missing — run setup first"`
- **AND** the button does not respond to clicks

### Requirement: Gate approval flow

The Review Gate screen SHALL provide actions to approve or reject the open gate. Approve SHALL POST `{ result: "approved" }`; reject SHALL open an inline form for the change request text and POST `{ result: "rejected", changes }`.

After either action resolves successfully, the user SHALL be returned to the Active Run page for the same `runId`, NOT to the Dashboard.

The "Request changes" text input SHALL be a multi-line `<textarea>` (initial `rows={4}`), NOT a single-line `<input>`. The textarea SHALL grow only vertically and SHALL have a `min-height` that accommodates at least 4 lines at the page's base font size.

The "Submit changes" and "Cancel" buttons SHALL be laid out below the textarea (stacked-row layout), NOT inline to its right.

#### Scenario: Approve closes the gate and returns to the Active Run page

- **WHEN** the user clicks "Approve" on the Review Gate screen for a run `r1`
- **THEN** the UI POSTs to `/api/runs/r1/gate/:gate_id/resolve` with `{ result: "approved" }`
- **AND** on success the app route changes to the Active Run page for `r1` (NOT to the Dashboard)
- **AND** the Active Run page shows the workflow advancing past the gate

#### Scenario: Request changes captures feedback and returns to the Active Run page

- **WHEN** the user clicks "Request changes" on the Review Gate screen for a run `r1`, types feedback into the textarea, and submits
- **THEN** the UI POSTs `{ result: "rejected", changes: <text> }` to the resolve endpoint
- **AND** on success the app route changes to the Active Run page for `r1` (NOT to the Dashboard)
- **AND** the run banner reflects the SKILL's next move

## ADDED Requirements

### Requirement: Foundation operation card surfaces the stale reason

When the Foundation `OperationCard` renders an op whose `visualState === 'stale'` and whose `prereq.staleReason` is non-null, the card SHALL render a single line of text below the description, of the form:

| `staleReason` value   | Rendered text                                  |
|-----------------------|------------------------------------------------|
| `aged-out`            | `Stale — older than 7 days`                    |
| `codebase-changed`    | `Stale — codebase changed since last run`      |
| `upstream-changed`    | `Stale — {Predecessor Title} was re-run`       |

For `upstream-changed`, `{Predecessor Title}` is the human-readable title of the immediate predecessor in `FOUNDATION_DEPS` (so `generate`'s reason reads "Analyse was re-run", `claudboard-workflow`'s reads "Generate was re-run").

When `prereq.staleReason` is null (legacy record persisted before the field was added) and `visualState === 'stale'`, the card SHALL render the `Stale` status badge but SHALL NOT render the reason line.

When `visualState !== 'stale'`, no reason line SHALL render regardless of `staleReason`.

#### Scenario: Aged-out reason rendered for the analyse op

- **GIVEN** the Project's `analyse` prereq has `state: 'stale'` and `staleReason: 'aged-out'`
- **WHEN** the Project screen renders in expanded Foundation mode
- **THEN** the Analyse `OperationCard` shows the `Stale` badge AND the text `Stale — older than 7 days` directly below the description

#### Scenario: Codebase-changed reason rendered for the analyse op

- **GIVEN** the Project's `analyse` prereq has `state: 'stale'` and `staleReason: 'codebase-changed'`
- **WHEN** the Project screen renders in expanded Foundation mode
- **THEN** the Analyse `OperationCard` shows the text `Stale — codebase changed since last run` below the description

#### Scenario: Upstream-changed reason names the predecessor

- **GIVEN** the Project's `generate` prereq has `state: 'stale'` and `staleReason: 'upstream-changed'`
- **WHEN** the Project screen renders in expanded Foundation mode
- **THEN** the Generate `OperationCard` shows the text `Stale — Analyse was re-run` below the description
- **AND WHEN** the Project's `claudboard-workflow` prereq has `state: 'stale'` and `staleReason: 'upstream-changed'`
- **THEN** the Feature-workflow `OperationCard` shows the text `Stale — Generate was re-run` below the description

#### Scenario: Legacy records with null staleReason render without a reason line

- **GIVEN** a prereq record that was persisted before the `staleReason` column existed (the column reads `null`) and `state: 'stale'`
- **WHEN** the Project screen renders the op
- **THEN** the `OperationCard` shows the `Stale` badge but no reason line
