## 1. Protocol rename (foundation)

- [x] 1.1 In `protocol/src/`, rename the existing `Workspace` type/schema → `Project`. Update the file name if appropriate (`workspace.ts` → `project.ts`) or keep co-located in `index.ts` per existing convention.
- [x] 1.2 In `protocol/src/`, rename the existing `Project` type/schema → `Repo`. The `Repo` shape keeps all existing `Project` fields (path, name, topology, status, etc.) plus a `projectId` field replacing `workspaceId`.
- [x] 1.3 Rename Zod object names accordingly (`WorkspaceSchema` → `ProjectSchema`, `ProjectSchema` (old) → `RepoSchema`).
- [x] 1.4 Update any protocol-level event payloads that carry `workspaceId` or `projectId` (the old kind) — `workspaceId` → `projectId`; old `projectId` → `repoId`.
- [x] 1.5 `npm run -w protocol build` — confirm it compiles.

## 2. Server: DB schema migration

- [x] 2.1 In `server/src/db.ts`, add a migration block under `runMigrations()` wrapped in a single `db.transaction()`.
- [x] 2.2 Migration step: if `projects_new` does not exist AND `workspaces` exists, create `projects_new` mirroring the current `workspaces` schema.
- [x] 2.3 Migration step: if `repos` does not exist AND old `projects` exists, create `repos` mirroring current `projects` schema with `project_id` instead of `workspace_id`.
- [x] 2.4 Migration step: `INSERT INTO projects_new SELECT … FROM workspaces` (preserve all columns and IDs).
- [x] 2.5 Migration step: `INSERT INTO repos SELECT id, workspace_id AS project_id, path, name, topology, status, created_at, last_active_at, … FROM projects` (preserve IDs).
- [x] 2.6 Migration step: drop old `workspaces` and old `projects` tables.
- [x] 2.7 Migration step: rename `projects_new` → `projects` via `ALTER TABLE projects_new RENAME TO projects`.
- [x] 2.8 Migration step: rename `kv_settings` key `active_workspace_id` → `active_project_id` (UPDATE row's key).
- [x] 2.9 Update `getDb()` consumers' typed row interfaces: `WorkspaceRow` → `ProjectRow`, `ProjectRow` (old per-repo) → `RepoRow`.

## 3. Server: registry routes rename and behavior changes

- [x] 3.1 In `server/src/registry/routes.ts`, rename URL paths: `/api/workspaces` → `/api/projects`, `/api/workspaces/active` → `/api/projects/active`, `/api/projects` (old, sub-repo list) → `/api/repos`, `/api/workspaces/:id` (DELETE) → `/api/projects/:id`.
- [x] 3.2 Rename mapping functions (`mapWorkspaceRow` → `mapProjectRow`; old `mapProjectRow` → `mapRepoRow`).
- [x] 3.3 In `POST /api/projects` handler, remove the line that reads and persists `body.topology`. Always use the classifier's `detectedTopology` as the persisted value.
- [x] 3.4 In `GET /api/repos` handler, require `?projectId=` query param. Return 400 with `{ error: "projectId is required" }` if absent. Filter the SQL by `project_id`.
- [x] 3.5 In `GET /api/projects/active` and `PUT /api/projects/active`, rename response field `activeWorkspaceId` → `activeProjectId`, `activeWorkspace` → `activeProject`. Rename request body field `workspaceId` → `projectId`.
- [x] 3.6 Update `kv_settings` query strings to use the new key `active_project_id`.
- [x] 3.7 Re-export the router as `projectRegistryRouter` (renamed from `registryRouter`); update mount in `app.ts`.

## 4. Server: classifier fix

- [x] 4.1 In `server/src/registry/classifier.ts:18`, remove the `scan.hasClaude` requirement from the multi-repo Case 1 condition. New condition: `!scan.gitRoot && scan.childRepos.length >= 2`.
- [x] 4.2 Verify that the existing Case 3 fall-through (parent dir with child repos but didn't match Case 1) is now dead code — remove it.
- [x] 4.3 Update `server/src/registry/__tests__/classifier.test.ts` — add a test case for "multi-repo folder without .claude at root is classified as multi-repo-workspace".

## 5. Server: runs route scoping

- [x] 5.1 In `server/src/run/routes.ts`, modify `GET /api/runs` handler to require `?projectId=` query param. Return 400 with `{ error: "projectId is required" }` if absent.
- [x] 5.2 Update the SQL to JOIN through `repos` to `projects` and filter by `repos.project_id = :projectId`, OR if `runs` directly carries `project_id`, filter on that column. Confirm schema before choosing.
- [x] 5.3 If `runs` table needs a `project_id` denormalisation for this filter, add it as an additive migration in `db.ts` and backfill from the existing repo→project link.

## 6. Server: tests

- [x] 6.1 Update test fixtures and assertions in `server/src/__tests__/` to use `projects` table / `Project` shape / `/api/projects` path / `repos` table / etc. Mechanical rename.
- [x] 6.2 Add an integration test in `server/src/__tests__/db-migration.test.ts` that: creates the old schema (`workspaces`, `projects`), inserts 2 + 3 rows, runs the migration, and asserts the new schema has the same row IDs in `projects` and `repos` with `project_id` correctly populated.
- [x] 6.3 Add an integration test that calls `GET /api/repos` without `?projectId=` and asserts 400 with the documented error body.
- [x] 6.4 Add an integration test that calls `GET /api/repos?projectId=P1` with two projects seeded and asserts only P1's repos are returned.
- [x] 6.5 Add the same pair of tests for `GET /api/runs`.
- [x] 6.6 Add an integration test for `POST /api/projects` with `{ root, topology: "monolith" }` against a multi-repo folder; assert the persisted topology is `multi-repo-workspace`, ignoring the client's value.
- [x] 6.7 `node --experimental-vm-modules ../node_modules/.bin/jest` from `server/` — full suite passes.

## 7. UI: API client rename

- [x] 7.1 In `ui/src/api/client.ts`, rename methods: `getWorkspaces` → `getProjects`, `createWorkspace` → `createProject`, `getActiveWorkspace` → `getActiveProject`, `setActiveWorkspace` → `setActiveProject`, `deleteWorkspace` → `deleteProject`, old `getProjects` → `getRepos`.
- [x] 7.2 Add a `projectId` arg to `getRepos(projectId)` and to `getRuns(projectId)`. Both append `?projectId=<id>` to the request URL.
- [x] 7.3 Update method return type generics to use `Project` / `Repo` (the renamed protocol types).

## 8. UI: rename components

- [x] 8.1 Rename directory `ui/src/components/WorkspaceSwitcher/` → `ui/src/components/ProjectSwitcher/`. Rename files inside (`WorkspaceSwitcher.tsx` → `ProjectSwitcher.tsx`, same for CSS / tests).
- [x] 8.2 In `ProjectSwitcher.tsx`, rename component `WorkspaceSwitcher` → `ProjectSwitcher`, all internal terminology (props, variables, strings). The "Add workspace" / "Manage workspaces" row labels become "Add project" / "Manage projects". The header counter `"N workspaces"` becomes `"N projects"`.
- [x] 8.3 Update all import sites of `WorkspaceSwitcher` to import `ProjectSwitcher` from the new path.

## 9. UI: delete dead components

- [x] 9.1 Delete `ui/src/components/Picker/ProjectPicker.tsx` and its CSS / test. Delete the `ui/src/components/Picker/` directory if it becomes empty.
- [x] 9.2 Remove all imports of `ProjectPicker` from the codebase (Dashboard, App, anywhere else).
- [x] 9.3 Delete `ui/src/components/Dashboard/OverviewMono.tsx`, `OverviewMulti.tsx`, `OverviewMonoz.tsx`. Delete their CSS if separate.
- [x] 9.4 Delete the `RecentRunsPanel` import from the per-shape Overview files if not used elsewhere (verify before deleting).

## 10. UI: Dashboard single-shape Overview

- [x] 10.1 In `ui/src/components/Dashboard/Dashboard.tsx`, replace the `renderBody()` switch on `activeProject.topology` with a single Overview body: KPI strip + full-width `RecentRunsPanel`. Inline the layout (no separate component needed).
- [x] 10.2 Remove the entire `VOPS` constant and the "Vertical operations · across workspace" card.
- [x] 10.3 Rename component prop `activeWorkspace` → `activeProject` (and its type from `Workspace` → `Project`).
- [x] 10.4 Remove the `<AttachRepoModal>` mount and the `attachModalOpen` / `handleAttachPick` logic from `Dashboard.tsx`. The Dashboard never opens the attach modal directly — Add project happens via the sidebar switcher → Import view.

## 11. UI: Import view simplification

- [x] 11.1 In `ui/src/components/Import/ImportView.tsx`, delete the `topology` step entirely. Remove the `TOPOLOGIES` constant, the `step === 'topology'` block, the `detectedTopology` / `selectedTopology` / related state, and the `handleConfirm` function.
- [x] 11.2 Replace `handleFolderPick(path)` so it calls `api.createProject({ root: path })` directly, then `api.setActiveProject(ws.id)`, then `onAttach(ws)`. Same shape as the prior `handleConfirm` but no topology field.
- [x] 11.3 Update `handleClone` so that after the server's POST response it does NOT read `detectedTopology` from the response (the value still exists for diagnostics but is not consumed by the UI). Skip directly to setting the new project active.
- [x] 11.4 Update the `Step` type union: remove `'topology'`. Steps are now `'cards' | 'folder' | 'clone'`.

## 12. UI: App.tsx wiring

- [x] 12.1 In `ui/src/App.tsx`, rename state `workspaces` → `projects`, `activeWorkspaceId` → `activeProjectId`, `activeWorkspace` → `activeProject`. Rename derived computations accordingly.
- [x] 12.2 Replace `api.getProjects()` (which previously returned all sub-repos globally) with `api.getRepos(activeProjectId)`. The local state name `projects` was overloaded — pick a new name for the sub-repos collection (`repos`) to disambiguate.
- [x] 12.3 Wrap the repos fetch and runs fetch in an effect keyed on `activeProjectId`. When `activeProjectId` changes, both fetches re-issue.
- [x] 12.4 Pass `activeProjectId` and `activeProject` into `Dashboard` and any other consumers via props.
- [x] 12.5 Verify the active-run banner derivation reads from the now-scoped `runs` state (no extra change needed — it inherits scoping for free).

## 13. UI: terminology sweep

- [x] 13.1 Grep `ui/src/` for the literal string `"workspace"` (case-insensitive) — review each hit and rewrite to `"project"` where it refers to the top-level abstraction. Skip hits where "workspace" refers to npm workspaces or unrelated concepts.
- [x] 13.2 Same grep for `"Workspace"` (capital W in identifiers) and replace with `"Project"` where it refers to the protocol type.
- [x] 13.3 Update CSS class names in `WorkspaceSwitcher.css` (now `ProjectSwitcher.css`) that use `workspace-switcher__` → `project-switcher__`. Run `npm run lint` to confirm CSS prefix lint passes.

## 14. UI: tests

- [x] 14.1 Update `WorkspaceSwitcher.test.tsx` (renamed) and any other tests that reference `Workspace` / `getWorkspaces` / `createWorkspace` / `setActiveWorkspace`.
- [x] 14.2 Delete tests for `OverviewMono`, `OverviewMulti`, `OverviewMonoz` if they exist.
- [x] 14.3 Add a Dashboard test that mocks `api.getRepos` and `api.getRuns` and asserts both are called with the `activeProjectId` of a seeded project.
- [x] 14.4 Add a test that switches `activeProjectId` (via re-render with a new prop) and asserts both APIs are re-called with the new id.
- [x] 14.5 Add an ImportView test that picks a folder and asserts `api.createProject` is called with `{ root: path }` only — no `topology` field.
- [x] 14.6 `npx vitest run` from `ui/` — full suite passes.

## 15. Cross-cutting verification

- [x] 15.1 `npm run build` from repo root — confirm protocol → server → ui all build clean.
- [x] 15.2 `npm run typecheck` — confirm no type errors.
- [x] 15.3 `npm run lint` — confirm CSS prefix lint and any other lints pass.
- [x] 15.4 `npm run test` — confirm all tests pass.

## 16. Manual smoke test

- [x] 16.1 Run the dev server with a clean DB. Walk: Import → pick a folder containing 2+ git repos with no `.claude/` → confirm the project is created with `topology: "multi-repo-workspace"` (check DB or API response).
- [x] 16.2 Attach a second project (a single repo). Switch between them via the sidebar switcher. Confirm the Dashboard's Recent runs panel changes content on switch — no rows from the other project appear.
- [x] 16.3 Start a feature run in project A. Switch to project B mid-run. Confirm no active-run banner is visible on B's Dashboard.
- [x] 16.4 Switch back to A. Confirm the banner reappears.
- [x] 16.5 Run the dev server against a DB created by the prior version (with `workspaces` + `projects` tables seeded). Confirm migration runs cleanly and existing data is visible under the new shape.

## 17. Cleanup

- [x] 17.1 Search the codebase for any remaining references to `workspace-registry` (the old capability name in code comments / docstrings) and update to `project-registry`.
- [x] 17.2 If `openspec/specs/workspace-registry/` is to be renamed `openspec/specs/project-registry/` post-archive, coordinate the file move at archive time (the archive command may or may not handle this — verify).
- [x] 17.3 Delete any unused imports flagged by the IDE or by `npm run typecheck`.
