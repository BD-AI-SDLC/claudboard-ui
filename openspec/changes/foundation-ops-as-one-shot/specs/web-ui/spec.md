## MODIFIED Requirements

### Requirement: Five screens at visual parity with bosch-workflow

The UI SHALL implement five screens with layouts, typography, color tokens, spacing, and component shapes that visually match the bosch-workflow design at `/Users/LUP1BG/Documents/BoschProjects/bosch-workflow/project`:

- **Dashboard** — workspace overview, metrics tiles, repository list with health bars, recent runs panel, "vertical operations" grid.
- **Project** — per-Project deep view including prereq panel. The page composition depends on whether all three foundation artifacts (`analyse`, `generate`, `claudboard-workflow`) are `done`:
  - **Setup mode** (any foundation prereq is `missing`): renders the `SetupBanner` ("Set up Mileva for this repo") above the full `FoundationChain` (3 step cards), with `MaintenanceGrid` (2 cards) below.
  - **Operational mode** (all three foundation prereqs are `done`): the `SetupBanner` SHALL NOT render. The `MaintenanceGrid` SHALL render at the top of the body. The Foundation section SHALL render at the bottom as a `FoundationChain` whose `OperationCard`s render in a locked variant (see "Foundation operation card in operational mode is locked" requirement). No `FoundationDriftStrip` SHALL render, and no `Recommended` chip SHALL render on any Maintenance card based on foundation state.
- **Kickoff** — feature prompt entry and submit. No scope picker for any topology; the form is identical regardless of the Project's `topology` value. The Kickoff screen SHALL NOT render any drift hint related to foundation freshness — there is no foundation "stale" state to nudge about.
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
- **AND** the `FoundationDriftStrip` is NOT present in the DOM (component is deleted)

#### Scenario: Project screen in Operational mode reorders Maintenance above locked Foundation

- **GIVEN** a Project whose prereq states are `analyse: done`, `generate: done`, `claudboard-workflow: done`
- **WHEN** the user opens the Project screen
- **THEN** the `SetupBanner` does NOT render
- **AND** the `MaintenanceGrid` renders above the Foundation section
- **AND** the `FoundationChain` renders below the MaintenanceGrid with all three cards in their locked variant
- **AND** no `FoundationDriftStrip` renders (component is deleted)
- **AND** the Refresh card in `MaintenanceGrid` does NOT carry a `Recommended` chip based on foundation state

#### Scenario: Kickoff screen never renders a foundation drift hint

- **GIVEN** any Project (Operational mode or Setup mode, in any state)
- **WHEN** the user opens the Kickoff screen for that Project
- **THEN** no foundation-freshness hint is rendered above the prompt textarea (the hint component is deleted)
- **AND** the form renders unchanged otherwise — the prompt textarea, autonomy radio, and submit button render as today

### Requirement: Sidebar items are context-aware

Sidebar navigation items that target a screen requiring a `projectId`, `runId`, or `gateId` SHALL be enabled only when a sensible default target exists, and SHALL be visibly disabled with an explanatory tooltip otherwise. Enabled clicks SHALL smart-pick the target according to a documented rule per item.

| Item | Enabled when | Smart target | Disabled tooltip |
|---|---|---|---|
| Project · health | ≥1 active project | last-visited project if still active, else first by `createdAt` | "Attach a repo first" |
| Start feature | ≥1 active project AND at least one project has all three foundation prereqs `done` | last-visited eligible project if still eligible, else first eligible by `createdAt` | "Complete foundation setup on at least one project first" |
| Active run | ≥1 in-progress run | most recent non-terminal run | "Start a feature first" |
| Review gate | ≥1 open gate | gate with oldest `created_at` | "No open gates" |

The Start Feature sidebar item and the TopBar Start Feature button SHALL share the same eligibility predicate (all three foundation prereqs are `done`). Because no foundation op can ever report `stale` under this change, the predicate has no staleness clause — `done` is the only enabling state.

The TopBar Start Feature button's disabled tooltip SHALL read `"Foundation is missing — run setup first"` when disabled because no eligible project exists; the equivalent sidebar item SHALL read `"Complete foundation setup on at least one project first"`.

#### Scenario: Sidebar disables Project · health when no projects exist

- **WHEN** the user opens the app with no attached projects
- **THEN** the sidebar "Project · health" item is rendered with a visibly disabled style (reduced opacity, no hover affordance) and a tooltip "Attach a repo first"

#### Scenario: Sidebar enables Start feature once any project has foundation artifacts

- **GIVEN** the user has attached one project whose `analyse`, `generate`, `claudboard-workflow` prereqs are all `done`
- **WHEN** the user opens the dashboard
- **THEN** the sidebar "Start feature" item is enabled
- **AND** clicking it routes to the Kickoff screen for that project (the most-recently-visited eligible project; if none has been visited, the first eligible project ordered by `createdAt`)

#### Scenario: Start Feature stays enabled across routine codebase activity

- **GIVEN** the user has attached one project whose `analyse: done`, `generate: done`, `claudboard-workflow: done`
- **AND** 30 days pass with 100 commits landed in the repo and no `refresh` runs
- **WHEN** the user opens the Project screen
- **THEN** the TopBar Start Feature button is enabled (not disabled and not tooltipped)
- **AND** the sidebar "Start feature" item is also enabled
- **AND** no foundation op reports `stale` — the only `stale` op on the page is the always-stale `refresh`

#### Scenario: Start Feature disabled tooltip names foundation specifically

- **GIVEN** the user has attached one project whose `claudboard-workflow: missing`
- **WHEN** the user hovers the TopBar Start Feature button on that project's screen
- **THEN** the tooltip reads `"Foundation is missing — run setup first"`
- **AND** the button does not respond to clicks

## ADDED Requirements

### Requirement: Foundation operation card in operational mode is locked

When the Project screen renders in Operational mode (all three foundation prereqs are `done`), each Foundation `OperationCard` SHALL render in a locked variant:

- The card SHALL show the operation title and a check-mark indicator with subtitle `Setup complete`.
- The card SHALL NOT show a `Stale` badge under any condition (foundation ops cannot report `stale` per the workspace-registry capability).
- The card SHALL NOT show a `Stale — ...` reason line (the soft-gate-era reason line is removed for foundation ops; it persists only for `techdebt` in Maintenance).
- The card SHALL NOT respond to clicks. No primary `▶ Run ...` button SHALL render. No overflow menu SHALL render in this change (the future "Delete artifact and re-run" affordance is out of scope).
- The user re-enables a foundation op by manually deleting its artifact from the filesystem (`rm`), at which point detection flips the op back to `missing` and the page re-renders in Setup mode with the standard run button restored.

When the Project screen renders in Setup mode (any foundation prereq is `missing`), the Foundation `OperationCard` SHALL continue to render in the existing Setup-mode variant: title, description, status badge (`Done`, `Next`, or `Locked` based on chain position), and the active card's `▶ Run /mileva-*` button.

#### Scenario: Locked foundation card in operational mode

- **GIVEN** a Project with `analyse: done`, `generate: done`, `claudboard-workflow: done`
- **WHEN** the Project screen renders in Operational mode
- **THEN** each of the three Foundation `OperationCard`s renders the title, a check-mark, and the subtitle `Setup complete`
- **AND** none of the three cards renders a primary `▶ Run` button
- **AND** none of the three cards renders an overflow menu
- **AND** none of the three cards is clickable — `aria-disabled` is `"true"` and `pointer-events` is `none` in CSS

#### Scenario: Manually deleting an artifact reverts to Setup mode

- **GIVEN** a Project in Operational mode (all three foundation prereqs `done`)
- **WHEN** the user runs `rm .claude/reports/claudboard-analysis.md` in their terminal
- **AND** the Project screen polls or re-fetches prereq state
- **THEN** the page re-renders in Setup mode: `SetupBanner` returns, `FoundationChain` returns with full Setup-mode cards (analyse `next`, generate `locked`, workflow `locked`), `MaintenanceGrid` returns below
- **AND** the analyse card is clickable with the `▶ Run /mileva-analyse` button restored

#### Scenario: Refresh card in operational mode is never auto-recommended

- **GIVEN** a Project in Operational mode
- **WHEN** the Project screen renders
- **THEN** the Refresh card in `MaintenanceGrid` is always clickable and always shows the `Stale` chip
- **AND** the Refresh card does NOT carry a `Recommended` chip — recommendation based on commit count, days passed, or any other heuristic is not produced in this change

### Requirement: Refresh operation card description emphasizes drift-management role

The Maintenance `OperationCard` for `refresh` SHALL render a description that frames refresh as the canonical response to codebase drift, distinct from the one-time setup operations. The description text SHALL communicate the following three points:

1. What refresh does: updates rules and skills.
2. When to run it: when the codebase has drifted from the existing `.claude/` artifacts.
3. Implicit framing that it is the recommended ongoing action, in contrast to foundation ops which are one-time setup.

The exact copy is design-controlled; one acceptable rendering is `"Updates rules and skills to match recent code changes. Run when the codebase has drifted."`. Any equivalent phrasing that hits all three points is acceptable.

#### Scenario: Refresh description reads as a drift-management nudge

- **WHEN** the user opens any Project screen
- **THEN** the Refresh `OperationCard` description includes language about updating rules and skills against code changes
- **AND** the description does NOT include language that frames Refresh as a one-time setup step or as an alternative to running `/mileva-analyse` etc.

## REMOVED Requirements

### Requirement: Foundation operation card surfaces the stale reason

**Reason:** Foundation ops can no longer report `state: 'stale'` under the workspace-registry capability, so there is no `staleReason` to surface for them. The reason-line UI is removed for the three foundation cards. `techdebt`'s `Stale — older than 7 days` / `Stale — codebase changed since last run` rendering is preserved by the Maintenance `OperationCard` path (this REMOVED requirement scoped to the *foundation* card variant only).

**Migration:** Delete `FoundationDriftStrip.tsx` and its CSS. In `OperationCard.tsx`, branch on whether the op is a foundation op; for foundation ops, never render the stale-reason line and skip the `Stale` badge entirely. For `techdebt`, retain the existing reason-line behavior using the surviving `'aged-out' | 'codebase-changed'` reasons. Delete the `Foundation operation card surfaces the stale reason` requirement scenarios that targeted `upstream-changed` (`Upstream-changed reason names the predecessor`) and `aged-out` / `codebase-changed` *on foundation ops* (`Aged-out reason rendered for the analyse op`, `Codebase-changed reason rendered for the analyse op`); these are removed because they describe behavior that no longer exists for foundation ops.
