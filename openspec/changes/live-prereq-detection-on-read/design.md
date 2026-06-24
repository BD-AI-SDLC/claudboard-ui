## Context

The dashboard exposes prereq state for the Project screen via `GET /api/repos/:id/prereqs`. The handler today reads straight from the `prereqs` table (`server/src/registry/routes.ts:207-215`). That table is supposed to be kept in sync by run finalizers calling `detectPrereqs` + `upsertPrereqs` after a successful run.

There are two run entry points and they finalize differently:

1. `POST /api/prereqs/:cmd` (`server/src/prereq/routes.ts:24`) — used by `refresh` and `techdebt` buttons and by legacy callers. On subprocess exit it calls `detectPrereqs(target)` + `upsertPrereqs(repo.id, detections)` + `markPrereqRan(...)`. Freshness stays correct.
2. `POST /api/claudboard/run` (`server/src/claudboard/routes.ts:15` → `server/src/claudboard/launcher.ts:16`) — the path the ClaudboardLauncher modal uses for `analyse`, `generate`, `workflow`. It calls `runFeature(...)` and **does not write back to the `prereqs` table at all**. No `detectPrereqs`, no `upsertPrereqs`, no `markPrereqRan`.

Result: a fresh analyse run leaves the `prereqs.state` column at `stale`. The UI's `Project.tsx:77-82` correctly refetches after `hasActive` flips false, but the server still returns the stale snapshot.

The cache-and-invalidate pattern keeps regressing because every new run path has to remember to call `detectPrereqs` + `upsertPrereqs`. The cached `state` column has no consumer outside of the GET — losing it costs nothing.

## Goals / Non-Goals

**Goals:**
- Fix the user-visible bug: after a successful claudboard run, the Project screen reflects fresh state on the next read.
- Remove the entire "remember to invalidate the cache after every kind of write" failure mode by making the GET handler the place that derives freshness.
- Keep the cached run metadata (`lastRun`, `duration`, `cost`) accurate and unified across both run paths.
- Keep the response payload of `GET /api/repos/:id/prereqs` byte-identical (same `PrereqRecord` shape).

**Non-Goals:**
- Change the freshness heuristic itself (`hasGitActivitySince`, 7-day age-out) — that work is bounded by `server/src/registry/prereqs.ts` and is unaffected.
- Move cached run metadata to a separate table or refactor `prereqs` schema.
- Drop the `prereqs.state` / `prereqs.output` / `prereqs.stale_reason` columns or write a migration. They become write-only dead weight; cleanup is left for a future change.
- Touch any UI code. `Project.tsx` already does the right thing once the server returns live data.

## Decisions

### Decision 1 — Live detection in `GET /repos/:id/prereqs`

The handler will:

1. Look up the repo (`SELECT id, path FROM repos WHERE id = ?`). 404 if missing.
2. Call `detectPrereqs(repo.path)` to get the live `PrereqDetection[]` (5 entries: analyse, generate, claudboard-workflow, refresh, techdebt).
3. Load cached run metadata in one query: `SELECT cmd, last_run, duration_ms, cost_cents FROM prereqs WHERE project_id = ?`. Index by `cmd`.
4. For each detection, build the response `PrereqRecord` from the live detection fields plus the cached run metadata (`lastRun`, `duration`, `cost`). If no cached row exists for that cmd (first run on a freshly-attached repo), fall back to `null` for all three metadata fields and synthesize a UUID for `id` — the consumer (`Project.tsx`) keys by `cmd`, never by `id`, so synthesized ids are fine.

**Why not cache and invalidate (Option A — mirror the existing pattern):**
- Every new run path forever has to remember the invalidator. We just shipped one (`claudboard-runner`) that forgot, and it took weeks to surface.
- The cache had no consumer that benefited from being cached — the GET is hit once per Project screen mount + every 2s while the page is open, never in bulk. The cost of `detectPrereqs` is small (5 `stat()` calls + 2 `git log --since=...` invocations per call, both bounded).
- Removing a category of bug is worth a small constant-factor cost.

**Why not push freshness into the run driver (Option C):**
- Couples `run/driver.ts` to `registry/prereqs.ts`. The driver shouldn't know about prereq freshness.
- Still leaves the GET reading from a cache that something else has to maintain.

### Decision 2 — Run finalizers persist only run metadata

Both `prereq/routes.ts` (existing) and `claudboard/launcher.ts` (new) call `markPrereqRan(repoId, cmd, completedAtIso, durationMs)` after a successful run. Neither calls `upsertPrereqs` from the run finalizer anymore.

- The existing `upsertPrereqs(repo.id, detections)` line in `prereq/routes.ts:73` is **removed** in this change. Its only effect was to update columns that no read path will consume after this change ships.
- The initial seed `upsertPrereqs(repoId, prereqs)` in `registry/routes.ts:169` (inside `POST /projects`) stays. It ensures a row exists per `(project_id, cmd)` so `markPrereqRan`'s `UPDATE` has something to hit. The values written are stale-by-design and ignored by the new GET.

### Decision 3 — Cmd mapping for claudboard skill → prereq cmd

`claudboard/launcher.ts` receives `request.skill` ∈ `{ analyse, generate, workflow }`. The `prereqs.cmd` column uses `analyse`, `generate`, `claudboard-workflow`. The finalizer maps:

```ts
const cmdBySkill = { analyse: 'analyse', generate: 'generate', workflow: 'claudboard-workflow' } as const
```

The mapping is defined inline next to the call site (one occurrence; not worth extracting). The same constraint already lives implicitly in `server/src/claudboard/skill-discovery.ts` — keep the two in sync by colocating with the finalizer rather than introducing a shared module.

### Decision 4 — Completion timestamp and duration sourcing

The existing pattern in `prereq/routes.ts:78-97` reads `created_at` + `completed_at` from the `runs` row to compute `durationMs`. Mirror that exactly in `claudboard/launcher.ts`:

```ts
runFeature(record.id, target, prompt)
  .then(() => {
    const post = db.prepare('SELECT status, created_at, completed_at FROM runs WHERE id = ?').get(record.id) as ...
    if (post?.status !== 'done' || !post.completed_at) return
    const startedMs = Date.parse(post.created_at + 'Z')
    const completedMs = Date.parse(post.completed_at + 'Z')
    const durationMs = Number.isFinite(startedMs) && Number.isFinite(completedMs) ? completedMs - startedMs : null
    markPrereqRan(repoId, cmdBySkill[request.skill], new Date(completedMs).toISOString(), durationMs)
  })
  .catch((err: Error) => console.error(`Claudboard run ${record.id} failed:`, err.message))
```

The existing `.catch` for error logging is preserved.

## Risks / Trade-offs

- **[Risk: GET is now slower per call]** → Mitigation: `detectPrereqs` runs ~7 `fs.stat` calls and up to 2 `git log --since="..."` invocations. Each `git log --since` against a small commit window is sub-100ms on a warm repo. The Project screen polls once per visit, not in a loop. If profiling later shows hot-path latency, add a request-scoped memoization without re-introducing the persistent cache.
- **[Risk: `git log --since` boundary]** → No change in this work — same call is happening today inside `upsertPrereqs`-feeding `detectPrereqs`. Moving where it's called doesn't change its semantics. Out-of-scope follow-up.
- **[Risk: claudboard finalizer races with the response]** → `launchClaudboardRun` already returns 201 synchronously and runs `runFeature(...)` in the background (today). Adding a chained `.then(markPrereqRan)` does not change the response timing. The UI does not block on `markPrereqRan` — it polls `getRuns` for status and re-fetches prereqs once `hasActive` flips.
- **[Trade-off: dead columns in `prereqs`]** → `state`, `output`, `stale_reason` keep getting written by the seed but never read. Acceptable: dropping them needs a migration and a separate change; the columns are harmless. A follow-up cleanup change can remove them once this is in production.
- **[Risk: tests that asserted on `prereqs.state` directly]** → Search the server test suite for direct selects against `prereqs.state` or assertions on the upserted state value. Migrate any to assert on the GET response instead. If none exist, no change.

## Migration Plan

No data migration. No backfill. Behavioral change only:

1. Ship the change.
2. On first page load after deploy, the GET starts returning live state. No client cache to bust (the UI does not cache `prereqs` across mounts).
3. Rollback: revert the three server files. The dead columns in `prereqs` remain populated with the old `upsert`-style values; the reverted GET reads them again. No data loss either way.

## Open Questions

- Should the GET `404` if the repo row is missing, or return an empty map? Existing behavior is to `200` with an empty map (it never checks repo existence). Keep current behavior — surfacing a 404 here is a separate UX question.
- Do we want to extend `markPrereqRan` to also stamp `cost_cents` when the Agent SDK exposes per-run cost on the `runs` row? Not in scope; flag for a future change if/when cost is wired.
