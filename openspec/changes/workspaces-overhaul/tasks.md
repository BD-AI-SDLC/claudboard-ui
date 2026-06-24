## 1. Registry: active-workspace persistence

- [x] 1.1 Add `last_active_at` (nullable ISO timestamp) and `mark` (nullable string, 1–2 chars) columns to the `workspaces` table in the SQLite schema. Provide a migration that backfills `last_active_at = createdAt` and `mark = upper(substr(name, 1, 1))` for existing rows.
- [x] 1.2 Add a `kv_settings` singleton table (`key TEXT PRIMARY KEY, value TEXT`). Seed `('active_workspace_id', NULL)`.
- [x] 1.3 Implement `GET /api/workspaces/active` — returns `{ activeWorkspaceId: string | null, activeWorkspace: Workspace | null }`. If `active_workspace_id` points to a workspace with `status: "detached"` or that no longer exists in the table, return `{ activeWorkspaceId: null, activeWorkspace: null }`.
- [x] 1.4 Implement `PUT /api/workspaces/active` with body `{ workspaceId: string }`. Sets the singleton AND updates that workspace's `last_active_at` to `now()`. Returns the same shape as the GET. 404 if the workspaceId does not exist or is detached.
- [x] 1.5 Extend the existing `POST /api/workspaces` body to accept `{ topology: "monolith" | "monorepo" | "multi-repo-workspace" }` and `{ mark?: string }`. When `topology` is provided, it overrides the registry's auto-classification for the persisted record (the classifier still runs and its result is returned alongside the persisted value so the UI can surface a "we detected X but you picked Y" warning).

## 2. Registry: Clone-Git-URL attach path

- [x] 2.1 Extend `POST /api/workspaces` to accept an alternative body `{ remoteUrl: string, topology, mark? }` (mutually exclusive with `{ root }`). The endpoint clones into `~/dev/<repo-name>` (basename of the URL minus `.git`), then runs the existing attach + classify flow against the cloned directory.
- [x] 2.2 Add a 60s timeout on the clone subprocess; surface failure as `400` with body `{ error: "clone failed", detail: <git stderr last line> }`. If the target directory already exists, return `409 { error: "destination exists", path }` — do not overwrite.
- [x] 2.3 Add `simple-git` (or equivalent thin wrapper) to server dependencies if not already present. Wire the clone helper as a single function in the workspace module — no global config.

## 3. UI data layer

- [x] 3.1 Replace the static `D.projects` mock in `ui/designs/src/data.js` with `D.workspaces[]` (array of Workspace records) and `D.activeWorkspaceId` (string | null). Seed three demo workspaces — one of each topology — so the design surface continues to render meaningfully. Keep per-workspace nested `repos[]` (for multi) and `modules[]` (for monoz) inside each workspace record.
- [x] 3.2 In `app.jsx`, add a launch effect that fetches `/api/workspaces/active` and stores `activeWorkspace` in App state. If `activeWorkspace` is null and `workspaces.length === 0`, set route to `import`. If null but workspaces exist, auto-pick the most recent by `last_active_at` and `PUT /api/workspaces/active`, then route to `dashboard`. If `activeWorkspace` resolves, route to `dashboard`.
- [x] 3.3 Thread `activeWorkspace` through props/context so `Sidebar`, `ScreenDashboard`, and the other screens read from one source. Remove all hardcoded references to `D.projects[0]` / `"meas"` / similar.

## 4. WorkspaceSwitcher dropdown

- [x] 4.1 New component `ui/designs/src/workspace-switcher.jsx` — renders the closed-state row (mark + name + topology chip + chev) and the open-state dropdown (list of workspaces + sep + Add row + Manage row).
- [x] 4.2 Dropdown state is local component state (`useState`); clicking the closed row toggles open; clicking outside closes (use a `useEffect` with `mousedown` listener bound to `document`); pressing `Esc` closes.
- [x] 4.3 Each workspace row shows `mark`, `name`, topology chip, and an activity dot (pulse-teal if any run for this workspace has status `running`, static-violet if any `paused-gate`, static-dim otherwise). The active workspace's row has a left-accent and is sorted first.
- [x] 4.4 Clicking a workspace row calls `PUT /api/workspaces/active`, updates App state, closes the dropdown, routes to `dashboard`.
- [x] 4.5 The `+ Add workspace` row routes to `import` (with App-state flag so the Import view knows it's "add", not "first-run" — affects only the title copy).
- [x] 4.6 The `⚙ Manage workspaces` row renders with `aria-disabled="true"`, reduced opacity, `cursor: not-allowed`, title="Coming soon". Clicking does nothing.
- [x] 4.7 Replace the `workspace-picker` div in `sidebar.jsx` with `<WorkspaceSwitcher activeWorkspace={...} workspaces={...} onSwitch={...} onAdd={...} />`.

## 5. Sidebar cleanup

- [x] 5.1 Remove the `nav-section` block at `sidebar.jsx:129–165` ("Repos in workspace · N" with the per-repo row mapping). Remove any state/props that became unused.
- [x] 5.2 Verify that the Workflow and Project nav sections still render correctly with the dropdown above them — no spacing regressions.

## 6. Import view (first-run + Add workspace)

- [x] 6.1 New component `ui/designs/src/screen-import.jsx` — full-page two-card layout (Open local folder, Clone from Git URL). Title copy: "Get started — point me at a project" (first-run) or "Add a workspace" (add).
- [x] 6.2 Open-local-folder card opens the directory-browser pane (extract from existing modal logic into a reusable component `<DirectoryBrowser>`). Use the existing `GET /api/fs/browse` endpoint.
- [x] 6.3 Clone-Git-URL card opens an inline form with a URL text input and a Clone button. On Clone, show a spinner; on success, advance to the topology picker step; on error, show inline message and stay on the form.
- [x] 6.4 Topology picker step appears after a folder is chosen or a clone completes. Three radio cards (monolith / multi-repo-workspace / monorepo) with short descriptions. The card matching the registry's auto-classification is pre-selected with a "(detected)" hint. Confirm button calls `POST /api/workspaces` with the path/URL + user-picked topology.
- [x] 6.5 On 201, set the new workspace as active (`PUT /api/workspaces/active`), close Import, route to `dashboard`. On error, surface inline.
- [x] 6.6 Remove the standalone attach-repo modal mount point in `app.jsx` — the modal is replaced by the Import view. Keep `DirectoryBrowser` exported so a future change can re-mount it in a modal context if needed.

## 7. Adaptive Overview — three sub-views

- [x] 7.1 In `screen-dashboard.jsx`, replace the existing single-shape body with a switch on `activeWorkspace.topology` that dispatches to one of `OverviewMono`, `OverviewMulti`, `OverviewMonoz`. The page header (h1 with workspace name + topology chip, sub-line with path/branch/stack) is shared above the switch.
- [x] 7.2 Extract `OverviewMulti` as the current multi-repo layout (services directory + cross-service edges + recent runs split). Move it into its own file `ui/designs/src/overview-multi.jsx`. Behavior unchanged from today's `ScreenDashboard`.
- [x] 7.3 New `OverviewMono` in `ui/designs/src/overview-mono.jsx`: KPI strip + full-width Recent runs (no per-repo tag in the row sub-text since there's only one repo) + optional Modules informational list when `activeWorkspace.modules?.length > 0`. Matches `Overview Variants.html` tab 1.
- [x] 7.4 New `OverviewMonoz` in `ui/designs/src/overview-monoz.jsx`: KPI strip + Modules/packages directory (linkable rows) + full-width Recent runs tagged with `module` in the row sub-text. Matches `Overview Variants.html` tab 3.
- [x] 7.5 Confirm the KPI strip component is reusable across all three (extract into `components.jsx` if it isn't already). Same for the Recent runs row.

## 8. Manage workspaces stub

- [x] 8.1 New component `ui/designs/src/screen-manage.jsx` — renders a placeholder body ("Manage workspaces — coming soon" with a 1-line description). Reuses page-header pattern.
- [x] 8.2 Wire the `manage` route in `app.jsx`. No nav item — the only entry point is the dropdown row (which is disabled in this change), so the route is reachable only by direct manipulation, but it exists for the next change to enable.

## 9. Spec compliance + cleanup

- [x] 9.1 Remove the static `STATIC_FEED` / hardcoded `meas` references identified in audit. Confirm `web-ui`'s "no mock data shipped in production" rule still holds (the seed `D.workspaces` is design-surface only and lives under `ui/designs/`, not the production bundle path).
- [x] 9.2 Confirm the existing `web-ui` requirement "Kickoff form is identical across topologies" still holds — no per-topology branching leaked into Kickoff.
- [x] 9.3 Confirm the existing sidebar "context-aware items" requirement still works with the new `activeWorkspace` prop — e.g. "Active run" enable-state derives from runs filtered by `activeWorkspace.id`.

## 10. Tests

- [ ] 10.1 Unit test the launch-flow logic in `app.jsx`: zero workspaces → Import; active resolves → Dashboard; active null with workspaces present → auto-pick + Dashboard; active points to detached → fall through to Import (or auto-pick if others exist).
- [ ] 10.2 Unit test `WorkspaceSwitcher` — opens on click, closes on outside-click and Esc, calls `onSwitch` with the chosen id, disabled Manage row does not call `onManage`.
- [ ] 10.3 Component test that `ScreenDashboard` dispatches to the correct sub-view per topology (3 cases) and renders nothing (or routes away) when `activeWorkspace` is null.
- [x] 10.4 API test: `PUT /api/workspaces/active` updates the singleton and bumps `last_active_at`; rejects unknown id with 404; rejects detached workspace with 404.
- [x] 10.5 API test: `POST /api/workspaces` with `{ remoteUrl }` clones, classifies, persists with the user-picked topology, and returns the persisted record plus the classifier's verdict; surfaces clone failures as 400; surfaces destination-exists as 409.

## 11. Manual verification

- [ ] 11.1 Fresh install (delete `~/.bosch-sdlc/state.db`): app launches into Import view; no console errors.
- [ ] 11.2 Attach a monolith folder: lands on Overview with `OverviewMono` shape — no services list, focused recent runs.
- [ ] 11.3 Attach a multi-repo workspace: lands on Overview with `OverviewMulti` shape — services directory, edges, tagged runs.
- [ ] 11.4 Attach a monorepo: lands on Overview with `OverviewMonoz` shape — modules directory, module-tagged runs.
- [ ] 11.5 With 3 workspaces present, open the sidebar dropdown: lists all three with correct topology chips and activity dots; clicking each switches and the Overview body shape updates.
- [ ] 11.6 Quit and relaunch the app: lands on the last-active workspace's Overview.
- [ ] 11.7 With workspaces present, click `+ Add workspace` in the dropdown: lands on Import with "Add a workspace" title; canceling returns to the previously-active Overview.
- [ ] 11.8 Hover `⚙ Manage workspaces` in the dropdown: shows "Coming soon" tooltip; clicking does nothing.
- [ ] 11.9 Detach the active workspace's folder on disk, relaunch: app lands on Import (or auto-picks another if any exist).
