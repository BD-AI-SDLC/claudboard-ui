## Context

The `feature-workflow-web-app` change established a 3-topology registry (`monolith` / `monorepo` / `multi-repo-workspace`) with a `(target, scope?, workspaceRoot?)` normalization. In practice the two extra fields are vestigial:

- `workspaceRoot` is plumbed end-to-end (`CreateRunRequest.workspaceRoot` → `runFeature(..., _workspaceRoot)`) but never read. The leading underscore on the driver parameter is the smoking gun. The design note `feature-workflow-web-app/design.md#D3` calls out "the workflow itself reads from `workspaceRoot/.claude/`" — but the SDK uses `cwd: target`, so nothing in the harness loads two `.claude/` directories. Whatever the skill does, it does on its own and isn't observable from this codebase.
- `scope` exists only as a prompt-prefix: `/start-feature [scope: packages/billing] ...`. The explore session traced every reader; nothing in this codebase reads `runs.scope` back beyond display. Whether the downstream skill honors the hint is unverified.

Simultaneously, the multi-repo-workspace topology is recorded as N projects per workspace (one per child `.git` directory), each carrying `workspaceRoot = <parent>`. The user's actual mental model is the inverse: the workspace is one project, and the agent picks which child repos to touch based on the prompt.

This change unifies all three topologies on a single principle: **one attached path = one Project = one runnable unit; `cwd = Project.path`; the agent decides scope.**

## Goals / Non-Goals

**Goals:**

- Multi-repo workspace produces one Project at the workspace root, not N at children.
- Kickoff is prompt-only regardless of topology — no scope picker, no scope field on the request.
- `cwd` at run time always equals `Project.path`; no inheritance dance.
- The `topology` enum survives as a display label, but no runtime code branches on it.
- DB and protocol shrink: drop `projects.scopes`, `projects.workspace_root`, `runs.scope`, `runs.workspace_root`.
- Net code change is subtractive — fewer branches, fewer fields, fewer specs.

**Non-Goals:**

- Reworking the `Workspace` DB table (parked open thread from the explore session).
- Per-feature audit of which child repo was touched (post-hoc derivation from agent activity is deferred; not implemented here).
- Migration of existing DB rows from the old per-child model (no production installations; dev users delete `state.db`).
- Defensive detection of the `workspace-meta/` directory cloned by `claudboard-workspace-link` — the skill is trusted to skip it (Q2 answered `b`).
- Changing the downstream `feature-workflow` skill's behavior. The skill keeps running as it does today; this change only stops trying to pre-declare scope to it.
- Persisting "last selected target" across sessions or any new project-grouping feature.

## Decisions

### 1. Classifier collapses multi-repo to a single root Project

The classifier today (`server/src/registry/classifier.ts:19-32`) iterates `scan.childRepos` and emits one `ClassifiedRepo` per child. The new rule:

```
if (!scan.gitRoot && scan.hasClaude && scan.childRepos.length >= 2) {
  return {
    root: rootDir,
    repos: [{
      path: rootDir,
      topology: 'multi-repo-workspace',
      scopes: [],          // field will be removed entirely in step 4 below
      workspaceRoot: null, // ditto
    }],
  }
}
```

The detection signal (≥ 2 child git repos under a non-git, `.claude`-bearing parent) is unchanged — that still identifies a workspace. What changes is the emission: one Project for the parent, none for the children.

**Alternative considered:** keep both — N child Projects plus a parent "workspace" Project. Rejected because it gives the user two ways to start a feature (pick a repo vs pick the workspace) with the same observable result, and the explore session was explicit that only the workspace should be runnable.

### 2. Drop scope from the entire stack

The strongest argument for scope was cost: avoid the agent crawling `packages/*` to find the target. The explore session noted that this argument applies symmetrically to the multi-repo workspace case, where we already accept agent-decides; keeping scope only for monorepo would be inconsistent. Audit ("which packages did this feature touch?") was the second-strongest argument; the cleaner answer is to derive it from agent activity post-hoc — out of scope here but cheaper to add later than to remove a user-facing picker.

Deletions:

- `Project.scopes: string[]` — field removed from `ClassifiedRepo` and `Project`.
- `Run.scope: string | null` — field removed.
- `CreateRunRequest.scope?` — field removed.
- `getMonorepoScopes()` — function deleted.
- `buildPrompt()` — collapses to `return \`/start-feature ${userPrompt}\``.
- `Kickoff.tsx` — scope `<select>` and `isMonorepo` branch deleted; the form is one `<textarea>` and a submit button.
- DB columns `projects.scopes` and `runs.scope` — dropped.

**Alternative considered:** keep `scope` as an optional power-user input ("if you know, tell us"). Rejected — same inconsistency, plus it's a code path nobody will keep tested.

### 3. Drop the unread `workspaceRoot` plumbing

`workspaceRoot` is removed wherever it appears in code, types, and DB. The classifier no longer sets it; the run driver no longer accepts it; the persist layer no longer writes it. Spec note D3 from the previous change ("the workflow itself reads from `workspaceRoot/.claude/`") is now moot — the workflow runs with `cwd = workspace root` directly, so any `.claude/` reads it does naturally resolve against the right tree.

**Alternative considered:** keep `workspaceRoot` for diagnostic/display ("this Project was scanned under …"). Rejected — the `Workspace` table already carries that information via `Project.workspaceId → Workspace.root`. No second field needed.

### 4. `Topology` survives as a label, not a behavior switch

Every runtime branch on `topology` is eliminated:

- `buildPrompt`'s `if (topology === 'monorepo' && scope)` branch is deleted.
- `registry/routes.ts:33`'s `topology === 'monorepo' ? getMonorepoScopes(...) : []` branch is deleted.
- The driver never branched on topology.

What remains: the classifier still emits one of three values, the field is still in `Project`, the UI may still render it as a badge ("Monorepo" / "Workspace" / "Monolith"). It's purely informational.

**Alternative considered:** collapse to two values (`single-repo` / `workspace`) or remove entirely. Rejected — the three values carry useful display information at zero behavioral cost.

### 5. DB schema: drop columns, no migration

`projects.scopes`, `projects.workspace_root`, `runs.scope`, `runs.workspace_root` are all removed from the schema in `server/src/db.ts`. SQLite supports `ALTER TABLE DROP COLUMN` (since 3.35), but for this dev-only, pre-1.0 app the simpler path is to bump the schema and document "delete `~/.bosch-sdlc/state.db` on upgrade" in the change notes. The integration test schema (`server/src/__tests__/integration.test.ts:67,90`) is updated in lockstep.

**Alternative considered:** keep the columns NULL'd out for backward compat. Rejected — there is no production data to be compatible with, and dead columns rot.

### 6. REST payloads: silent ignore vs strict reject for old fields

`POST /api/runs` previously accepted `scope` and `workspaceRoot`. After this change those fields are ignored if present (not 400'd). Reason: a dev still has an old UI bundle cached in their browser when they restart the server. Silently dropping the fields keeps that case working; the run just runs without the prefix. The spec scenario documents this contract.

**Alternative considered:** return 400 on any unknown field. Rejected for the cache-friction reason above; strict rejection can be reinstated post-1.0.

### 7. Prereqs: one row per workspace

`upsertPrereqs(projectId, ...)` is unchanged in shape — what changes is that the multi-repo case calls it once (for the workspace's Project) instead of N times. `server/src/registry/prereqs.ts`'s detection logic reads files relative to `project.path`; with the new classifier that path is the workspace root, which is exactly where the meta-repo `.claude/` lives (via the symlink). So no changes to detection logic are needed — only the call site in `registry/routes.ts` collapses naturally because there is one Project to upsert prereqs for.

## Risks / Trade-offs

- **Risk:** A multi-repo team might genuinely want per-child-repo prereq tracking ("we still haven't run `/analyse` on `repo-7`"). → Mitigation: deferred. The workspace-level prereq tracks the workspace's own `.claude/`; if per-child analysis ever becomes a need, it's an additive enhancement, not blocked by this change.
- **Risk:** Dropping `workspaceRoot` removes the (currently unused) hook the skill *could* have read to resolve shared config. → Mitigation: with `cwd = workspace root`, the skill's `.claude/` lookups land in the right place by default; no second path needed.
- **Risk:** Breaking DB schema with no migration will confuse anyone running an existing dev install. → Mitigation: change notes explicitly say "delete `~/.bosch-sdlc/state.db`"; the app is pre-1.0 and local-only, and the registry rebuilds in seconds.
- **Risk:** Users who liked the explicit monorepo scope picker lose a UI affordance and might phrase prompts less precisely. → Mitigation: nothing prevents them from typing "in packages/billing, add invoice PDF" in the prompt; the agent reads the same hint either way.
- **Trade-off:** `topology` field stays in the protocol even though no code branches on it. Mild dead-weight, paid for by useful UI labelling. Worth it.
- **Trade-off:** `Workspace` table stays as-is even though every Project now corresponds 1:1 to a Workspace row. Mild redundancy, parked per the explore session's open thread.

## Migration Plan

This is a dev-only, local-only, pre-1.0 application; "migration" is one line of operator instruction.

1. Ship the change.
2. CHANGELOG / change notes: "Delete `~/.bosch-sdlc/state.db` before starting the new server. Re-attach your workspaces via the Dashboard."
3. The first server start after upgrade creates a fresh DB with the new schema.
4. Re-attaching a multi-repo workspace creates one Project at the root (where the old DB had N children).

No rollback strategy needed beyond "checkout the previous tag and restore the deleted DB from your trash" — acceptable for the project's current maturity.

## Open Questions

None resolved during writing. Both explore-session questions were closed:

- Q1 (drop scope?): **yes**, drop it.
- Q2 (meta-repo detection?): **no**, trust the skill.

Open thread (parked, not blocking this change): whether `Workspace` should collapse into `Project` or be repurposed as a user-facing grouping label.
