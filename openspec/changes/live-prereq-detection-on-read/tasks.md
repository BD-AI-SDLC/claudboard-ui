## 1. Server: live detection in `GET /repos/:id/prereqs`

- [x] 1.1 In `server/src/registry/routes.ts`, rewrite the `router.get('/repos/:id/prereqs', ...)` handler. Replace the current body that does `SELECT * FROM prereqs WHERE project_id = ?` with: (a) look up the repo via `SELECT id, path FROM repos WHERE id = ?`; return `404 { error: 'Repo not found' }` if missing; (b) call `detectPrereqs(repo.path)` from `./prereqs.js`; (c) load cached run metadata once via `SELECT id, cmd, last_run, duration_ms, cost_cents FROM prereqs WHERE project_id = ?` and index it by `cmd` into a `Map<string, { id, lastRun, duration, cost }>`; (d) for each detection, build a `PrereqRecord` whose `state`, `output`, `staleReason` come from the live detection and whose `id`/`lastRun`/`duration`/`cost` come from the cached map (use `randomUUID()` for `id` when no cached row exists; `null` for the metadata fields).
- [x] 1.2 Update the local `PrereqRow` interface in `routes.ts` if needed so the cached-metadata query has a typed shape (only `id`, `cmd`, `last_run`, `duration_ms`, `cost_cents` are needed for the cache map; drop fields that are no longer consumed).
- [x] 1.3 Add a `repoId` field to the returned `PrereqRecord` matching the existing protocol shape — pull it from `req.params['id']` (already validated by the lookup in 1.1).
- [x] 1.4 Confirm the response remains keyed by `cmd` (object whose keys are `analyse`, `generate`, `claudboard-workflow`, `refresh`, `techdebt`) so `Project.tsx`'s `Record<string, PrereqRecord>` consumer is unchanged. Do not rename any existing field.

## 2. Server: claudboard finalizer writes run metadata

- [x] 2.1 In `server/src/claudboard/launcher.ts`, define a local constant `const cmdBySkill = { analyse: 'analyse', generate: 'generate', workflow: 'claudboard-workflow' } as const`.
- [x] 2.2 Import `getDb` from `../db.js` and `markPrereqRan` from `../registry/persist.js`.
- [x] 2.3 Convert the existing `runFeature(record.id, target, prompt).catch(...)` line into a `.then(...).catch(...)` chain. In the `.then`: query the `runs` row via `SELECT status, created_at, completed_at FROM runs WHERE id = ?`; if `status !== 'done'` or `completed_at` is null, return early; compute `durationMs = Date.parse(completed_at + 'Z') - Date.parse(created_at + 'Z')` (using the same `Number.isFinite(...)` guard pattern as `server/src/prereq/routes.ts:91-97`); call `markPrereqRan(repoId, cmdBySkill[request.skill], new Date(completedMs).toISOString(), durationMs)`. Preserve the existing `.catch` for error logging.
- [x] 2.4 Verify no TS error: `request.skill`'s union must be exactly `analyse | generate | workflow`. If `@bosch-sdlc/protocol`'s `ClaudboardLaunchRequest` permits other skills, narrow `cmdBySkill[request.skill]` with an exhaustive switch (matching the style of `buildPrompt` in the same file) instead of an object lookup.

## 3. Server: drop unused upsert call

- [x] 3.1 In `server/src/prereq/routes.ts`, remove the `upsertPrereqs(repo.id, detections)` line (currently line 73). Keep the `const detections = detectPrereqs(target)` line — it is still needed to feed the `EXPECTED_ARTIFACT` downgrade check immediately below it.
- [x] 3.2 Confirm the import of `upsertPrereqs` is still used; if not, remove it from the import statement at the top of the file.
- [x] 3.3 Leave the `markPrereqRan(...)` call further down untouched — it must still fire.

## 4. Server: test coverage

- [x] 4.1 In `server/src/registry/__tests__/`, add (or extend) a test file that mounts the registry router via `supertest`, attaches a temporary repo with a `.claude/reports/claudboard-analysis.md` file present, and asserts `GET /api/repos/:id/prereqs` returns `analyse.state === 'done'` without any explicit `upsertPrereqs` call between attach and read.
- [x] 4.2 In the same file, add a test that deletes the artifact out-of-band after attach and asserts the next GET returns `analyse.state === 'missing'` and `analyse.output === null`, regardless of what the `prereqs` table holds.
- [x] 4.3 In the same file, add a test that pre-populates a `prereqs` row with `last_run` and `duration_ms` values and asserts those fields appear in the response (verifying the join), even though `state` is derived live.
- [x] 4.4 In `server/src/claudboard/__tests__/`, add (or extend) a test that mocks `runFeature` to resolve immediately after writing a fake `runs` row with `status='done'`, `created_at`, `completed_at`. Call `launchClaudboardRun(repoId, target, { skill: 'analyse', ... })`. Await a tick. Assert that the `prereqs` row for `(repoId, 'analyse')` has `last_run` and `duration_ms` set.
- [x] 4.5 Add a test in the same file for `skill: 'workflow'` that asserts the `prereqs` row updated is the one with `cmd = 'claudboard-workflow'` (NOT `cmd = 'workflow'`).
- [x] 4.6 Add a test in the same file that mocks `runFeature` to leave the runs row in `status='failed'`. Assert that no `last_run` is written for the prereq row.

## 5. Server: verify nothing else reads the cached fields

- [x] 5.1 Grep `server/src` for any other reader of `prereqs.state`, `prereqs.output`, or `prereqs.stale_reason` (e.g. `mapPrereqRow`, dashboard queries, run validators). If any non-test reader exists outside `GET /repos/:id/prereqs`, decide per-call-site whether to switch it to `detectPrereqs` or leave it on the (now stale-by-design) cache; capture the decision inline with a comment. Expected outcome: only `validatePrereqDependencies` reads `state`, and it runs BEFORE a run starts (where the cache happens to still be correct because the only write path that mutates it is `POST /projects`).
- [x] 5.2 If `validatePrereqDependencies` (in `server/src/prereq/validators.ts`) reads `prereqs.state` from the DB, switch it to `detectPrereqs(repo.path)` for the same reason as the GET — otherwise a user could be blocked from running `/generate` even after a successful out-of-band `analyse`. If this change is non-trivial, split it into a follow-up task in this `tasks.md` and document the gap.

## 6. Verification

- [x] 6.1 From repo root: `npm run typecheck`. Confirm clean.
- [x] 6.2 From repo root: `npm run lint`. Confirm clean (pre-existing failures in unrelated files only).
- [x] 6.3 From `server/`: `node --experimental-vm-modules ../node_modules/.bin/jest`. Confirm all suites (including the new tests from §4) pass.
- [ ] 6.4 Manual smoke: start the dev stack, attach a repo, click Analyse from `ClaudboardLauncher`, wait for completion. Confirm: within ~2 s of run completion the Project page reports `analyse: done` (not Stale) without any page reload. Repeat for Generate and Workflow.
- [ ] 6.5 Manual smoke: with the Project page open, manually `rm .claude/reports/claudboard-analysis.md` on disk. Within ~2 s (the existing `useActiveRuns` cadence isn't relevant here — wait for the next manual page refresh or navigation) the page should report `analyse: missing` on next mount. Confirm.
- [x] 6.6 Run `openspec validate live-prereq-detection-on-read --strict` and confirm clean.
