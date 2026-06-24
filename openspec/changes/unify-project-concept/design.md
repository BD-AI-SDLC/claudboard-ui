## Context

The current data model treats `workspace` and `project` as two distinct top-level concepts, joined by a foreign key. In practice, every monolith creates a 1:1 pair (one workspace row, one project row at the same path), and only multi-repo workspaces use the parent/child relationship. The UI then exposes both concepts as user-pickable entities — `WorkspaceSwitcher` in the sidebar and `ProjectPicker` in the top-bar — without explaining how they differ.

The `workspaces-overhaul` change (just shipped, commits `df1b544` and `e21e4d8`) added topology-adaptive Overview shapes (`OverviewMono`, `OverviewMulti`, `OverviewMonoz`) keyed off `workspace.topology`, plus a manual topology picker in the Import flow. The picker is broken — `ImportView.tsx:35-40` hardcodes `'monolith'` on the folder-pick path — but more importantly, classifying topology is something the system can do silently and never has to ask about. The three-shape UI is also more variation than the underlying data justifies, since the differences between shapes are mostly cosmetic (a "Services" table vs a "Modules" table vs neither).

Two contamination bugs are visible right now:
1. `GET /api/projects` returns every active project across every workspace. The Dashboard's Services list shows projects from inactive workspaces as if they belonged to the active one.
2. `GET /api/runs` similarly has no workspace filter.

This change collapses the conceptual sprawl: one top-level abstraction (renamed `project`), one Overview shape, one picker. The per-git-repo concept survives as `repo` for Kickoff targeting but is never surfaced as a top-level navigation target.

This is a local-only developer tool — no external API consumers, no production deployment to coordinate, no parallel-version compatibility to maintain.

## Goals / Non-Goals

**Goals:**

- One top-level user-facing concept. The user picks a project, sees its runs, done.
- Auto-classify topology silently. Never ask the user.
- Fix the multi-repo detection bug (drop `.claude` requirement).
- Eliminate cross-project data leakage on the Overview.
- Reduce UI surface area: one Overview component instead of three, one picker instead of two.

**Non-Goals:**

- Merging `ProjectView` (the project health page) with the Overview. They overlap but they have different purposes today and unifying them is its own design problem.
- Removing the `topology` DB column or the classifier. Both still exist — the classifier informs internal modeling (how many `repo` rows to create) and topology persists so future changes can re-introduce adaptive shapes if needed.
- Multi-repo Kickoff repo-targeting UX. The existing flow (`screen-kickoff`) already lets the user pick a sub-repo; it works.
- Backwards-compatible API shims. This is a local tool; old endpoints can disappear.

## Decisions

### Decision 1 — Rename strategy: create new tables, copy rows, drop old

Use additive create-and-copy rather than SQLite's `ALTER TABLE ... RENAME TO` for the table rename. Reason: the project's migration convention (per `server-conventions.md`) is additive guards based on `PRAGMA table_info`. Renames don't fit that pattern, and the rename also needs to rename a foreign key column (`workspace_id` → `project_id`) which `ALTER TABLE RENAME COLUMN` does support in modern SQLite — but doing two coupled renames across two tables in a single shot is fragile. The create-copy-drop pattern keeps each step verifiable and rollback-friendly.

Migration steps inside `runMigrations()`:
1. If `projects_new` doesn't exist, create it (the new shape: was `workspaces`).
2. If `repos` doesn't exist, create it (the new shape of old `projects`, with `project_id` FK).
3. Copy rows: `INSERT INTO projects_new SELECT ... FROM workspaces`, `INSERT INTO repos SELECT id, workspace_id AS project_id, ... FROM projects`.
4. Drop `workspaces` and old `projects`.
5. Rename `projects_new` → `projects` via `ALTER TABLE RENAME`.
6. Rename `active_workspace_id` key in `kv_settings` → `active_project_id`.

Alternatives considered:
- **In-place `ALTER TABLE RENAME` of both tables:** simpler in principle, but the old `projects` table must be renamed *out of the way* before `workspaces` can become `projects`. Three-step rename: `workspaces` → `_tmp`, `projects` → `repos`, `_tmp` → `projects`. Equally many steps, harder to read, and no guarded rollback if a step fails partway.
- **View-based shim (keep old names as views over new tables):** unnecessary complication for a local tool with no external consumers.

### Decision 2 — Pure-FS classifier for multi-repo

Replace `classifier.ts:18`:

```
// before
if (!scan.gitRoot && scan.hasClaude && scan.childRepos.length >= 2) → multi-repo

// after
if (!scan.gitRoot && scan.childRepos.length >= 2) → multi-repo
```

Reason: the user's bug. When you attach a fresh multi-repo folder, `.claude/` doesn't exist yet (bosch-sdlc hasn't claimed it). The current rule requires that marker, so the classifier falls through to Case 3 — list children as monoliths — which silently creates the wrong shape. Removing the `.claude` requirement makes detection match user intuition ("this folder contains N repos, obviously it's a multi-repo").

Alternatives considered:
- **Keep `.claude` requirement, fall back to single-view UI for unclassified cases:** the user's bug would still happen — we'd persist the wrong topology, and Kickoff would only see one phantom monolith repo. The UI collapse doesn't fix the model.
- **Heuristic confidence score:** over-engineered for a binary detection.

Risk: a user might point bosch-sdlc at `~/dev/` (their entire dev folder, containing 30 unrelated repos) and have it classify as a multi-repo. Mitigation: the existing scanner caps `childRepos` traversal at one level deep and the user is making an explicit choice when they pick the folder. If they pick `~/dev/`, it's reasonable for the tool to treat it as such. (Future change can add a sanity warning if children > N.)

### Decision 3 — One Overview body for all topologies

Delete `OverviewMono.tsx`, `OverviewMulti.tsx`, `OverviewMonoz.tsx`. Replace with one component (likely inlined into `Dashboard.tsx` since it's now small enough): KPI strip + full-width Recent runs.

Reason: the user feedback was explicit — the "Services / Modules" tables added noise without information. The KPI strip and Recent runs work identically across all topologies. Per-repo detail is reachable via `ProjectView` (the health page) and the Switcher's metadata; it doesn't need to live on the Overview too.

Alternatives considered:
- **Keep adaptive shapes but auto-pick the topology:** preserves more existing code but contradicts the user's "the same view for all" preference and keeps three components in sync that don't need to exist.
- **Show repos as a subtle metadata strip (not a table):** still gives the user something they said they don't want to see.

### Decision 4 — Sole picker is the sidebar `ProjectSwitcher`

Delete `components/Picker/ProjectPicker.tsx` (the top-bar Picker). All project-switching goes through the sidebar dropdown. Reason: two pickers showing different things was the proximate cause of the cross-workspace bug — the top-bar Picker happily showed repos from every workspace because it consumed the unscoped `/api/projects` response. With one picker scoped to one concept, the confusion can't recur.

### Decision 5 — Scope per-project data by `?projectId=` query param

Both `GET /api/repos` and `GET /api/runs` accept a required `projectId` query param. The server returns 400 if missing (no implicit "all" — that was the bug). `App.tsx` derives `activeProjectId` from `activeProject?.id` and passes it into every fetch. Project switch triggers refetch via an effect keyed on `activeProjectId`.

Alternatives considered:
- **Pass via path (`/api/projects/:id/repos`):** RESTful but doesn't compose well with the existing flat route layout.
- **Implicit "active project" on the server:** the server is stateless about UI selection; making it stateful invents a session concept that doesn't exist today.

### Decision 6 — Active-run banner scoped to its project

The banner reads from the same `/api/runs?projectId=` feed. When you switch projects, the banner refetches against the new project's runs and shows nothing if none are active. The paused run on the previous project keeps its server-side state — it just isn't surfaced until you switch back. This was the user's explicit decision ("active run is paused, and you are in another workspace").

## Risks / Trade-offs

- **[Wide rename ripple]** → The rename touches protocol types, DB schema, every server route, the API client, every UI component that imports the old names, every test mock. Mitigation: do the rename in one mechanical pass with `grep`/`sed`, verify with `npm run typecheck` and `npm run test` before moving to behaviour changes. Type system will catch most call-site issues immediately.
- **[Existing DB rows]** → Users with already-attached workspaces will have rows in `workspaces` and `projects`. The migration must copy them faithfully (preserve IDs, timestamps, mark, status). Mitigation: copy preserves all columns; add an integration test that creates a workspace+project on the old schema, runs the migration, and asserts the new shape has identical rows.
- **[Lost UI fidelity for multi-repo users]** → Multi-repo users who liked seeing their services list will lose it. Mitigation: this matches the explicit user preference for this change. `ProjectView` (sub-repo detail) is still reachable through other paths.
- **[Classifier change misclassifies new folders]** → A user pointing at a parent dir of unrelated repos (e.g. `~/dev/`) will get a multi-repo project. Mitigation: explicit user action — they picked the folder. Future change can warn at high child counts. The misclassification is reversible (detach + re-attach the correct folder).
- **[Breaking API change with no deprecation window]** → Acceptable because this is a local-only tool with no external consumers. There is no risk of breaking a downstream client.

## Migration Plan

1. **Protocol first** — rename `Workspace` → `Project` and `Project` → `Repo` in `protocol/src/`. Build protocol. Type errors cascade to server and ui as expected.
2. **Server schema + routes** — write the migration in `db.ts`. Rename route handlers, API paths, body field names. Drop `body.topology` handling in attach. Add `?projectId=` filter to `/api/repos` and `/api/runs`. Make the classifier change.
3. **API client** — rename methods in `ui/src/api/client.ts`. Add `projectId` arg to the scoped methods.
4. **UI components** — rename `WorkspaceSwitcher` → `ProjectSwitcher`. Delete the three Overview shapes and the top-bar `ProjectPicker`. Replace `Dashboard.tsx`'s `renderBody()` with the single Overview body. Drop the topology step from `ImportView.tsx`. Wire `activeProjectId` through `App.tsx`.
5. **Tests** — update mocks and assertions. Add a migration round-trip test. Add a scoping test that verifies `/api/repos?projectId=X` returns only X's repos.
6. **Manual verification** — fresh install (empty DB) walks Import → auto-classified project → Overview. Second project attached, switch between them, confirm no cross-contamination. Existing install with seeded multi-repo `meas` data survives migration.

Rollback: if the migration fails partway, the DB is in an inconsistent state (new tables created, old tables not yet dropped). Mitigation: wrap the migration steps in a single `db.transaction()` so partial failure rolls back atomically.

## Open Questions

- None. Design decisions are settled by user feedback in the proposal conversation.
