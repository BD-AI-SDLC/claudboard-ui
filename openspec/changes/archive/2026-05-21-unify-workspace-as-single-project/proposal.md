## Why

The current registry splits a multi-repo workspace (one parent directory with a meta-repo `.claude/` and N child git repos — the pattern produced by `claudboard-workspace-init` / `claudboard-workspace-link`) into N separate Project entries, one per child repo. A run kicked off from any of those entries uses the child repo as `cwd`, never the workspace root, and the `workspaceRoot` field that was supposed to bridge them is plumbed through the run driver but never consumed (`server/src/run/driver.ts:44` — `_workspaceRoot`).

That model is wrong for how teams actually use these workspaces: a single project lives in the parent directory, the shared `feature-workflow` skill is in the parent's `.claude/`, and a single feature may touch zero, one, or several of the child repos — a decision the agent should make based on context the user can't easily pre-declare. The same principle ("agent decides scope, not the human") makes the monorepo scope picker (`buildPrompt` at `server/src/run/prompt-builder.ts:6`) inconsistent with this model — its only mechanical effect today is prepending `[scope: <path>]` to the prompt, and nothing in this codebase or its specs proves that hint changes downstream behavior in a way the agent couldn't infer from the prompt itself.

## What Changes

- **Multi-repo workspaces become a single Project at the workspace root.** The classifier emits one `ClassifiedRepo` for the root (path = workspace root, topology = `multi-repo-workspace`), not N for the children. Runs execute with `cwd = workspace root`; the agent picks which child repo(s) to touch based on the prompt and the skill's logic.
- **Drop the monorepo scope picker.** The Kickoff form becomes prompt-only for every topology. The `scope` field is removed from `CreateRunRequest`, `Run`, the prompt builder, the `Project` shape, and the database schema.
- **Drop the dead `workspaceRoot` plumbing.** `workspaceRoot` on `Project`, `Run`, and `CreateRunRequest` is removed; the field was advisory and unread. The `workspace_root` DB column is dropped.
- **`Topology` becomes a display label only.** All three values still exist (`monolith` / `monorepo` / `multi-repo-workspace`) and the classifier still distinguishes them, but no runtime code branches on the value. Each Project, regardless of topology, is one runnable unit with `cwd = Project.path`.
- **Prereqs run once per workspace, not once per child repo.** Because the workspace is a single Project, prereq detection (`/analyse`, `/generate`, `/claudboard-workflow`, `/refresh`, `/techdebt`) targets the workspace root's `.claude/`.
- **Meta-repo trust.** The `workspace-meta/` child directory cloned by `/claudboard-workspace-link` is not specially excluded by the classifier or the agent harness — the skill is trusted to skip it. (Open Question Q2 was answered `b`.)
- **No migration.** Existing rows in `~/.bosch-sdlc/state.db` from the old per-child-repo model are not migrated. Users delete the DB or detach and re-attach.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workspace-registry`: Multi-repo workspace classification produces one Project at the root, not N at children. `scopes` field removed from Project shape. `workspaceRoot` field removed from Project shape.
- `run-driver`: Initial prompt is always `/start-feature <user-prompt>` with no `[scope: ...]` prefix. `CreateRunRequest` drops `scope` and `workspaceRoot`. `Run` shape drops `scope` and `workspaceRoot`. `cwd` is always the Project's path.
- `web-ui`: Kickoff screen drops the scope picker; Kickoff form is prompt-only for every topology. Project cards render identically regardless of topology (topology becomes a badge, not a behavior trigger).

## Impact

- **Code deleted (subtraction-heavy change).**
  - `server/src/registry/classifier.ts:19-32` — multi-repo branch rewritten to emit one repo at root
  - `server/src/registry/scanner.ts:48-63` — `getMonorepoScopes()` deleted
  - `server/src/registry/routes.ts:33` — `getMonorepoScopes` call deleted
  - `server/src/registry/persist.ts` — `scopes`, `workspace_root` columns no longer written
  - `server/src/run/prompt-builder.ts:1-10` — `buildPrompt` simplifies to one branch
  - `server/src/run/{routes,record,driver}.ts` — `scope` and `workspaceRoot` parameters removed
  - `protocol/src/types.ts` — `Project.scopes`, `Project.workspaceRoot`, `Run.scope`, `Run.workspaceRoot`, `CreateRunRequest.scope`, `CreateRunRequest.workspaceRoot` removed
  - `ui/src/components/Kickoff/Kickoff.tsx` — scope picker UI + `isMonorepo` branch removed
- **DB schema change (breaking, no migration).**
  - `projects.scopes` column dropped
  - `projects.workspace_root` column dropped
  - `runs.scope` column dropped
  - `runs.workspace_root` column dropped
  - `~/.bosch-sdlc/state.db` must be deleted on upgrade (acceptable in dev; this app is pre-1.0 and local-only).
- **REST API change (breaking).**
  - `POST /api/runs` request body no longer accepts `scope` or `workspaceRoot`. Sending them is silently ignored (forward-compatible enough for dev clients; documented in the run-driver spec).
  - `GET /api/projects` response no longer includes `scopes` or `workspaceRoot`.
  - `GET /api/runs` response no longer includes `scope` or `workspaceRoot`.
- **Spec rewrites.**
  - `workspace-registry`: the "Parent directory with meta-repo .claude" scenario is inverted; the monorepo scenario drops scope enumeration.
  - `run-driver`: the "Kickoff against a monorepo scope" scenario is removed; the "Kickoff against a multi-repo workspace member" scenario is rewritten to target the workspace root.
  - `web-ui`: the Kickoff screen description drops the scope picker.
- **No new runtime dependencies. No new endpoints. No UI bundle growth** (net shrinkage).
- **Workspace DB table left as-is** (Open Thread from explore session — parked, not removed).
- **Downstream skill assumption unchanged.** The generated `feature-workflow` skill in the workspace root continues to work as-is; this change only stops trying to pre-select scope on the skill's behalf.
- **Out of scope.** Per-feature audit of "which child repo was touched" (could be derived post-hoc from agent activity if needed — explicitly deferred). Migration of existing per-child-repo Projects in production-style installations (no such installations exist).
