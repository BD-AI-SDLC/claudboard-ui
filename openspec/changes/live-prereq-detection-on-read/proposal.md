## Why

After running an `analyse`, `generate`, or `claudboard-workflow` skill from the Project screen's ClaudboardLauncher, the page keeps reporting prereqs as `Stale` even though the artifact files were freshly written and the run completed successfully. The server returns a stale `prereqs` table snapshot because only one of the two prereq run paths (`POST /api/prereqs/:cmd`) re-detects freshness on completion; the path the dashboard actually uses for claudboard skills (`POST /api/claudboard/run` → `claudboard/launcher.ts`) writes nothing back to the `prereqs` table. The UI already refetches correctly after a run completes — the bug is purely server-side, and the cache-and-invalidate pattern keeps regressing because every new run entry point has to remember to call `detectPrereqs` + `upsertPrereqs`.

## What Changes

- `GET /api/repos/:id/prereqs` (`server/src/registry/routes.ts`) invokes `detectPrereqs(repo.path)` on every read and returns the live `state`, `output`, and `staleReason` derived from the filesystem. It joins those with the cached `lastRun`, `duration`, and `cost` columns read from the `prereqs` table so the response shape is unchanged.
- The `prereqs` table columns `state`, `output`, `stale_reason` become a write-only cache that no read path consumes. Columns and the initial `upsertPrereqs` seed on `POST /projects` stay (so rows exist for `markPrereqRan` to update); no migration is required.
- `claudboard/launcher.ts` adds a finalizer to `runFeature(...)` that, on success, calls `markPrereqRan(repoId, cmd, completedAt, durationMs)` — mapping skill `analyse` → cmd `analyse`, `generate` → `generate`, `workflow` → `claudboard-workflow` — so cached run metadata stays accurate.
- `prereq/routes.ts` drops the now-unused `upsertPrereqs(repo.id, detections)` call after the CLI exits. The `markPrereqRan` call in the same finalizer stays.
- No protocol changes. No DB migration. No UI changes — `Project.tsx`'s existing refetch-on-completion already gets the right answer once the server returns live data.

## Capabilities

### New Capabilities
<!-- None -->

### Modified Capabilities

- `prereq-runner`: replace the requirement that each run finalizer re-detects and persists freshness; freshness now derives on read from the filesystem, and run finalizers only persist cached run metadata (`lastRun`, `duration`).
- `workspace-registry`: prereq detection requirement is unchanged in behavior; clarify that detection is invoked from the GET handler at read time rather than being cached as the source of truth in the `prereqs` table.

## Impact

- `server/src/registry/routes.ts`: rewrite `GET /repos/:id/prereqs` handler — fetch repo path, call `detectPrereqs`, join with cached run metadata from the `prereqs` row.
- `server/src/claudboard/launcher.ts`: attach a `.then(...)` to `runFeature(...)` that maps skill → cmd and calls `markPrereqRan` with the run's completion timestamp and duration. Match the success-only guard pattern already in `prereq/routes.ts:78`.
- `server/src/prereq/routes.ts`: remove the `upsertPrereqs(repo.id, detections)` line; `markPrereqRan` stays.
- New tests: `server/src/registry/__tests__/prereqs-route.test.ts` (or extend an existing one) — verifies the GET returns `state: 'done'` immediately after a fresh artifact is written, without any explicit upsert. `server/src/claudboard/__tests__/launcher.test.ts` (or extend) — verifies a successful claudboard run writes `lastRun` and `duration`.
- No `protocol/` changes (`PrereqRecord` shape stays the same).
- No `ui/` changes.
- No database migration.
