# Tasks

## 1. Protocol additions

- [x] 1.1 Add `PhaseCost` interface to `protocol/src/types.ts` with `phaseNum`, `phaseTitle`, `costUsd`, `inputTokens`, `outputTokens`, `cacheReadTokens`, `apiCalls`, `model` fields
- [x] 1.2 Extend `Run` in `protocol/src/types.ts` with `costUsd: number | null` and `phaseCosts: PhaseCost[]` (default `[]` on serialization)
- [x] 1.3 Add `'cost-update'` to `WsEventKind` and a `CostUpdateEvent` interface to `protocol/src/events.ts`; append to the `WsEvent` union
- [x] 1.4 Build protocol (`npm run build -w protocol`) and confirm `npm run typecheck -w protocol` is clean

## 2. Server — canonical claudboard resolver (latent-bug fix)

- [x] 2.1 Create `server/src/cost/resolver.ts` exporting `resolveClaudboard(): { installPath; version; computeCostScript } | null` that reads `~/.claude/plugins/installed_plugins.json`, picks the highest-version `claudboard@claudboard` entry whose `installPath` exists on disk, and returns `null` otherwise
- [x] 2.2 Swap `server/src/bootstrap/plugin-check.ts:isClaudboardInstalled` to call the resolver and return `boolean`; keep the existing export signature so callers don't change
- [x] 2.3 Swap `server/src/claudboard/skill-discovery.ts:isClaudboardInstalled` to call the resolver and return `ClaudboardAvailability`; keep the existing export signature
- [x] 2.4 Update tests at `server/src/bootstrap/__tests__/state.test.ts` and any tests covering `skill-discovery` to mock the resolver instead of the old sentinel paths

## 3. Server — cost engine

- [x] 3.1 Create `server/src/cost/engine.ts` exporting `sessionJsonlPath(cwd, sessionId): string` that derives `~/.claude/projects/<cwd-with-/-as->/${sessionId}.jsonl`
- [x] 3.2 In the same file, export `computeCost({ scriptPath, sessionJsonl, since, until? }): Promise<CostJson | null>` that spawns `compute-cost.sh --format json --since <ts> [--until <ts>] <jsonl>`, parses stdout, returns `null` on any failure (non-zero exit, parse error, spawn error, null `scriptPath`); MUST NOT throw
- [x] 3.3 **Fix slug derivation (post-smoke bug)**: change `sessionJsonlPath()` to normalize *every* non-`[A-Za-z0-9-]` character with `cwd.replace(/[^A-Za-z0-9-]+/g, '-')` (the prior `.replaceAll('/','-')` missed `.`, breaking any cwd containing a dot — confirmed against the `craftsphere.cloud` run where `phase-complete` fired twice but no `cost-update` was broadcast because the JSONL was at `-craftsphere-cloud/`, not `-craftsphere.cloud/`)
- [x] 3.4 Add a glob fallback in `computeCost()`: if the fast-path `sessionJsonl` does not `existsSync`, try `~/.claude/projects/*/${sessionId}.jsonl` and use the first match before giving up. Keeps cost-telemetry robust to future Claude Code slug-rule changes.
- [x] 3.5 Add unit tests in `server/src/cost/__tests__/engine.test.ts`: slug derivation (standard + dotted regression + multi-char collapse) and computeCost null-path/missing-file handling. (Glob-fallback happy path will be exercised by the manual smoke test 11.3.)

## 4. Server — broadcast subscriber API

- [x] 4.1 In `server/src/ws-server.ts`, add `subscribe(handler: (event: WsEvent) => void): () => void` returning an unsubscribe function; invoke all subscribers inside `broadcast()` after the existing fan-out, wrapped in try/catch so a subscriber error never breaks the broadcast

## 5. Server — cost tracker

- [x] 5.1 Create `server/src/cost/tracker.ts` exporting `startCostTracker(db, opts?)` that resolves claudboard at startup, registers a `subscribe()` handler, and exposes a `stopCostTracker()` for tests
- [x] 5.2 Tracker captures `sessionId` from `transcript-message` events where `payload.message.type === 'system' && subtype === 'init'`, keyed by `runId`
- [x] 5.3 Tracker records `(phaseNum, phaseTitle, startedAt)` on `phase-start`; on `phase-complete`, asynchronously invokes `computeCost` for the slice, inserts a `phase_costs` row (catching UNIQUE conflict silently), and broadcasts a `cost-update` event with `scope: 'phase'`
- [x] 5.4 Tracker on `status-change` to `done|failed|cancelled`: asynchronously invokes `computeCost` with only `--since runStartedAt`, updates `runs.cost_usd`, `input_tokens`, `output_tokens`, broadcasts a `cost-update` event with `scope: 'total'`
- [x] 5.5 When resolver returns `null` at boot, register all handlers as no-ops and `console.warn` exactly once: `cost-telemetry: claudboard plugin not detected; cost capture disabled`
- [x] 5.6 Wire `startCostTracker(getDb())` into `server/src/app.ts` so it runs at server boot

## 6. Server — schema migration

- [x] 6.1 In `server/src/db.ts`, add `CREATE TABLE IF NOT EXISTS phase_costs (...)` to the bundled DDL block per design D-spec
- [x] 6.2 Add a `PRAGMA table_info('runs')`-guarded `ALTER TABLE runs ADD COLUMN cost_usd REAL` in the runs additive-migrations section
- [x] 6.3 Extend `server/src/__tests__/db-migration.test.ts` to assert `phase_costs` exists with the `UNIQUE(run_id, phase_num)` constraint, and that `runs.cost_usd` is present after migration on a pre-existing DB

## 7. Server — serialization + REST surface

- [x] 7.1 Extend the `RunRow` type and `mapRunRow()` in `server/src/run/serialize.ts` to include `cost_usd` and produce `costUsd: number | null`
- [x] 7.2 Add `loadPhaseCosts(db, runId): PhaseCost[]` in the same file that selects from `phase_costs` ordered by `phase_num`
- [x] 7.3 In `server/src/run/routes.ts`, include `phaseCosts` on the `GET /api/runs/:id` response; `GET /api/runs` (list) returns `costUsd` only (via `mapRunRow`)

## 8. UI — shared format utility

- [x] 8.1 Create `ui/src/util/format.ts` exporting `formatUsd(n: number): string` (returns `$X.XX`) and `formatCost(cents: number | null | undefined): string | null` (moved from `OperationCard.tsx:49`)
- [x] 8.2 Update `ui/src/components/Project/OperationCard.tsx` to import `formatCost` from the new util

## 9. UI — ActiveRun Cost rail section

- [x] 9.1 Extend `ActiveRun.tsx` to accumulate `cost-update` events into a `Map<phaseNum, PhaseCost>` plus a separate `totalCost` state; hydrate from `run.phaseCosts` and `run.costUsd` on initial REST load
- [x] 9.2 Add a new `.active-run__rail-section` Cost block below the existing "Run info" / "Events" sections rendering `Total $X.XX` + one row per phase + `Tokens` + `Model` footer (per design D8 layout)
- [x] 9.3 Hide the Cost section entirely when `run.costUsd === null && phaseCosts.length === 0 && no cost-update events received` (no error UI; matches no-claudboard branch)
- [x] 9.4 Add CSS rows for the new section to `ActiveRun.css`, matching existing `active-run__kv` pattern; respect CSS-prefix lint
- [x] 9.5 Extend `ActiveRun.test.tsx` with a test that feeds synthetic `cost-update` events and asserts the rail renders Total + per-phase rows; add a test that hides the section when no cost data exists

## 10. UI — Recent runs cost column

- [x] 10.1 In `ui/src/components/Dashboard/RecentRunsPanel.tsx`, add a cost cell rendering `formatUsd(run.costUsd)`, `—` for null, or a small skeleton placeholder for `status === 'running'`
- [x] 10.2 Update `RecentRunsPanel.css` `grid-template-columns: auto 1fr 1fr auto auto;` and add a `.runs-panel__cost` class with mono font / right-align
- [x] 10.3 Add `RecentRunsPanel.test.tsx` (new file) covering: row with cost, completed row with null cost (em-dash), running row with null cost (placeholder)

## 11. Verification

- [x] 11.1 `npm run build` at the repo root succeeds (protocol → server → ui)
- [x] 11.2 `npm run typecheck && npm run lint && npm test` at the repo root all pass (CSS lint has pre-existing failures unrelated to this change; prompt-templates.test.ts has pre-existing failure)
- [x] 11.2a Re-run typecheck + tests after the §3.3-3.5 slug fix lands
- [ ] 11.3 Manual smoke: start server + ui, run a claudboard `/analyse` prereq; ActiveRun rail shows Cost section with Total after completion; `sqlite3 ~/.bosch-sdlc/state.db "SELECT id, cost_usd, input_tokens, output_tokens FROM runs ORDER BY created_at DESC LIMIT 1"` returns non-null `cost_usd`; Recent runs row shows `$X.XX`
- [ ] 11.4 Manual smoke: start a feature run; rail updates per phase as each `phase-complete` arrives; `SELECT * FROM phase_costs WHERE run_id = <id>` has one row per completed phase; total equals sum (allow ≤$0.01 drift per design D-risk)
- [ ] 11.5 Cross-check the rail total against the claudboard hook's `Cost for /analyse: $X.XX` line in the stream pane — they should match to the cent
- [ ] 11.6 No-claudboard sanity: temporarily rename `~/.claude/plugins/cache/claudboard/` (or stub the resolver to return `null` via env), restart the server; confirm a run still completes; rail Cost section is absent; Recent runs shows `—`; exactly one `console.warn` at boot
(manual verification pending)
