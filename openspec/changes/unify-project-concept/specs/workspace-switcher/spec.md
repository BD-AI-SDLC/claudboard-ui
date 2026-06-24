## MODIFIED Requirements

### Requirement: Active workspace is persisted server-side and restored on launch

The system SHALL track a single "active project" per installation, persisted in the same SQLite database that holds the project registry (`~/.bosch-sdlc/state.db`). The active selection SHALL survive app restarts.

The active project SHALL be exposed via two endpoints:

- `GET /api/projects/active` — returns `{ activeProjectId: string | null, activeProject: Project | null }`.
- `PUT /api/projects/active` — body `{ projectId: string }`. Sets the singleton AND updates that Project's `lastActiveAt` to the server's current time. Returns the same shape as the GET.

On app launch, the UI SHALL call `GET /api/projects/active` exactly once and apply this routing rule:

- `activeProject` resolves (non-null, `status: "active"`) → route to the Dashboard for that project.
- `activeProject` is null AND at least one project exists → auto-select the project with the most recent `lastActiveAt` (fallback: `createdAt`), `PUT` it as active, then route to the Dashboard.
- `activeProject` is null AND no projects exist → route to the Import view.
- `activeProject` resolves but its `status` is `detached`, OR its `path` no longer exists on disk → treat as null and apply the two preceding rules.

#### Scenario: Restore last-active on relaunch

- **GIVEN** the user previously had project `P1` active and quit the app
- **WHEN** the app relaunches
- **THEN** `GET /api/projects/active` returns `P1`
- **AND** the app routes directly to the Dashboard for `P1` without any intermediate Import or picker screen

#### Scenario: Auto-pick most-recent when active is null

- **GIVEN** `active_project_id` is null in the database AND two projects exist with `lastActiveAt` of T-1d and T-3d
- **WHEN** the app launches
- **THEN** the app issues `PUT /api/projects/active` with the T-1d project's id
- **AND** routes to that project's Dashboard

#### Scenario: First run with empty registry

- **GIVEN** a freshly initialised database with zero projects
- **WHEN** the app launches
- **THEN** `GET /api/projects/active` returns `{ activeProjectId: null, activeProject: null }`
- **AND** the app routes to the Import view

### Requirement: Sidebar renders a project switcher dropdown

The sidebar SHALL render a `ProjectSwitcher` component at the top, below the brand. The component name SHALL be `ProjectSwitcher` (renamed from `WorkspaceSwitcher`). It SHALL have a closed state (single row) and an open state (dropdown menu).

The closed-state row SHALL show, in order: the active project's `mark`, its `name`, an optional `topology` chip (purely decorative — does not affect any UI branching), and a chevron. Clicking the row SHALL toggle the dropdown open.

The open-state dropdown SHALL contain, in order:

1. A header label `"N projects"` where N is the count of active projects.
2. One row per active project, sorted with the active project first and the remainder by `lastActiveAt` descending.
3. A separator.
4. An `+ Add project` row (routes to the Import view).
5. An `⚙ Manage projects` row (visible-but-disabled stub for v1).

The dropdown SHALL close on: (a) click outside the dropdown bounds, (b) `Esc` keypress, (c) selection of any row.

The `ProjectSwitcher` SHALL be the SOLE project-selection surface in the UI. No additional top-bar `ProjectPicker` SHALL be rendered.

#### Scenario: Dropdown opens and lists projects

- **GIVEN** three active projects exist (`meas`, `claudboard`, `acme-platform`) and `meas` is active
- **WHEN** the user clicks the closed-state row
- **THEN** a dropdown appears containing four content rows in order: header `"3 projects"`, `meas` (first, marked as active), `claudboard`, `acme-platform`
- **AND** a separator
- **AND** the `+ Add project` and `⚙ Manage projects` rows below the separator

#### Scenario: Clicking a different project switches active and triggers refetch

- **GIVEN** the dropdown is open with `meas` currently active and its repos/runs loaded
- **WHEN** the user clicks the `claudboard` row
- **THEN** the client issues `PUT /api/projects/active` with `claudboard`'s id
- **AND** the dropdown closes
- **AND** the UI refetches `GET /api/repos?projectId=<claudboard.id>` and `GET /api/runs?projectId=<claudboard.id>`
- **AND** the Dashboard re-renders with `claudboard`'s data only — none of `meas`'s repos or runs are visible

#### Scenario: No top-bar picker is rendered alongside the switcher

- **WHEN** the user is on any screen with the sidebar visible
- **THEN** no separate "ProjectPicker" component is rendered in the top-bar
- **AND** the sidebar `ProjectSwitcher` is the only UI control that lists or selects projects

### Requirement: Manage projects row is a stub in v1

The `⚙ Manage projects` row in the `ProjectSwitcher` dropdown SHALL be visible but disabled in this iteration. Clicking it SHALL show a "Coming soon" tooltip and SHALL NOT navigate anywhere or open any UI surface. The row's text SHALL read `"Manage projects"` (not `"Manage workspaces"`).

#### Scenario: Manage projects row is non-interactive

- **WHEN** the user hovers the `⚙ Manage projects` row
- **THEN** a "Coming soon" tooltip appears
- **AND WHEN** the user clicks the row
- **THEN** no navigation occurs and no modal opens
