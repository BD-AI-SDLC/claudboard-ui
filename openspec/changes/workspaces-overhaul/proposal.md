## Why

Today the UI is hardcoded to a single workspace (`meas`, multi-repo). The sidebar shows a static fake workspace picker that doesn't open a menu and doesn't list other workspaces. The Overview is a one-shape page that assumes the workspace is multi-repo — even though the underlying `workspace-registry` already classifies workspaces as `monolith`, `monorepo`, or `multi-repo-workspace` and persists them. Three real problems fall out:

1. **Users with more than one workspace cannot switch.** There is no UX path from one workspace's Overview to another's. New workspaces can be attached, but only the first one is ever shown.
2. **The Overview misrepresents single-repo setups.** A monolith user sees a "Services" directory listing one row plus an empty "Cross-service edges" panel. The page promises a workspace but delivers a noisy fake-multi shape.
3. **First-run has no surface.** A fresh install with zero workspaces lands on a Dashboard that queries an empty registry — there is no empty-state guidance pointing the user at how to attach their first folder.

The design exploration in `ui/designs/Overview Variants.html` resolves all three by introducing a single workspace switcher dropdown at the top of the sidebar (the one entry point for switch + add + manage), an adaptive Overview body that takes its shape from `activeWorkspace.topology`, and a full-page Import view that doubles as first-run empty state and "Add workspace" target. The current `workspace-registry` spec explicitly says topology is "informational only — no runtime behavior branches on it"; this change replaces that line.

## What Changes

- **Workspace switcher dropdown** in the sidebar — replaces the static `workspace-picker` div. Lists all workspaces with their topology chip and an activity dot; one row per workspace; clicking switches; bottom rows are `+ Add workspace` and `⚙ Manage workspaces` (the latter visible-but-disabled for now).
- **Active workspace concept** persisted across sessions — the registry tracks which workspace is "active." On app launch the UI restores the last-active workspace and routes to its Overview. If the last-active path is no longer on disk, the UI falls back to the Import view.
- **Three adaptive Overview shapes** keyed off `activeWorkspace.topology`:
  - `monolith` — no repo list. KPI strip + focused full-width Recent runs + optional informational Modules list.
  - `multi-repo-workspace` — KPI strip + Services directory + split Cross-service edges + Recent runs (tagged with repo).
  - `monorepo` — KPI strip + Modules/packages directory + Recent runs (tagged with module).
- **Import view** (full-page, not modal) used in two situations: as the first-run empty state when zero workspaces exist, and as the body when the user clicks `+ Add workspace`. Replaces the current "Directory-browser modal for attach repo" requirement in `web-ui`. Two import cards: `Open local folder` (existing directory-browser flow, now full-page) and `Clone from Git URL` (new). Topology is picked manually by the user during import (no auto-detection in v1).
- **Manage workspaces stub** — a new routable screen reachable from the dropdown's `⚙ Manage workspaces` row. The dropdown row is greyed/disabled with a "Coming soon" tooltip; the route renders a placeholder body so a future change can fill it in without re-wiring navigation.
- **Sidebar cleanup** — remove the "Repos in workspace" section (`sidebar.jsx:129–165`). With the Overview as the workspace home, the duplicate list in the sidebar is redundant.

**Deferred (explicitly out of scope for this change):**

- The "Continue from existing setup" detected card (filesystem scan for `.claude/` folders). The dropdown row "Import from terminal session" is also dropped from v1.
- Auto-detection of topology from folder shape. The `workspace-registry` rules still classify on attach (they always have), but the Import view's UX presents an explicit topology picker instead of inferring silently from the folder.
- A real Manage workspaces page (only the route + placeholder ship).

## Capabilities

### New Capabilities

- **`workspace-switcher`** — dropdown component, active-workspace selection + persistence, launch-time restore, Manage stub route.

### Modified Capabilities

- **`workspace-registry`** — topology is no longer "informational only"; it becomes the routing key for the adaptive Overview. Adds `last_active_at` and an `active_workspace_id` singleton to the persisted state so the UI can restore on launch. Adds a Clone-Git-URL attach path alongside the existing local-folder one.
- **`web-ui`** — replaces the modal-based attach-repo flow with a full-page Import view (reused by first-run and Add workspace). Replaces the single-shape Dashboard with three adaptive shapes keyed off topology. Removes the "Repos in workspace" sidebar section. Adds the workspace switcher to the sidebar and a Manage workspaces stub route.

## Impact

- **Code (UI):**
  - `ui/designs/src/sidebar.jsx` — replace static picker with `WorkspaceSwitcher` component; drop "Repos in workspace" section.
  - `ui/designs/src/screen-dashboard.jsx` — split into three sub-views (`OverviewMono`, `OverviewMulti`, `OverviewMonoz`) selected by `activeWorkspace.topology`.
  - New: `ui/designs/src/workspace-switcher.jsx`, `ui/designs/src/screen-import.jsx`, `ui/designs/src/screen-manage.jsx`.
  - `ui/designs/src/app.jsx` — launch-flow branch: restore last-active → Overview, else Import; route `add-workspace` and `manage`.
  - `ui/designs/src/data.js` — replace static `D.projects` with `D.workspaces[]` + `D.activeWorkspaceId`; seed 3 demo workspaces (mono / multi / monoz) for the design surface.
  - `ui/designs/src/styles.css` — dropdown open state, import-card styles already in `Overview Variants.html`; port to component styles.
- **Code (server / registry):**
  - SQLite schema additions: `last_active_at` column on workspaces; `active_workspace_id` row in a singleton settings table.
  - `GET /api/workspaces/active` and `PUT /api/workspaces/active` endpoints.
  - `POST /api/workspaces` extended to accept `{ remoteUrl }` for the Clone-Git-URL path (existing `{ root }` path unchanged).
  - `topology` field now drives UI shape; the server keeps it informational on its end (no server behaviour branches on it).
- **APIs:** `POST /api/workspaces/active`, `GET /api/workspaces/active`, extended `POST /api/workspaces` body. No breaking changes to existing endpoints.
- **Dependencies:** None new on the UI; server gains a git-clone helper (likely `simple-git` if not already present) for the Clone-Git-URL path.
- **Behaviour:** First-run users land on Import instead of an empty Dashboard. Existing users with one workspace see no observable difference except the dropdown is now a real menu instead of a static label. Existing users with multiple workspaces gain a real switcher.

## Archival Note

The `{ remoteUrl }` body shape on `POST /api/workspaces` / `POST /api/projects` and the corresponding Clone-from-Git-URL UI card described above were REMOVED by `openspec/changes/remove-clone-from-git-url/`. When this change is archived into live specs, the archiver MUST omit `remoteUrl` from the promoted requirements and scenarios (specifically the lines in `specs/workspace-registry/spec.md` and the Clone-from-Git-URL section in `specs/web-ui/spec.md`), or the removal will be silently re-introduced.
