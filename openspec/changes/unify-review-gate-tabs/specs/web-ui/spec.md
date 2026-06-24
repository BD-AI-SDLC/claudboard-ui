## MODIFIED Requirements

### Requirement: Five screens at visual parity with bosch-workflow

The UI SHALL implement five screens with layouts, typography, color tokens, spacing, and component shapes that visually match the bosch-workflow design at `/Users/LUP1BG/Documents/BoschProjects/bosch-workflow/project`:

- **Dashboard** — workspace overview, metrics tiles, repository list with health bars, recent runs panel, "vertical operations" grid.
- **Project** — per-Project deep view including prereq panel.
- **Kickoff** — feature prompt entry and submit. No scope picker for any topology; the form is identical regardless of the Project's `topology` value.
- **Active Run** — split view with phases/agents (left), live stream (middle), telemetry rail (right), run banner with gate CTA when applicable.
- **Review Gate** — a single full-width content panel beneath the head, with a unified tab row spanning both spec files and the plan file; approve / request-changes actions.

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

#### Scenario: Review Gate shows spec and plan in a single tabbed panel

- **WHEN** the user navigates to an open gate via the Run banner's "Review spec + plan" CTA
- **THEN** the page renders a single full-width content panel beneath the head, with a unified tab row above it containing both spec files and the plan file
- **AND** the tab row shows two labeled groups separated by a vertical divider: a `SPECS:` group with one tab per spec file, then the divider, then a `PLAN:` group with one tab for the plan file
- **AND** the active tab content is rendered full-width using Gherkin keyword highlighting for spec tabs and ReactMarkdown for the plan tab
- **AND** two action buttons are present in the head: "Approve" and "Request changes"

#### Scenario: Topology badge is informational

- **WHEN** a Project card renders a `topology` badge
- **THEN** the badge text reflects the topology (e.g. "Workspace" for `multi-repo-workspace`)
- **AND** clicking the card behaves identically regardless of topology — it routes to the Project view for that single Project

## ADDED Requirements

### Requirement: Review Gate uses a single unified tab list spanning specs and plan

The Review Gate screen SHALL combine `specFiles: GateFileSnapshot[]` and `plan: GateFileSnapshot | null` into a single ordered tab list, with spec tabs appearing first (in the order received) and the plan tab appended at the end. The screen SHALL track exactly one active-tab index across the combined list. On first render the active tab SHALL be the first spec file when one is present, otherwise the plan file.

#### Scenario: First spec is the default active tab

- **GIVEN** a Review Gate with three spec files and one plan file
- **WHEN** the screen first renders
- **THEN** the active tab is the first spec file
- **AND** the content panel shows that spec rendered with Gherkin keyword highlighting

#### Scenario: Plan tab is appended after specs

- **GIVEN** a Review Gate with two spec files (`spec-a.feature`, `spec-b.feature`) and a plan file (`plan.md`)
- **WHEN** the tab row renders
- **THEN** the tabs appear in order: `spec-a.feature`, `spec-b.feature`, `plan.md`
- **AND** the `plan.md` tab is grouped under the `PLAN:` label, separated from the spec tabs by a vertical divider

#### Scenario: Renderer switches with the active tab

- **GIVEN** the user is viewing a spec tab rendered as Gherkin
- **WHEN** the user clicks the plan tab
- **THEN** the content panel re-renders the plan file using ReactMarkdown
- **AND** the spec content is no longer in the DOM

#### Scenario: Plan tab is the default when no specs are present

- **GIVEN** a Review Gate payload with zero spec files and a non-null plan file
- **WHEN** the screen first renders
- **THEN** the active tab is the plan file
- **AND** no `SPECS:` group label or divider is shown in the tab row

### Requirement: Inactive tabs show a drift indicator when their file has drifted

The Review Gate screen SHALL render a visual drift indicator (a small dot or badge) on any tab whose underlying file is known to have drifted from its captured snapshot. A file is considered drifted when its most recent live refresh response carries `drifted: true`. The indicator SHALL be visible regardless of whether the tab is currently active. The existing in-panel drift banner SHALL continue to appear for the active tab.

#### Scenario: Inactive spec tab shows a drift dot after the file drifts

- **GIVEN** a Review Gate with three spec tabs, where `spec-A` is the active tab
- **AND** the user has refreshed `spec-B` and the response reports `drifted: true`
- **WHEN** the tab row re-renders
- **THEN** the `spec-B` tab shows a drift indicator (dot or badge) to the right of its label

#### Scenario: Tabs with no known drift show no indicator

- **GIVEN** a Review Gate where no files have been refreshed since gate-open
- **WHEN** the tab row renders
- **THEN** no tab shows a drift indicator
- **AND** the active tab's content panel shows no drift banner

#### Scenario: In-panel drift banner still appears for the active tab

- **GIVEN** a Review Gate where the active tab's file has drifted
- **WHEN** the screen renders
- **THEN** the active tab shows a drift indicator AND the content panel shows the existing drift banner with "Load current" / "Load snapshot" controls
