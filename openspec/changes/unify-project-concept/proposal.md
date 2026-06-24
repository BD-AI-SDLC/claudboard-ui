## Why

The UI exposes two top-level concepts (workspaces and projects) that the user must mentally reconcile, and the Overview branches into three shapes based on a topology field the user is asked to pick manually at import. Two concrete bugs fall out: (1) the folder-import path hardcodes `topology = 'monolith'` regardless of folder shape (`ImportView.tsx:35-40`), so a multi-repo workspace gets persisted as a monolith; (2) `GET /api/projects` has no workspace filter, so the Dashboard shows projects from other workspaces as "services" of the active workspace. The user's mental model has one top-level thing — call it a project — and its git layout is display metadata, not a hierarchy level. Today's code disagrees, the bugs follow.

## What Changes

- **BREAKING — rename `workspace` → `project` across the public API and UI.** The top-level abstraction the user picks is now called a project. `GET /api/workspaces` → `GET /api/projects`, `WorkspaceSwitcher` → `ProjectSwitcher`, `Workspace` type → `Project`.
- **BREAKING — rename internal `project` → `repo`.** The per-git-repo row inside a multi-repo project keeps existing in the model (needed by Kickoff for targeting), but is renamed to `repo` to free up the `project` name. `Project` (protocol type, sub-repo) → `Repo`. DB `projects` table → `repos`. `GET /api/projects` (the old sub-repo list) → `GET /api/repos`.
- **Drop the topology question from Import.** The topology step in `ImportView.tsx` is removed entirely. The server auto-classifies on attach and ignores any client-supplied topology.
- **Fix the classifier so multi-repo detection works without `.claude` at root.** New rule (pure FS): no `.git` at root + ≥2 direct child dirs each containing `.git` → `multi-repo-workspace`. This is invisible in the UI but required so Kickoff sees the right sub-repos.
- **Collapse three Overview shapes into one.** Delete `OverviewMono`, `OverviewMulti`, `OverviewMonoz`. Replace with a single Overview body for all topologies: KPI strip (Active runs, Awaiting gate, In review, Merged this week) + full-width Recent runs panel. No services/modules table.
- **Delete the "Vertical operations" strip** from the Dashboard.
- **Delete the top-bar `ProjectPicker`.** The sidebar `ProjectSwitcher` becomes the sole picker. (Top-bar was a duplicate listing every sub-repo across every project.)
- **Scope per-project data by `?projectId=` query param.** `GET /api/repos` and `GET /api/runs` accept and filter by `projectId`. `App.tsx` passes `activeProjectId` and refetches on project switch. The active-run banner is scoped to its project — switching away hides it; switching back shows it.

## Capabilities

### New Capabilities

None. (No new capability files — all changes modify existing capabilities.)

### Modified Capabilities

- `workspace-registry`: rename capability to `project-registry`; classifier no longer requires `.claude` for multi-repo detection; server ignores client-supplied topology; API surface renamed from `/api/workspaces`/`/api/projects` to `/api/projects`/`/api/repos`; `/api/repos` and `/api/runs` accept `?projectId=` filter.
- `web-ui`: remove three-shape adaptive Overview; remove Vertical operations strip; remove top-bar `ProjectPicker`; rename `WorkspaceSwitcher` → `ProjectSwitcher`; drop topology question from Import; scope all per-project data fetches by `activeProjectId`; scope active-run banner to its project.

## Impact

- **Code (protocol):** rename `Workspace` type → `Project`; rename `Project` type → `Repo`; update Zod schemas in `protocol/src/`. Wide import-path ripple in `server` and `ui`.
- **Code (server):**
  - DB schema: rename `workspaces` table → `projects`, rename `projects` table → `repos`. Foreign key column `workspace_id` → `project_id` on `repos`. Migration uses additive create-rename-drop pattern, not in-place `ALTER TABLE RENAME` (better cross-version safety in SQLite). `active_workspace_id` setting key → `active_project_id`.
  - Routes: `server/src/registry/routes.ts` renamed paths and handlers. `GET /api/repos` accepts `?projectId=`. `server/src/run/routes.ts` `GET /api/runs` accepts `?projectId=`.
  - Classifier: `server/src/registry/classifier.ts` Case 1 condition relaxed — drop `hasClaude` requirement for `multi-repo-workspace`.
  - `POST /api/projects` (attach) ignores `body.topology` — always uses detected.
- **Code (UI):**
  - Delete: `OverviewMono.tsx`, `OverviewMulti.tsx`, `OverviewMonoz.tsx`, `components/Picker/ProjectPicker.tsx`.
  - Rename: `WorkspaceSwitcher/` → `ProjectSwitcher/`.
  - Modify: `Dashboard.tsx` (single Overview body, drop topology branch, drop VOPS), `ImportView.tsx` (drop topology step + state), `App.tsx` (pass `activeProjectId` to all per-project fetches; refetch on switch).
  - `api/client.ts`: rename `getWorkspaces`/`createWorkspace`/`getActiveWorkspace`/`setActiveWorkspace` → `getProjects`/`createProject`/`getActiveProject`/`setActiveProject`; rename `getProjects` (old sub-repo) → `getRepos`; add `projectId` arg to `getRepos` and `getRuns`.
- **APIs:** **BREAKING** — all `/api/workspaces` and old `/api/projects` paths renamed. No backwards-compat shim (local-only tool, no external consumers).
- **Dependencies:** None.
- **Behaviour:** First-run Import no longer asks topology. Existing projects remain valid; topology auto-corrected on next attach. Cross-project data contamination on the Overview disappears. Multi-repo folders attached without a pre-existing `.claude/` are correctly classified.

## Archival Note

The `{ remoteUrl }` body shape on `POST /api/projects` and the corresponding Import-view scenarios were REMOVED by `openspec/changes/remove-clone-from-git-url/`. When this change is archived into live specs, the archiver MUST drop the `remoteUrl` mentions in `specs/workspace-registry/spec.md` and `specs/web-ui/spec.md` (the Clone-from-Git-URL paths), or the removal will be silently re-introduced.
