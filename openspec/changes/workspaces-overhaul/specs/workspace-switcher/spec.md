## ADDED Requirements

### Requirement: Active workspace is persisted server-side and restored on launch

The system SHALL track a single "active workspace" per installation, persisted in the same SQLite database that holds the workspace registry (`~/.bosch-sdlc/state.db`). The active selection SHALL survive app restarts.

The active workspace SHALL be exposed via two endpoints:

- `GET /api/workspaces/active` — returns `{ activeWorkspaceId: string | null, activeWorkspace: Workspace | null }`.
- `PUT /api/workspaces/active` — body `{ workspaceId: string }`. Sets the singleton AND updates that workspace's `lastActiveAt` to the server's current time. Returns the same shape as the GET.

On app launch, the UI SHALL call `GET /api/workspaces/active` exactly once and apply this routing rule:

- `activeWorkspace` resolves (non-null, `status: "active"`) → route to the Dashboard for that workspace.
- `activeWorkspace` is null AND at least one workspace exists → auto-select the workspace with the most recent `lastActiveAt` (fallback: `createdAt`), `PUT` it as active, then route to the Dashboard.
- `activeWorkspace` is null AND no workspaces exist → route to the Import view.
- `activeWorkspace` resolves but its `status` is `detached`, OR its `path` no longer exists on disk → treat as null and apply the two preceding rules.

#### Scenario: Restore last-active on relaunch

- **GIVEN** the user previously had workspace `W1` active and quit the app
- **WHEN** the app relaunches
- **THEN** `GET /api/workspaces/active` returns `W1`
- **AND** the app routes directly to the Dashboard for `W1` without any intermediate Import or picker screen

#### Scenario: Auto-pick most-recent when active is null

- **GIVEN** `active_workspace_id` is null in the database AND two workspaces exist with `lastActiveAt` of T-1d and T-3d
- **WHEN** the app launches
- **THEN** the app issues `PUT /api/workspaces/active` with the T-1d workspace's id
- **AND** routes to that workspace's Dashboard

#### Scenario: Detached active falls through to Import

- **GIVEN** `active_workspace_id` points to a workspace with `status: "detached"` AND no other active workspaces exist
- **WHEN** the app launches
- **THEN** the app routes to the Import view
- **AND** does not show a stale Dashboard for the detached workspace

#### Scenario: First run with empty registry

- **GIVEN** a freshly initialised database with zero workspaces
- **WHEN** the app launches
- **THEN** `GET /api/workspaces/active` returns `{ activeWorkspaceId: null, activeWorkspace: null }`
- **AND** the app routes to the Import view
- **AND** the Dashboard route is unreachable until at least one workspace is attached

### Requirement: Sidebar renders a workspace switcher dropdown

The sidebar SHALL render a `WorkspaceSwitcher` component at the top, below the brand. The component SHALL replace any prior static workspace-picker element. It SHALL have a closed state (single row) and an open state (dropdown menu).

The closed-state row SHALL show, in order: the active workspace's `mark`, its `name`, its `topology` chip (one of `monolith`, `multi-repo · N repos`, `monorepo · N modules`), and a chevron. Clicking the row SHALL toggle the dropdown open.

The open-state dropdown SHALL contain, in order:

1. A header label `"N workspaces"` where N is the count of active workspaces.
2. One row per active workspace, sorted with the active workspace first and the remainder by `lastActiveAt` descending. Each row shows mark, name, topology chip, and an activity indicator (see "Activity indicator" requirement).
3. A separator.
4. An `+ Add workspace` row.
5. An `⚙ Manage workspaces` row (see "Manage workspaces row is disabled in v1" requirement).

The dropdown SHALL close on: (a) click outside the dropdown bounds, (b) `Esc` keypress, (c) selection of any row.

#### Scenario: Dropdown opens and lists workspaces

- **GIVEN** three active workspaces exist (`meas` multi-repo, `claudboard` monolith, `acme-platform` monorepo) and `meas` is active
- **WHEN** the user clicks the closed-state row
- **THEN** a dropdown appears containing four content rows in order: header `"3 workspaces"`, `meas` (first, marked as active), `claudboard`, `acme-platform`
- **AND** a separator
- **AND** the `+ Add workspace` and `⚙ Manage workspaces` rows below the separator

#### Scenario: Clicking a different workspace switches active

- **GIVEN** the dropdown is open with `meas` currently active
- **WHEN** the user clicks the `claudboard` row
- **THEN** the client issues `PUT /api/workspaces/active` with `claudboard`'s id
- **AND** the dropdown closes
- **AND** the app routes to the Dashboard for `claudboard`
- **AND** the closed-state row now shows `claudboard` with its monolith chip

#### Scenario: Clicking outside the dropdown closes it without switching

- **GIVEN** the dropdown is open
- **WHEN** the user clicks anywhere outside the dropdown bounds (including elsewhere in the sidebar or the main content area)
- **THEN** the dropdown closes
- **AND** no `PUT /api/workspaces/active` request is made

#### Scenario: Esc closes the dropdown

- **GIVEN** the dropdown is open and the user has not picked a row
- **WHEN** the user presses `Esc`
- **THEN** the dropdown closes
- **AND** the active workspace is unchanged

### Requirement: Each dropdown row carries an activity indicator

Each workspace row in the dropdown SHALL render an activity indicator on its right side. The indicator SHALL reflect the most relevant in-flight state for that workspace:

- Pulsing teal dot — at least one run with status `running` exists for this workspace.
- Static violet dot — no `running` runs, but at least one run with status `paused-gate` exists for this workspace.
- Static dim text showing relative age of the most recent run (e.g. `"17h"`, `"idle"`) — neither of the above.

#### Scenario: Running workspace shows pulsing teal dot

- **GIVEN** workspace `meas` has a run with status `running`
- **WHEN** the dropdown opens
- **THEN** the `meas` row shows a pulsing teal dot on its right side
- **AND** the dot is element-distinct from the active-workspace indicator (left accent)

#### Scenario: Idle workspace shows relative-age text

- **GIVEN** workspace `acme-platform` has no in-flight runs and its most recent run completed 17 hours ago
- **WHEN** the dropdown opens
- **THEN** the `acme-platform` row shows the text `"17h"` on its right side
- **AND** no dot is rendered

### Requirement: Add workspace row routes to the Import view

The `+ Add workspace` row SHALL route the application to the `import` screen when clicked. The Import view SHALL render its "Add a workspace" copy variant (as opposed to the first-run "Get started" variant) to signal context.

The user SHALL be able to return to the previously-active workspace from the Import view without attaching anything (e.g. via a Cancel affordance or breadcrumb).

#### Scenario: Add workspace from a populated dropdown

- **GIVEN** workspace `meas` is active and the dropdown is open
- **WHEN** the user clicks `+ Add workspace`
- **THEN** the dropdown closes
- **AND** the app routes to the Import view with title copy `"Add a workspace"`
- **AND** canceling the Import view returns the user to the `meas` Dashboard (the active workspace is unchanged)

### Requirement: Manage workspaces row is disabled in v1

The `⚙ Manage workspaces` row SHALL be rendered visible-but-disabled in the dropdown. It SHALL have `aria-disabled="true"`, reduced opacity, `cursor: not-allowed`, and a `title` attribute of `"Coming soon"`. Clicking the row SHALL NOT fire any callback or change any route.

The `manage` route SHALL exist and SHALL render a placeholder component, so that a future change can fill in the page without re-wiring the dropdown or the App's router. No nav item or other entry point SHALL link to the `manage` route in this change.

#### Scenario: Disabled manage row is non-interactive

- **GIVEN** the dropdown is open
- **WHEN** the user clicks the `⚙ Manage workspaces` row
- **THEN** no navigation occurs
- **AND** the dropdown does not close
- **AND** no network request is made

#### Scenario: Manage row exposes "Coming soon" tooltip

- **WHEN** the user hovers `⚙ Manage workspaces`
- **THEN** the browser-native tooltip reveals the text `"Coming soon"`
- **AND** the row's `aria-disabled` attribute is `"true"`

#### Scenario: Manage route renders a stub when reached directly

- **WHEN** the App router is forced to the `manage` route (e.g. by manipulation in dev tools)
- **THEN** a stub component renders with copy indicating the page is not yet built
- **AND** no crash, no console error

### Requirement: Workspace records include a display mark

The `Workspace` record SHALL include a `mark` field — a 1–2 character glyph used as the visual marker for the workspace in the sidebar icon and the dropdown rows. On attach, the system SHALL derive `mark` from the workspace `name` by taking the first letter (uppercased) if `name` is a single word, or the first letter of the first two words if `name` contains a separator (space, hyphen, underscore, dot).

The `mark` field SHALL be persisted in the workspaces table and SHALL be editable in the (future) Manage workspaces page. This change does not expose an editor; only the derivation-on-attach behaviour is in scope.

#### Scenario: Single-word name derives a single-letter mark

- **GIVEN** the user attaches a workspace at `/Users/x/dev/claudboard`
- **WHEN** the workspace is persisted
- **THEN** the record's `mark` is `"C"`

#### Scenario: Multi-word name derives a two-letter mark

- **GIVEN** the user attaches a workspace at `/Users/x/work/acme-platform`
- **WHEN** the workspace is persisted
- **THEN** the record's `mark` is `"AP"`

#### Scenario: Sidebar renders the mark glyph

- **WHEN** the sidebar workspace switcher renders for active workspace `acme-platform` with `mark: "AP"`
- **THEN** the closed-state row displays the `mark` text inside the workspace-icon box
