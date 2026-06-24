## MODIFIED Requirements

### Requirement: Five screens at visual parity with bosch-workflow

The UI SHALL implement five screens with layouts, typography, color tokens, spacing, and component shapes that visually match the bosch-workflow design at `/Users/LUP1BG/Documents/BoschProjects/bosch-workflow/project`:

- **Dashboard** — workspace overview, metrics tiles, repository list with health bars, **recent runs panel (real data)**, "vertical operations" grid.
- **Project** — per-repo deep view including prereq panel.
- **Kickoff** — feature prompt entry, scope picker (for monorepo), submit.
- **Active Run** — split view with phases/agents (left), live stream (middle), telemetry rail (right), run banner with gate CTA when applicable.
- **Review Gate** — spec + plan side-by-side, approve / request-changes actions.

Each screen SHALL use the Geist and Geist Mono fonts and the existing color tokens (`--teal`, `--amber`, `--violet`, `--bg`, `--bg-2`, `--text`, `--text-2`, `--muted`, `--dim`, `--border`).

#### Scenario: Dashboard renders all required regions

- **WHEN** the user opens the dashboard with at least one workspace registered
- **THEN** the page shows: topbar with crumb + Start-feature CTA, h1 title, four metric tiles (active runs, awaiting gate, in review, merged this week), repositories card with rows matching the design's grid, **recent runs panel populated from live data**, and the vertical operations grid

#### Scenario: Active Run shows three panes

- **WHEN** the user opens a running run in the default `split` layout
- **THEN** the page shows three panes — Pipeline (left), Live stream (middle), Run telemetry (right) — with the run banner at the top

#### Scenario: Review Gate shows spec and plan

- **WHEN** the user navigates to an open gate via the Run banner's "Review spec + plan" CTA
- **THEN** the page renders the BDD spec text with Gherkin keyword highlighting and the architect plan as a numbered list of checkpoints with files and contracts; two action buttons are present: "Approve" and "Request changes"

### Requirement: Live data over REST and WebSocket

The UI SHALL fetch initial data via REST endpoints and subscribe to live updates via WebSocket. There SHALL be no mock data shipped in the production build. **The Dashboard activity / recent runs panel SHALL render real run data only; no hardcoded sample feed SHALL exist in the production bundle.**

#### Scenario: Dashboard fetches from REST

- **WHEN** the dashboard mounts
- **THEN** it calls `GET /api/dashboard/summary` and `GET /api/projects` and `GET /api/runs`; no `window.DATA` global exists in the production bundle **and no `STATIC_FEED` constant is bundled**

#### Scenario: Active Run subscribes via WebSocket

- **WHEN** the user opens an active run page
- **THEN** the page opens a WS connection to `/api/runs/:id/stream`, replays the buffered events to build initial state, then updates the pipeline/stream/telemetry incrementally

#### Scenario: Dashboard recent runs panel renders live data

- **WHEN** the dashboard renders with one or more runs in the database
- **THEN** the panel displays the 5 most recent runs (by `createdAt` descending), each row showing status chip, project name, prompt summary (max 60 chars), and relative age; clicking a row navigates to that Run view

#### Scenario: Dashboard recent runs panel empty state

- **WHEN** the dashboard renders with zero runs in the database
- **THEN** the panel displays the message "No runs yet — start a feature from any project."

## ADDED Requirements

### Requirement: Sidebar items are context-aware

Sidebar navigation items that target a screen requiring a `projectId`, `runId`, or `gateId` SHALL be enabled only when a sensible default target exists, and SHALL be visibly disabled with an explanatory tooltip otherwise. Enabled clicks SHALL smart-pick the target according to a documented rule per item.

| Item | Enabled when | Smart target | Disabled tooltip |
|---|---|---|---|
| Overview | always | dashboard | n/a |
| Project · health | ≥1 active project | last-visited project if still active, else first by `createdAt` | "Attach a repo first" |
| Start feature | ≥1 active project | 1 project → Kickoff for that project; N → open picker modal | "Attach a repo first" |
| Active run | ≥1 run with status `running` or `paused-user` | most recent by `createdAt` desc | "No active runs" |
| Review gate | ≥1 run with status `paused-gate` and a non-null `openGate` | oldest open gate by `createdAt` asc | "No gates awaiting review" |

The History / Skills / Rules / Settings items SHALL always render disabled in this change with tooltip "Coming soon" until their screens are built.

#### Scenario: Disabled sidebar item does not navigate

- **WHEN** the user clicks a disabled sidebar item
- **THEN** no route change occurs and no callback fires; the item's `aria-disabled` attribute is `"true"` and `pointer-events` is `none` in CSS

#### Scenario: Tooltip surfaces reason

- **WHEN** the user hovers a disabled sidebar item
- **THEN** the browser-native `title` attribute reveals the documented per-item reason text

#### Scenario: Sidebar "Active run" jumps to the latest active run

- **WHEN** there is one run with status `running` (id `r1`, `createdAt = T`) and one with status `paused-gate` (id `r2`, `createdAt = T-10m`)
- **THEN** clicking sidebar "Active run" navigates to `/run` with `runId = r1` (paused-gate is not eligible for this item)

#### Scenario: Sidebar "Review gate" jumps to the oldest open gate

- **WHEN** there are two runs with status `paused-gate`, with open gates created at T-30m and T-5m
- **THEN** clicking sidebar "Review gate" navigates to `/gate` with the T-30m gate

#### Scenario: Sidebar items react to state changes

- **WHEN** the user attaches their first repo
- **THEN** the sidebar "Project · health" and "Start feature" items transition from disabled to enabled without a page reload

### Requirement: Dashboard Start-feature CTA with smart project selection

The Dashboard TopBar SHALL render a "Start feature" CTA whose behaviour depends on the number of active projects:

- **0 projects**: button hidden (the empty state CTA "Attach your first repo" is the primary action).
- **1 project**: clicking immediately navigates to the Kickoff screen with that project selected.
- **N ≥ 2 projects**: clicking opens a project picker modal listing all active projects; selecting one navigates to Kickoff with that project selected.

#### Scenario: Single project auto-selects

- **WHEN** the workspace contains exactly one active project and the user clicks the Dashboard TopBar "Start feature" CTA
- **THEN** the app navigates to the Kickoff screen with that project's id pre-selected, without showing a picker

#### Scenario: Multiple projects show picker

- **WHEN** the workspace contains two or more active projects and the user clicks "Start feature"
- **THEN** a modal overlay appears listing all active projects (name + path); selecting one navigates to Kickoff with that project; `Esc` or backdrop click closes the modal without navigating

### Requirement: Project picker modal

A `ProjectPicker` modal component SHALL render an overlay listing active projects for selection. It SHALL be keyboard-accessible (`Esc` to cancel, arrow keys to move, `Enter` to select) and SHALL close on backdrop click.

#### Scenario: Picker lists name and path

- **WHEN** the picker opens with projects `[{name: "craftsphere", path: "/a"}, {name: "portal", path: "/b"}]`
- **THEN** each entry renders the project name and the path in a monospaced font

#### Scenario: Esc cancels

- **WHEN** the picker is open and the user presses `Esc`
- **THEN** the picker closes and no navigation occurs

### Requirement: Directory-browser modal for attach repo

The "Attach repo" flow SHALL use a modal that browses the host filesystem starting at the server's `homedir()`, instead of a free-text input. A paste-path fallback SHALL be available within the same modal for power users.

#### Scenario: Modal opens at home directory

- **WHEN** the user clicks "Attach repo" (or the empty-state "Attach your first repo" CTA)
- **THEN** a modal opens calling `GET /api/fs/browse` with no `path` query; the response's `path` field equals the server's `homedir()` and its `entries` are rendered as a list

#### Scenario: Navigating into a folder updates the listing

- **WHEN** the modal shows the home directory and the user clicks an entry named `Documents`
- **THEN** the modal calls `GET /api/fs/browse?path=<home>/Documents` and replaces the listing with the response; the breadcrumb updates to reflect the new path

#### Scenario: Git repos are visually marked

- **WHEN** an entry has `isGitRepo: true` in the browse response
- **THEN** the entry renders with a git glyph alongside its name

#### Scenario: Use this folder attaches the current path

- **WHEN** the user clicks "Use this folder" with the modal at path `/Users/lup1bg/code/myrepo`
- **THEN** the UI calls `POST /api/workspaces` with `{ root: "/Users/lup1bg/code/myrepo" }`, closes the modal on 201, and refreshes the projects list

#### Scenario: Paste path fallback

- **WHEN** the user clicks the "Paste path" toggle, types an absolute path, and submits
- **THEN** the same `POST /api/workspaces` call is made with that path, bypassing folder-by-folder navigation

#### Scenario: Error surfaces inline

- **WHEN** the user tries to navigate into a directory the server cannot read (`GET /api/fs/browse` returns 403)
- **THEN** the modal stays open and renders an inline error message; the previous listing is preserved

### Requirement: App-level shared state for projects and runs

The App component SHALL hold `projects` and `runs` as shared state, fetched on mount and refreshed on the events listed below. Child screens and the Sidebar SHALL consume this shared state rather than fetching independently.

Refetch triggers:

- App mount
- After successful `POST /api/workspaces` (attach repo) — refresh `projects`
- After successful `POST /api/runs` (start feature) — refresh `runs`
- Every 30 seconds while mounted — refresh `runs` (to keep sidebar enable-state fresh without WS)

#### Scenario: Attach refreshes projects everywhere

- **WHEN** the user successfully attaches a repo via the modal
- **THEN** the Dashboard repository list, the sidebar enable-state, and the picker contents all reflect the new project without a page reload

#### Scenario: New run appears in recent runs panel

- **WHEN** the user successfully creates a run via Kickoff
- **THEN** within at most 30 seconds the Dashboard "Recent runs" panel includes that run

### Requirement: Disabled sidebar items styling

Disabled sidebar items SHALL render with reduced opacity (~0.4), `cursor: not-allowed`, and `pointer-events: none`. They SHALL retain `aria-disabled="true"` for assistive tech.

#### Scenario: Disabled item is not focusable by tab

- **WHEN** the user tabs through the sidebar
- **THEN** disabled items are skipped (`tabIndex={-1}`) but remain visible
