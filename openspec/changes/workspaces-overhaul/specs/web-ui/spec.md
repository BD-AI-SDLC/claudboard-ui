## MODIFIED Requirements

### Requirement: Five screens at visual parity with bosch-workflow

The UI SHALL implement these screens with layouts, typography, color tokens, spacing, and component shapes that visually match the design exploration:

- **Dashboard (Overview)** — adaptive per the active workspace's `topology` (see "Overview shape is keyed off active workspace topology" below).
- **Import** — first-run empty state and Add-workspace destination (see "Import view replaces the attach-repo modal" below).
- **Manage workspaces** — stub route (see `workspace-switcher` capability).
- **Project** — per-Project deep view including prereq panel.
- **Kickoff** — feature prompt entry and submit. No scope picker for any topology; the form is identical regardless of the active workspace's `topology` value.
- **Active Run** — split view with phases/agents (left), live stream (middle), telemetry rail (right), run banner with gate CTA when applicable.
- **Review Gate** — spec + plan side-by-side, approve / request-changes actions.

Each screen SHALL use the Geist and Geist Mono fonts and the existing color tokens (`--teal`, `--amber`, `--violet`, `--bg`, `--bg-2`, `--text`, `--text-2`, `--muted`, `--dim`, `--border`).

The `topology` value drives the Dashboard's adaptive shape (see below) AND the badge text displayed alongside the workspace name. It SHALL NOT drive any branching in Kickoff form layout, Active Run telemetry, Review Gate, or any submitted request shape.

#### Scenario: Kickoff form is identical across topologies

- **WHEN** the user opens the Kickoff screen for a monolith workspace
- **THEN** the form shows a prompt textarea and a submit button, with no scope dropdown
- **AND WHEN** the user opens the Kickoff screen for a monorepo workspace
- **THEN** the form is identical — no scope dropdown is rendered
- **AND WHEN** the user opens the Kickoff screen for a multi-repo-workspace
- **THEN** the form is identical — no scope dropdown is rendered

#### Scenario: Kickoff submits a prompt-only request

- **WHEN** the user submits the Kickoff form with prompt `"Add invoice PDF"` for any workspace
- **THEN** the UI POSTs `/api/runs` with body `{ projectId, target, prompt: "Add invoice PDF" }`
- **AND** the request body does NOT include a `scope`, `workspaceRoot`, or `topology` field

#### Scenario: Active Run shows three panes regardless of topology

- **WHEN** the user opens a running run for a monolith workspace
- **THEN** the page shows three panes — Pipeline (left), Live stream (middle), Run telemetry (right)
- **AND WHEN** the user opens a running run for a multi-repo workspace
- **THEN** the page shape is identical

### Requirement: Directory-browser inside the Import view

The "Open local folder" affordance SHALL render a directory-browser pane inline within the Import view (it SHALL NOT open as a modal overlay). The browser SHALL start at the server's `homedir()` and SHALL paginate via the existing `GET /api/fs/browse` endpoint.

The directory browser component SHALL be exposed in such a way that a future change MAY remount it in a modal context without changing its props (no architectural lock-in to inline rendering).

When the user clicks "Use this folder" on a chosen path, the Import view SHALL advance to the topology-picker step (see "Import view requires user-picked topology") before invoking `POST /api/workspaces`.

A paste-path fallback SHALL be available within the same inline pane for power users.

#### Scenario: Browser starts at home directory

- **WHEN** the Import view's Open-local-folder card is opened
- **THEN** the inline browser calls `GET /api/fs/browse` with no `path` query
- **AND** the response's `path` field equals the server's `homedir()`

#### Scenario: Use this folder advances to topology picker, not directly to POST

- **WHEN** the user clicks "Use this folder" with the browser at `/Users/x/code/myrepo`
- **THEN** the Import view advances to the topology-picker step
- **AND** no `POST /api/workspaces` call has been made yet
- **AND** the path is preserved as the candidate

#### Scenario: Error surfaces inline within the Import view

- **WHEN** the user tries to navigate into a directory the server cannot read (`GET /api/fs/browse` returns 403)
- **THEN** the Import view stays on the Open-local-folder card and renders an inline error message
- **AND** the previous listing is preserved
- **AND** no modal opens

### Requirement: Sidebar items are context-aware

Sidebar navigation items that target a screen requiring a `projectId`, `runId`, or `gateId` SHALL be enabled only when a sensible default target exists, and SHALL be visibly disabled with an explanatory tooltip otherwise. Enabled clicks SHALL smart-pick the target according to a documented rule per item.

Context-derivation rules SHALL filter by the currently-active workspace. "Most recent run" means most recent run for the active workspace, not globally.

| Item | Enabled when | Smart target | Disabled tooltip |
|---|---|---|---|
| Overview | always (route is Import when no active workspace) | dashboard | n/a |
| Project · health | active workspace has ≥1 project | last-visited project in this workspace, else first by `createdAt` | "Attach a repo first" |
| Start feature | active workspace has ≥1 project | 1 project → Kickoff for that project; N → open picker modal | "Attach a repo first" |
| Active run | active workspace has ≥1 run with status `running` or `paused-user` | most recent by `createdAt` desc | "No active runs" |
| Review gate | active workspace has ≥1 run with status `paused-gate` | oldest open gate by `createdAt` asc | "No gates awaiting review" |

The sidebar SHALL NOT render a "Repos in workspace" section. The Overview's Services / Modules directory (per topology) is the canonical entry point for per-repo navigation.

#### Scenario: Sidebar Active-run uses active-workspace runs only

- **GIVEN** two workspaces exist; workspace `meas` has a `running` run, workspace `claudboard` has no in-flight runs; `meas` is active
- **WHEN** the user clicks sidebar "Active run"
- **THEN** the app routes to the `meas` running run
- **AND WHEN** the user switches active to `claudboard` via the dropdown
- **THEN** sidebar "Active run" becomes disabled with tooltip `"No active runs"` (the `meas` run is not considered)

#### Scenario: No "Repos in workspace" section is rendered

- **WHEN** the sidebar renders for any workspace
- **THEN** the DOM contains no element labeled "Repos in workspace" or equivalent enumeration of repos in the sidebar
- **AND** the only repo-level navigation surface in the sidebar is the workspace switcher dropdown (which lists workspaces, not repos within a workspace)

### Requirement: App-level shared state for projects and runs

The App component SHALL hold `workspaces`, `activeWorkspaceId`, `projects`, and `runs` as shared state, fetched on mount and refreshed on the events listed below. Child screens and the Sidebar SHALL consume this shared state rather than fetching independently.

Refetch triggers:

- App mount → fetch `workspaces`, `activeWorkspaceId` (and derive `activeWorkspace`), `projects`, `runs`.
- After successful `POST /api/workspaces` (attach) → refetch `workspaces`; `PUT /api/workspaces/active` to the new workspace; refetch `projects` (filtered to the now-active workspace).
- After successful `PUT /api/workspaces/active` (switch via dropdown) → refetch `projects` and `runs` filtered to the new active workspace.
- After successful `POST /api/runs` (start feature) → refresh `runs`.
- Every 30 seconds while mounted → refresh `runs` (to keep sidebar enable-state fresh without WS).

#### Scenario: Switching workspace refreshes projects and runs

- **GIVEN** workspace `meas` is active and the Dashboard shows `meas`'s services and runs
- **WHEN** the user picks `claudboard` from the dropdown
- **THEN** the client issues `PUT /api/workspaces/active` with `claudboard`'s id
- **AND** the client refetches `projects` and `runs` scoped to `claudboard`
- **AND** the Dashboard re-renders with `claudboard`'s shape (monolith Overview) and its data

## ADDED Requirements

### Requirement: Overview shape is keyed off active workspace topology

The Dashboard SHALL render one of three sub-views, selected by the active workspace's `topology` field. The page header (workspace name with topology chip, sub-line with path + branch + stack chips) is shared across all three shapes; the body below the header differs.

**`topology === "monolith"`:**

- KPI strip (Active runs, Awaiting gate, In review, Merged this week).
- Full-width Recent runs card. Each row's sub-text shows only duration and cost (no per-repo prefix, since there is one repo).
- Optional informational Modules list, rendered ONLY when the workspace record carries a non-empty `modules` array (modules are detected by `/analyse` and surfaced for context; they are not navigation targets).

**`topology === "multi-repo-workspace"`:**

- KPI strip.
- Services directory card listing all repos in the workspace, each row clickable to the Project view.
- Two-column split below: Cross-service edges card (from workflow-signals) + Recent runs card. Each Recent runs row's sub-text is prefixed with the originating repo's short name.

**`topology === "monorepo"`:**

- KPI strip.
- Modules/packages directory card listing detected packages, each row clickable to the Project view.
- Full-width Recent runs card. Each row's sub-text is prefixed with the originating module's short name (or modules, comma-separated, when a run touched multiple).

The shape selection SHALL be a single switch statement in the Dashboard component. The three sub-views SHALL be implemented as distinct React components (`OverviewMono`, `OverviewMulti`, `OverviewMonoz`). Common atoms (KPI strip, Recent runs row, page header) SHALL be shared via the existing components module.

#### Scenario: Monolith workspace renders OverviewMono shape

- **GIVEN** the active workspace has `topology: "monolith"` and a non-empty Recent runs history
- **WHEN** the Dashboard renders
- **THEN** the body contains the KPI strip and a full-width Recent runs card
- **AND** the body does NOT contain a Services directory card
- **AND** the body does NOT contain a Cross-service edges card
- **AND** Recent runs row sub-text reads e.g. `"3h 02m · $3.94"` (no repo prefix)

#### Scenario: Multi-repo workspace renders OverviewMulti shape

- **GIVEN** the active workspace has `topology: "multi-repo-workspace"` with 6 repos
- **WHEN** the Dashboard renders
- **THEN** the body contains the KPI strip, a Services directory card with 6 rows, and a two-column split below with Cross-service edges and Recent runs
- **AND** each Recent runs row's sub-text is prefixed with the originating repo's short name (e.g. `"datahandler · 13m · $0.84"`)

#### Scenario: Monorepo workspace renders OverviewMonoz shape

- **GIVEN** the active workspace has `topology: "monorepo"` with 12 detected modules
- **WHEN** the Dashboard renders
- **THEN** the body contains the KPI strip, a Modules directory card, and a full-width Recent runs card
- **AND** each Recent runs row's sub-text is prefixed with the originating module's short name (e.g. `"services/api · 4h 18m · $6.41"`)
- **AND** the body does NOT contain a Cross-service edges card

#### Scenario: Modules list on monolith is informational only when present

- **GIVEN** the active workspace has `topology: "monolith"` and `/analyse` populated a `modules: [...]` array on the workspace record
- **WHEN** the Dashboard renders
- **THEN** the body contains a Modules list below Recent runs labeled `"detected by /analyse · informational"`
- **AND** the rows are not clickable (no Project route exists for a sub-area of a monolith)
- **AND WHEN** the workspace record has an empty or missing `modules` array
- **THEN** no Modules list is rendered

### Requirement: Import view replaces the attach-repo modal

The UI SHALL render a full-page Import view that serves two flows:

- **First-run empty state**: rendered when no active workspace exists. Title copy: `"Get started — point me at a project"`.
- **Add workspace**: rendered when the user clicks `+ Add workspace` in the workspace switcher dropdown. Title copy: `"Add a workspace"`.

The Import view SHALL replace the prior attach-repo modal. The "Directory-browser modal for attach repo" requirement is restated as "Directory-browser inside the Import view" above.

The Import view SHALL render two import cards in a single column:

1. **Open local folder** — opens the inline directory-browser pane (see "Directory-browser inside the Import view").
2. **Clone from Git URL** — opens an inline form with a URL text input and a Clone button.

The view SHALL NOT render a "Continue from existing setup" card in this change (deferred).

When a path is chosen (folder picked) or a clone completes, the view SHALL advance to a topology-picker step (see next requirement). On successful `POST /api/workspaces`, the view SHALL `PUT /api/workspaces/active` to the new workspace's id and route to the Dashboard.

The view SHALL render a Cancel affordance. Cancel:

- In the first-run flow: re-renders the Import view (the user has nowhere to go back to).
- In the Add-workspace flow: returns to the Dashboard of the previously-active workspace (the active workspace is unchanged).

#### Scenario: First-run lands on Import with first-run copy

- **GIVEN** zero workspaces exist
- **WHEN** the app launches
- **THEN** the Import view renders with title `"Get started — point me at a project"`
- **AND** two import cards are shown: Open local folder, Clone from Git URL
- **AND** no Continue-from-existing-setup card is shown

#### Scenario: Add-workspace lands on Import with add copy

- **GIVEN** workspace `meas` is active
- **WHEN** the user clicks `+ Add workspace` in the dropdown
- **THEN** the Import view renders with title `"Add a workspace"`
- **AND** Cancel returns the user to the `meas` Dashboard

#### Scenario: Successful attach activates and routes

- **GIVEN** the user is on the Import view's topology-picker step with a chosen path and a picked topology
- **WHEN** the user confirms
- **THEN** the client POSTs `/api/workspaces` with the chosen path and topology
- **AND** on 201, the client PUTs `/api/workspaces/active` with the new workspace's id
- **AND** the app routes to the Dashboard for the new workspace

### Requirement: Import view requires user-picked topology

The Import view SHALL render a topology-picker step after a local folder is chosen or a git clone completes. The picker SHALL render three radio-style cards labeled `Monolith`, `Multi-repo workspace`, and `Monorepo`, each with a one-line description of what that topology means.

The card matching the registry's auto-classification (returned by a preview classification call, or inferred from a dry-run of `POST /api/workspaces`) SHALL be pre-selected and SHALL carry a `"(detected)"` hint.

The user MAY change the selection. The Confirm button SHALL be enabled once a topology is picked (or pre-selected). On Confirm, the client SHALL POST `/api/workspaces` with `{ root | remoteUrl, topology: <user pick> }`.

When the user's pick differs from the detected value, the post-attach Dashboard SHALL surface a one-time dismissible toast: `"We detected <detected> for this folder; using your pick (<picked>)."`

#### Scenario: Detected topology is pre-selected

- **GIVEN** the user picked a folder that the classifier identifies as `monorepo`
- **WHEN** the topology-picker step renders
- **THEN** the `Monorepo` card is pre-selected
- **AND** the `Monorepo` card displays a `"(detected)"` hint

#### Scenario: User can override the detected topology

- **GIVEN** the topology picker shows `Monorepo` pre-selected with the `(detected)` hint
- **WHEN** the user clicks the `Monolith` card and confirms
- **THEN** the client POSTs `{ root, topology: "monolith" }`
- **AND** after the resulting Dashboard mounts, a one-time toast appears with copy `"We detected monorepo for this folder; using your pick (monolith)."`

### Requirement: Clone-Git-URL inline form

The Clone-from-Git-URL card SHALL render an inline form with a single URL text input, a Clone button, and a destination preview (e.g. `"Will clone into ~/dev/<basename>"`).

On Clone click, the button SHALL show a spinner and SHALL be disabled until the request resolves. On success, the view advances to the topology-picker step. On failure (clone error, destination exists, network), the form SHALL render an inline error message with the failure reason and the form's previous state SHALL be preserved.

The destination basename SHALL be derived from the URL (last path segment minus `.git`). The user does not get to choose the destination in this change.

#### Scenario: Clone shows spinner and advances on success

- **GIVEN** the user typed `https://github.com/acme/web.git` into the input
- **WHEN** the user clicks Clone
- **THEN** the Clone button shows a spinner and is disabled
- **AND** the client POSTs `/api/workspaces` with `{ remoteUrl: "https://github.com/acme/web.git" }`
- **AND** on 201, the view advances to the topology-picker step with the cloned path as the candidate

#### Scenario: Clone failure surfaces inline

- **GIVEN** the user typed an invalid URL
- **WHEN** Clone returns 400 with `{ error: "clone failed", detail: "fatal: repository not found" }`
- **THEN** the form renders an inline error showing the detail
- **AND** the URL input retains the typed value
- **AND** the Clone button is re-enabled

#### Scenario: Destination-exists conflict surfaces inline

- **GIVEN** the user attempts to clone `https://github.com/acme/web.git` and `~/dev/web` already exists
- **WHEN** Clone returns 409 with `{ error: "destination exists", path: "/Users/x/dev/web" }`
- **THEN** the form renders an inline error indicating the destination already exists, naming the path
- **AND** no record is created in the registry
- **AND** the form remains usable for retry with a different URL
