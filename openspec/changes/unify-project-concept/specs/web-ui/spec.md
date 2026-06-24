## MODIFIED Requirements

### Requirement: Five screens at visual parity with bosch-workflow

The UI SHALL implement these screens with layouts, typography, color tokens, spacing, and component shapes that visually match the design exploration:

- **Dashboard (Overview)** — a SINGLE shape regardless of the active project's `topology`. The Overview body SHALL consist of a KPI strip (Active runs, Awaiting gate, In review, Merged this week) and a full-width Recent runs panel. No services list, no modules list, no per-repo table, and no "Vertical operations" strip.
- **Import** — first-run empty state and Add-project destination. The Import flow SHALL NOT include a topology-picker step (see "Import view auto-classifies topology" below).
- **Project** — per-Project deep view including prereq panel (a.k.a. "project health" page).
- **Kickoff** — feature prompt entry and submit. No scope picker for any topology; the form is identical regardless of the active project's `topology` value.
- **Active Run** — split view with phases/agents (left), live stream (middle), telemetry rail (right), run banner with gate CTA when applicable.
- **Review Gate** — spec + plan side-by-side, approve / request-changes actions.

The `topology` value SHALL NOT drive any branching in the Dashboard layout, Kickoff form, Active Run telemetry, Review Gate, or any submitted request shape. It MAY remain stored as internal metadata for use by Kickoff repo targeting.

#### Scenario: Dashboard renders the single overview shape regardless of topology

- **WHEN** the user opens the Dashboard for a project with `topology: "monolith"`
- **THEN** the page shows: topbar with crumb + Start-feature CTA, h1 title, four metric tiles, and a full-width Recent runs panel
- **AND WHEN** the user opens the Dashboard for a project with `topology: "multi-repo-workspace"`
- **THEN** the page shows the same shape — no services table, no per-repo list
- **AND WHEN** the user opens the Dashboard for a project with `topology: "monorepo"`
- **THEN** the page shows the same shape — no modules table

#### Scenario: Dashboard does not render a "Vertical operations" strip

- **WHEN** the user opens the Dashboard for any project
- **THEN** no card or section with the heading "Vertical operations" is rendered

#### Scenario: Kickoff form is identical across topologies

- **WHEN** the user opens the Kickoff screen for any project, regardless of topology
- **THEN** the form shows a prompt textarea and a submit button, with no scope dropdown

#### Scenario: Kickoff submits a prompt-only request

- **WHEN** the user submits the Kickoff form with prompt `"Add invoice PDF"` for any project
- **THEN** the UI POSTs `/api/runs` with body `{ projectId, target, prompt: "Add invoice PDF" }`
- **AND** the request body does NOT include a `scope`, `workspaceRoot`, or `topology` field

### Requirement: Live data over REST and WebSocket

The UI SHALL fetch initial data via REST endpoints and subscribe to live updates via WebSocket. There SHALL be no mock data shipped in the production build. The Dashboard activity / recent runs panel SHALL render real run data only.

All per-project data fetches SHALL be scoped to the active project's id and SHALL refetch when the active project changes:

- The repos list call SHALL be `GET /api/repos?projectId=<activeProjectId>`.
- The runs list call SHALL be `GET /api/runs?projectId=<activeProjectId>`.
- When `activeProjectId` changes (user switches project), both calls SHALL be re-issued and the in-memory state SHALL be replaced (not merged).

#### Scenario: Dashboard fetches scoped data

- **WHEN** the Dashboard mounts with an active project of id `P1`
- **THEN** it calls `GET /api/dashboard/summary`, `GET /api/repos?projectId=P1`, and `GET /api/runs?projectId=P1`
- **AND** no unscoped `GET /api/repos` or `GET /api/runs` call is made

#### Scenario: Switching projects refetches both lists

- **GIVEN** the Dashboard is mounted with active project `P1` and has loaded P1's repos and runs
- **WHEN** the user picks project `P2` from the sidebar switcher
- **THEN** `GET /api/repos?projectId=P2` and `GET /api/runs?projectId=P2` are issued
- **AND** the previously-rendered P1 repos and runs are no longer visible — only P2's data appears

#### Scenario: Recent runs panel shows only the active project's runs

- **GIVEN** project `P1` has two runs and project `P2` has three runs
- **WHEN** the Dashboard is showing project `P1`
- **THEN** the Recent runs panel lists at most two runs (P1's only); none of P2's runs appear

#### Scenario: Active Run subscribes via WebSocket

- **WHEN** the user opens an active run page
- **THEN** the page opens a WS connection to `/api/runs/:id/stream`, replays the buffered events to build initial state, then updates the pipeline/stream/telemetry incrementally

### Requirement: Dashboard Start-feature CTA with smart project selection

The Dashboard TopBar SHALL render a "Start feature" CTA whose behaviour depends on the number of Repo records under the active Project:

- **0 repos** (impossible for a valid Project, but defensive): button hidden.
- **1 repo**: clicking immediately navigates to the Kickoff screen with that repo pre-selected as the target.
- **N ≥ 2 repos** (multi-repo Project): clicking navigates to Kickoff; Kickoff's existing target picker handles repo selection. No separate project picker modal is shown — the Project itself is already selected via the sidebar switcher.

#### Scenario: Monolith auto-selects the sole repo

- **WHEN** the active Project is a monolith (1 Repo) and the user clicks "Start feature"
- **THEN** Kickoff opens with that Repo pre-selected as the target

#### Scenario: Multi-repo defers repo choice to Kickoff

- **WHEN** the active Project is a multi-repo-workspace with three Repos and the user clicks "Start feature"
- **THEN** Kickoff opens; the existing per-repo target picker within Kickoff is used to pick the target
- **AND** no project-level picker modal appears (the user already picked the project via the sidebar switcher)

## REMOVED Requirements

### Requirement: Project picker modal

**Reason**: Replaced by the sidebar project switcher as the sole project-picking surface. The top-bar Picker was a duplicate listing every Repo across every Project, which was the proximate cause of the cross-project data leakage on the Overview. With one picker scoped to one concept (Projects, in the sidebar), the contamination cannot recur.

**Migration**: Delete `ui/src/components/Picker/ProjectPicker.tsx` and all imports/usages. The Dashboard Start-feature CTA no longer opens this modal (see "Dashboard Start-feature CTA with smart project selection" above for the new behavior).

### Requirement: Directory-browser modal for attach repo

**Reason**: Superseded by the inline Import view (introduced by the workspaces-overhaul change). The Import view hosts the folder browser as an inline pane, not a modal. This change keeps that arrangement and additionally removes the topology-picker step that the workspaces-overhaul Import view introduced (see "Import view auto-classifies topology" below).

**Migration**: The `AttachRepoModal` component MAY remain as a reusable building block consumed by the Import view, but it SHALL NOT be opened as a modal overlay from the Dashboard or any other screen. All "Attach repo" / "Add project" affordances route to the Import view.

## ADDED Requirements

### Requirement: Import view auto-classifies topology

The Import view SHALL NOT include a topology-picker step. When the user clicks "Use this folder" (folder path) or completes a Git clone, the UI SHALL POST `/api/projects` with `{ root }` or `{ remoteUrl }` only — no `topology` field. The server's auto-classification result is final and invisible to the user.

#### Scenario: Folder import advances directly to project creation

- **WHEN** the user picks a folder in the Import view's inline browser and clicks "Use this folder"
- **THEN** the UI POSTs `/api/projects` with `{ root: "<picked-path>" }` and no `topology` field
- **AND** no topology-picker step is rendered before the POST
- **AND** on a 2xx response the Import view exits and the new Project becomes active

#### Scenario: Clone import advances directly to project creation

- **WHEN** the user completes the Git clone path in the Import view
- **THEN** the UI POSTs `/api/projects` with `{ remoteUrl: "<url>" }` only
- **AND** no topology-picker step is rendered

### Requirement: Active-run banner is scoped to the active project

The Active-run banner that appears on the Dashboard (and other screens) when a paused run requires attention SHALL be derived from the active project's runs only. Switching to a different project SHALL re-evaluate the banner based on that project's runs and SHALL hide the banner if no banner-worthy run exists for the new project. A paused run on a non-active project SHALL NOT surface a banner — it remains server-side and becomes visible again when the user switches back to its owning project.

#### Scenario: Banner hides when switching away from a project with a paused run

- **GIVEN** project `P1` has a run in `paused-gate` status, and `P1` is the active project (banner visible)
- **WHEN** the user picks `P2` from the sidebar switcher and `P2` has no paused runs
- **THEN** the active-run banner is no longer rendered on any screen

#### Scenario: Banner reappears on switching back

- **GIVEN** the user is on `P2` with no banner, and `P1` still has a paused-gate run
- **WHEN** the user picks `P1` from the sidebar switcher
- **THEN** the active-run banner re-renders on the Dashboard for `P1`'s paused run
