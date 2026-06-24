## MODIFIED Requirements

### Requirement: Five screens at visual parity with bosch-workflow

The UI SHALL implement five screens with layouts, typography, color tokens, spacing, and component shapes that visually match the bosch-workflow design at `/Users/LUP1BG/Documents/BoschProjects/bosch-workflow/project`:

- **Dashboard** — workspace overview, metrics tiles, repository list with health bars, recent runs panel, "vertical operations" grid.
- **Project** — per-Project deep view including prereq panel.
- **Kickoff** — feature prompt entry and submit. No scope picker for any topology; the form is identical regardless of the Project's `topology` value.
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

## REMOVED Requirements

### Requirement: Kickoff scope picker for monorepo Projects

**Reason**: The scope picker existed only to populate the `[scope: <path>]` prompt prefix on the kickoff request. That prefix is being removed (see `run-driver` spec delta) because the unified model lets the agent decide what to touch inside any Project, regardless of topology. With no consumer for the value, the picker becomes UI noise on a screen that should be identical across topologies.

**Migration**: The `<select className="kickoff__scope">` element and the `isMonorepo && scope && ...` summary line are removed from `ui/src/components/Kickoff/Kickoff.tsx`. The `scope` state variable and `setScope` setter are deleted. The submit handler no longer includes `scope` in the request body. Users who want to constrain a run to a specific sub-path or child repo simply mention it in the prompt text ("in packages/billing, ..." or "across datahandler and controller, ...").
